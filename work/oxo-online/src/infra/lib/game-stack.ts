import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';

// slice 004: OxoGameStack
// Resources:
//   - DynamoDB `Games` table (PK: gameId; TTL: ttl; on-demand; SSE)
//   - Lambda `oxo-game-fn` (Node.js 20.x; POST /api/games handler; env: TABLE_NAME)
//   - HTTP API Gateway (POST /api/games -> lambda proxy; $default stage)
//   - IAM execution role scoped to PutItem on Games ARN + its own log group
//   - CfnOutput: HttpApiEndpoint (consumed by OxoOnlineProd as /api/* origin)
//   - CfnOutput: LambdaFunctionName (consumed by deploy-oxo-online.yml)
//
// slice 005 (additive — same stack, delta §"WebSocket API lives in OxoGameProd"):
//   - Games `code-index` GSI (join-by-code lookup; base key schema unchanged)
//   - DynamoDB `Connections` table (PK: connectionId; TTL: ttl; on-demand; SSE)
//   - Lambda `oxo-ws-fn` (Node.js 20.x; $connect/$disconnect/register/join)
//   - WebSocket API Gateway + prod stage (four routes, no $default, throttled)
//   - oxo-ws-fn least-privilege role (GSI Query + conditional UpdateItem on
//     Games, Put/Delete on Connections, ManageConnections on THIS WS API only)
//   - CfnOutputs: WsApiEndpoint (wss invoke URL), WsApiId
//
// Deploy order: OxoGameProd must deploy BEFORE OxoOnlineProd so the HTTP API
// endpoint export exists when OxoOnlineProd reads it to wire the /api/* origin.
// See work/oxo-online/src/infra/STACK_ORDER.md for the cross-stack reference pattern.

export class OxoGameStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -------------------------------------------------------------------------
    // Games table — single-item-per-game document model.
    //   - PK gameId (UUID generated in the Lambda); no sort key.
    //   - TTL on `ttl` (epoch seconds): abandoned `waiting` games self-delete.
    //   - On-demand billing absorbs spikes; SSE (AWS-managed key) at rest.
    //   - RETAIN on stack delete: data is ephemeral but the table is the
    //     project's first stateful store — never auto-drop it.
    // -------------------------------------------------------------------------
    const gamesTable = new dynamodb.Table(this, 'GamesTable', {
      tableName: 'oxo-games',
      partitionKey: {
        name: 'gameId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // -------------------------------------------------------------------------
    // s005 — code-index GSI for join-by-code lookup (delta §Games.code GSI).
    // Additive, in-place update: the base KeySchema (gameId HASH) is unchanged,
    // so this is NOT a table replacement (T10, S5). Projection is minimal — only
    // the attributes the join handler needs to validate + act on.
    // -------------------------------------------------------------------------
    const GAMES_CODE_INDEX = 'code-index';
    gamesTable.addGlobalSecondaryIndex({
      indexName: GAMES_CODE_INDEX,
      partitionKey: { name: 'code', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ['status', 'hostConnectionId', 'guestConnectionId'],
    });

    // -------------------------------------------------------------------------
    // s005 — Connections table: ephemeral connectionId -> game/role map.
    //   - PK connectionId (String), no sort key.
    //   - TTL on `ttl` (+2h); on-demand; SSE (AWS-managed key); PITR off.
    //   - No resource policy at all (T9 — no public principal).
    // -------------------------------------------------------------------------
    const connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      tableName: 'oxo-connections',
      partitionKey: {
        name: 'connectionId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // -------------------------------------------------------------------------
    // oxo-game-fn — POST /games handler.
    //   - Node.js 20.x, 512MB, 3s timeout.
    //   - Reserved concurrency caps cost/abuse blast radius while the endpoint
    //     is unauthenticated (delta 004 — DDoS control).
    //   - TABLE_NAME injected; no secrets in env; no VPC attachment.
    //   - Built artifact (tsc output) is loaded from the lambda dist directory.
    // -------------------------------------------------------------------------
    const gameFunction = new lambda.Function(this, 'GameFunction', {
      functionName: 'oxo-game-fn',
      runtime: lambda.Runtime.NODEJS_20_X,
      // A1's token/ module re-nested the compiled output: tsconfig rootDir '.'
      // emits games/dist/games/handler.js (+ games/dist/token/**). Handler path
      // must match the asset layout (wiring contract — see A1 commit 5b19d90).
      handler: 'games/handler.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '..', '..', 'lambda', 'games', 'dist'),
      ),
      environment: { TABLE_NAME: gamesTable.tableName },
      reservedConcurrentExecutions: 10,
      timeout: cdk.Duration.seconds(3),
      memorySize: 512,
    });

    // Least privilege: PutItem on the Games table ARN ONLY. No read/query/scan,
    // no wildcard resource, no second table (T3, S3). `grant` scopes Resource to
    // the table ARN via a CloudFormation reference.
    gamesTable.grant(gameFunction, 'dynamodb:PutItem');

    // -------------------------------------------------------------------------
    // HTTP API — single route POST /api/games -> Lambda proxy ($default stage).
    // The SPA calls /api/games; CloudFront's /api/* behaviour forwards the full
    // path unchanged to this origin (no prefix stripping), so the route key
    // MUST include the /api prefix to match (DEFECT-004-001). TLS 1.2+ is
    // enforced by the service. CORS is not configured because CloudFront makes
    // the SPA path same-origin (delta 004).
    // -------------------------------------------------------------------------
    const httpApi = new apigatewayv2.HttpApi(this, 'GameApi', {
      apiName: 'oxo-game-api',
    });

    const integration = new apigatewayv2integrations.HttpLambdaIntegration(
      'GameIntegration',
      gameFunction,
    );

    httpApi.addRoutes({
      path: '/api/games',
      methods: [apigatewayv2.HttpMethod.POST],
      integration,
    });

    // -------------------------------------------------------------------------
    // Cross-stack outputs (STACK_ORDER.md):
    //   - HttpApiEndpoint: consumed by OxoOnlineProd as the /api/* origin.
    //   - LambdaFunctionName: copied to GitHub Actions var for UpdateFunctionCode.
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'HttpApiEndpoint', {
      value: httpApi.apiEndpoint,
      description: 'HTTP API invoke URL — consumed by OxoOnlineProd /api/* origin',
      exportName: 'OxoGameProd-HttpApiEndpoint',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: gameFunction.functionName,
      description:
        'Lambda function name — GitHub Actions var OXO_ONLINE_LAMBDA_FUNCTION_NAME',
      exportName: 'OxoGameProd-LambdaFunctionName',
    });

    // =========================================================================
    // s005 — WebSocket join-game surface (added to the SAME OxoGameProd stack,
    // delta §"WebSocket API lives in OxoGameProd"). All additive: the s004 HTTP
    // create-game path above is untouched.
    // =========================================================================

    // -------------------------------------------------------------------------
    // oxo-ws-fn — the single Lambda backing all four WS routes.
    //   - Node.js 20.x, finite reserved concurrency (delta §abuse control).
    //   - Fixed functionName so the app pipeline can update-function-code.
    //   - Env: table/index names + the @connections management endpoint (set
    //     below once the API/stage exist).
    //   - role: a dedicated least-privilege execution role; all DynamoDB and
    //     execute-api grants are explicit ARN-scoped statements (S1/S2).
    // -------------------------------------------------------------------------
    const wsRole = new iam.Role(this, 'WsFunctionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'oxo-ws-fn execution role - least privilege (s005).',
    });
    // Own log-group actions only (no AWSLambdaBasicExecutionRole managed policy,
    // which is not ARN-scoped). Scoped to this function's log group.
    wsRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'OwnLogGroup',
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/oxo-ws-fn:*`,
        ],
      }),
    );

    const wsFunction = new lambda.Function(this, 'WsFunction', {
      functionName: 'oxo-ws-fn',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '..', '..', 'lambda', 'ws', 'dist'),
      ),
      role: wsRole,
      environment: {
        GAMES_TABLE: gamesTable.tableName,
        GAMES_CODE_INDEX,
        CONNECTIONS_TABLE: connectionsTable.tableName,
        // WS_API_ENDPOINT added below once the API id + stage are known.
      },
      reservedConcurrentExecutions: 15,
      timeout: cdk.Duration.seconds(5),
      memorySize: 256,
    });

    // S1 — DynamoDB scope, EXACTLY the delta grants and nothing wider:
    //   Query/GetItem on Games table ARN + code-index GSI ARN;
    //   UpdateItem on Games table ARN;
    //   PutItem/DeleteItem on Connections table ARN.
    // No Scan, no dynamodb:*, no Put/Delete on Games, no read on Connections,
    // no wildcard resource. Each grant scopes Resource to the exact ARN.
    wsRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'GamesReadByCode',
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:Query', 'dynamodb:GetItem'],
        resources: [
          gamesTable.tableArn,
          `${gamesTable.tableArn}/index/${GAMES_CODE_INDEX}`,
        ],
      }),
    );
    wsRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'GamesConditionalUpdate',
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:UpdateItem'],
        resources: [gamesTable.tableArn],
      }),
    );
    wsRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ConnectionsWrite',
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:PutItem', 'dynamodb:DeleteItem'],
        resources: [connectionsTable.tableArn],
      }),
    );

    // -------------------------------------------------------------------------
    // WebSocket API — RouteSelectionExpression keys off the client message's
    // `action` field. Exactly four routes; NO $default catch-all (S3/T7 — an
    // unmatched action is dropped by the service, not silently routed). TLS 1.2+
    // is enforced by the WSS service.
    // -------------------------------------------------------------------------
    const wsApi = new apigatewayv2.CfnApi(this, 'JoinWsApi', {
      name: 'oxo-ws-api',
      protocolType: 'WEBSOCKET',
      routeSelectionExpression: '$request.body.action',
    });

    // AWS_PROXY integration — all four routes share the single oxo-ws-fn.
    const wsIntegration = new apigatewayv2.CfnIntegration(
      this,
      'JoinWsIntegration',
      {
        apiId: wsApi.ref,
        integrationType: 'AWS_PROXY',
        integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${wsFunction.functionArn}/invocations`,
        integrationMethod: 'POST',
      },
    );

    const integrationTarget = `integrations/${wsIntegration.ref}`;
    const routeKeys = ['$connect', '$disconnect', 'register', 'join'] as const;
    const routeLogicalIds: Record<(typeof routeKeys)[number], string> = {
      $connect: 'JoinWsRouteConnect',
      $disconnect: 'JoinWsRouteDisconnect',
      register: 'JoinWsRouteRegister',
      join: 'JoinWsRouteJoin',
    };
    for (const routeKey of routeKeys) {
      new apigatewayv2.CfnRoute(this, routeLogicalIds[routeKey], {
        apiId: wsApi.ref,
        routeKey,
        target: integrationTarget,
      });
    }

    // Allow API Gateway to invoke oxo-ws-fn for any route on this API.
    wsFunction.addPermission('JoinWsInvoke', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.ref}/*/*`,
    });

    // prod stage — AutoDeploy on, with a finite hobby-cap default-route throttle.
    // This stage-level throttle is the in-slice abuse floor standing in for WAF
    // (delta §resource-exhaustion controls; T8).
    const wsStage = new apigatewayv2.CfnStage(this, 'JoinWsProdStage', {
      apiId: wsApi.ref,
      stageName: 'prod',
      autoDeploy: true,
      defaultRouteSettings: {
        throttlingRateLimit: 20,
        throttlingBurstLimit: 40,
      },
    });
    wsStage.addDependency(wsApi);

    // @connections management endpoint for game-ready fan-out (join happy path).
    const wsManagementEndpoint = `https://${wsApi.ref}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`;
    wsFunction.addEnvironment('WS_API_ENDPOINT', wsManagementEndpoint);

    // S2 — execute-api:ManageConnections scoped to THIS WS API's ARN only
    // (prod stage, @connections). Not `*`, not execute-api:*, not a second API
    // id. This is the only execute-api statement on the role.
    // DEFECT-005-001 Bug B: the close transport both POSTs an error frame AND
    // DELETEs the connection (PostToConnection + DeleteConnection — the latter
    // is the only close primitive @connections offers). Both use the single
    // execute-api:ManageConnections action but hit different HTTP verbs on the
    // @connections resource, so the verb segment is `*` (still pinned to this
    // API + prod stage + @connections — S2 holds).
    wsRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ManageConnectionsThisApiOnly',
        effect: iam.Effect.ALLOW,
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.ref}/${wsStage.stageName}/*/@connections/*`,
        ],
      }),
    );

    // -------------------------------------------------------------------------
    // Cross-stack outputs (additive only — s004 export-ordering lesson). The
    // SPA reads the wss URL via deploy-time config injection, NOT a CFN import,
    // so these add zero new cross-stack import coupling (delta §CfnOutputs).
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'WsApiEndpoint', {
      value: `wss://${wsApi.ref}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`,
      description:
        'WebSocket invoke URL incl. /prod — consumed by SPA wsUrl config injection',
      exportName: 'OxoGameProd-WsApiEndpoint',
    });

    new cdk.CfnOutput(this, 'WsApiId', {
      value: wsApi.ref,
      description: 'WebSocket API id — used by the deploy/config step',
      exportName: 'OxoGameProd-WsApiId',
    });

    // =========================================================================
    // s005-h1-waf — UC2 DESCOPED (GATE-AMEND-H1-A, human-approved Option A).
    //
    // A REGIONAL WAFv2 WebACL + association to this WS (API GW v2) `prod` stage
    // was attempted here and FAILED at CREATE: WAFv2 does NOT support API GW v2
    // (HTTP or WebSocket) stage ARNs as an association resource type
    //   "The ARN isn't valid ... /apis/<id>/stages/prod" (Wafv2 400, RESOURCE_ARN)
    //   — deploy run 27066828546.
    // The WS transport's in-slice abuse floor is the prod-stage default-route
    // throttle configured above (ThrottlingRateLimit/BurstLimit). The CloudFront
    // global ACL (OxoOnlineWafUsEast1 -> OxoOnlineProd webAclId) still ships and
    // protects the HTTP /api/* path. See game-stack.test.ts for the negative
    // platform-honesty pin that keeps WAFv2 out of this stack.
    // =========================================================================
  }
}
