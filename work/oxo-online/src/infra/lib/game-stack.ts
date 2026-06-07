import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as customresources from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

// s005-h2 — shared ws-token secret parameter name. Both oxo-game-fn (mint) and
// oxo-ws-auth-fn (verify) read THIS one SSM SecureString by name (the single
// shared source, SYNTH-CONTRACT-H2-2). The value is generated in-stack by a
// custom resource (delta §4 — no manual seed; keeps §19 trunk-CD).
const WS_TOKEN_SECRET_PARAM = '/oxo-online/prod/ws-token-secret';

// s005-h2 — per-IP rolling connect window (delta §1). Items self-delete on TTL.
const CONNECT_ATTEMPTS_TTL_SECONDS = 5 * 60;

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
      description: 'HTTP API invoke URL - consumed by OxoOnlineProd /api/* origin',
      exportName: 'OxoGameProd-HttpApiEndpoint',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: gameFunction.functionName,
      description:
        'Lambda function name - GitHub Actions var OXO_ONLINE_LAMBDA_FUNCTION_NAME',
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
        'WebSocket invoke URL incl. /prod - consumed by SPA wsUrl config injection',
      exportName: 'OxoGameProd-WsApiEndpoint',
    });

    new cdk.CfnOutput(this, 'WsApiId', {
      value: wsApi.ref,
      description: 'WebSocket API id - used by the deploy/config step',
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

    // =========================================================================
    // s005-h2 — $connect authorisation + per-IP rate-limiting (delta s005-h2).
    // All additive, in OxoGameProd. No new stack, no new cross-stack import.
    // =========================================================================

    // Build identity (principles/01, T9): the SHA is injected by the pipeline
    // (BUILD_SHA env / -c buildSha), NEVER hardcoded. Falls back to 'dev' for
    // local synth so tests run; the pipeline overrides it for real deploys.
    const buildSha: string =
      (this.node.tryGetContext('buildSha') as string) ??
      process.env.BUILD_SHA ??
      'dev';

    // -------------------------------------------------------------------------
    // ConnectAttempts — per-IP rolling connect counter (T5, S4).
    //   PK sourceIp (S), no sort key; on-demand; SSE; TTL on `ttl` (~5-min);
    //   PITR off (deliberate — ephemeral abuse-control data); no resource
    //   policy. DESTROY on stack delete (purely ephemeral).
    // -------------------------------------------------------------------------
    const connectAttemptsTable = new dynamodb.Table(this, 'ConnectAttemptsTable', {
      tableName: 'oxo-connect-attempts',
      partitionKey: { name: 'sourceIp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // -------------------------------------------------------------------------
    // Shared ws-token secret (T3, S3, delta §4). An SSM SecureString whose
    // value is GENERATED in-stack by a custom resource (32 random bytes) —
    // never a manual seed (§19), never a plaintext env var. Both fns read it by
    // name. A1's mint adapter + this fn's verify adapter both call SSM
    // GetParameter(WithDecryption) on this exact name → single shared key.
    // -------------------------------------------------------------------------
    const secretGeneratorFn = new lambda.Function(this, 'WsTokenSecretGenerator', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      // Inline CFN custom-resource handler: on Create/Update generate a 32-byte
      // random secret and write it as an SSM SecureString; on Delete remove it.
      code: lambda.Code.fromInline(`
const { SSMClient, PutParameterCommand, DeleteParameterCommand } = require('@aws-sdk/client-ssm');
const crypto = require('node:crypto');
const ssm = new SSMClient({});
exports.handler = async (event) => {
  const name = event.ResourceProperties.ParameterName;
  if (event.RequestType === 'Delete') {
    try { await ssm.send(new DeleteParameterCommand({ Name: name })); } catch (e) {}
    return { PhysicalResourceId: name };
  }
  const value = crypto.randomBytes(32).toString('base64');
  await ssm.send(new PutParameterCommand({
    Name: name, Value: value, Type: 'SecureString', Overwrite: true,
  }));
  return { PhysicalResourceId: name };
};
`),
    });
    // The generator may PutParameter/DeleteParameter on THIS one parameter only.
    secretGeneratorFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'GenerateWsTokenSecret',
        effect: iam.Effect.ALLOW,
        actions: [
          'ssm:PutParameter',
          'ssm:DeleteParameter',
        ],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${WS_TOKEN_SECRET_PARAM}`,
        ],
      }),
    );

    const secretProvider = new customresources.Provider(this, 'WsTokenSecretProvider', {
      onEventHandler: secretGeneratorFn,
    });
    const wsTokenSecret = new cdk.CustomResource(this, 'WsTokenSecret', {
      serviceToken: secretProvider.serviceToken,
      properties: { ParameterName: WS_TOKEN_SECRET_PARAM },
    });

    // The exact ARN of the shared secret parameter — used to scope both read
    // grants to this ONE resource (CP-H2-C). kms:Decrypt on the SSM-managed key
    // is covered by the account-default alias when SecureString uses the
    // default key (no customer CMK), so no extra KMS statement is required.
    const wsTokenSecretArn = `arn:aws:ssm:${this.region}:${this.account}:parameter${WS_TOKEN_SECRET_PARAM}`;

    // S-A2.12 / S2 — oxo-game-fn gains ONLY the one shared-secret read grant
    // (retains Games PutItem). Plus the env var so it can mint (UC1 consumes it).
    gameFunction.addEnvironment('WS_TOKEN_SECRET_PARAM', WS_TOKEN_SECRET_PARAM);
    gameFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ReadWsTokenSecret',
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [wsTokenSecretArn],
      }),
    );

    // -------------------------------------------------------------------------
    // oxo-ws-auth-fn — the $connect REQUEST authorizer (delta §2 separate fn).
    // Dedicated least-privilege role (S1, CP-H2-A/B/C/D):
    //   - GetItem/Query on Games table + code-index GSI (guest code lookup)
    //   - UpdateItem/PutItem on ConnectAttempts (per-IP counter)
    //   - GetParameter on the ONE shared secret ARN (verify)
    //   - own log group
    // NO ManageConnections, NO Connections, NO Games write, NO wildcard.
    // -------------------------------------------------------------------------
    const wsAuthRole = new iam.Role(this, 'WsAuthFunctionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'oxo-ws-auth-fn execution role - gate-only least privilege (s005-h2).',
    });
    wsAuthRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'OwnLogGroup',
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/oxo-ws-auth-fn:*`,
        ],
      }),
    );
    // CP-H2-A — read-only on Games + code-index GSI (guest code lookup).
    wsAuthRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'GamesReadByCode',
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [
          gamesTable.tableArn,
          `${gamesTable.tableArn}/index/${GAMES_CODE_INDEX}`,
        ],
      }),
    );
    // CP-H2-B — per-IP counter writes on ConnectAttempts ARN only.
    wsAuthRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ConnectAttemptsWrite',
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:UpdateItem', 'dynamodb:PutItem'],
        resources: [connectAttemptsTable.tableArn],
      }),
    );
    // CP-H2-C — secret read on the ONE shared parameter ARN only.
    wsAuthRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadWsTokenSecret',
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [wsTokenSecretArn],
      }),
    );

    const wsAuthFunction = new lambda.Function(this, 'WsAuthFunction', {
      functionName: 'oxo-ws-auth-fn',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'ws-auth/handler.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '..', '..', 'lambda', 'ws-auth', 'dist'),
      ),
      role: wsAuthRole,
      environment: {
        GAMES_TABLE: gamesTable.tableName,
        GAMES_CODE_INDEX,
        CONNECT_ATTEMPTS_TABLE: connectAttemptsTable.tableName,
        WS_TOKEN_SECRET_PARAM,
        CONNECT_RATE_THRESHOLD: '20',
        BUILD_SHA: buildSha,
      },
      reservedConcurrentExecutions: 15,
      timeout: cdk.Duration.seconds(5),
      memorySize: 256,
    });
    wsAuthFunction.node.addDependency(wsTokenSecret);

    // Allow API Gateway to invoke the authorizer.
    wsAuthFunction.addPermission('WsAuthInvoke', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.ref}/authorizers/*`,
    });

    // -------------------------------------------------------------------------
    // REQUEST authorizer attached to the WS API (T1, SYNTH-CONTRACT-H2-1).
    // IdentitySource = the wsToken + code query-string params (delta §1).
    // AuthorizerResultTtlInSeconds 0 (T2, §3) — every connect runs the
    // authorizer so the per-IP counter is accurate.
    // -------------------------------------------------------------------------
    const wsAuthorizer = new apigatewayv2.CfnAuthorizer(this, 'WsConnectAuthorizer', {
      apiId: wsApi.ref,
      name: 'oxo-ws-connect-authorizer',
      authorizerType: 'REQUEST',
      identitySource: [
        'route.request.querystring.wsToken',
        'route.request.querystring.code',
      ],
      authorizerUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${wsAuthFunction.functionArn}/invocations`,
      // Platform semantic (strike 4, run 27085881193): WEBSOCKET APIs REJECT
      // AuthorizerResultTtlInSeconds entirely — WS authorizers never cache, so
      // the delta's no-cache intent (TTL=0) is the inherent behaviour; the
      // property must be OMITTED.
    });

    // Gate the EXISTING $connect route: AuthorizationType CUSTOM + AuthorizerId.
    // The $connect CfnRoute is created in the s005 loop above; re-set its auth
    // properties here via an escape hatch so the gate is ON the route (T1).
    // UC-FLAG H2_ENFORCE (process §40 — two-phase credential rollout, §39
    // ordering): enforcement MUST NOT go live before the SPA sends credentials
    // (Set B). Deploying CUSTOM now would break live pairing (enforcement-
    // before-credentials). Authorizer fn + secret + table deploy idle; the
    // Set-B-complete commit flips this to true, then the flag is factored out
    // (§40 lifecycle). Until then $connect stays unauthenticated as today.
    // Flag is context-driven (default OFF). Prod deploys with it OFF until the
    // Set-B SPA ships credentials; UC2's own tests synth with it ON (§40 —
    // tests run flag-ON) to assert the gate IS on the route (T1). The
    // Set-B-complete commit sets the default ON, then factors the flag out.
    const H2_ENFORCE =
      (this.node.tryGetContext('h2Enforce') as boolean | string | undefined) ===
        true ||
      this.node.tryGetContext('h2Enforce') === 'true';
    const connectRoute = this.node.findChild('JoinWsRouteConnect') as apigatewayv2.CfnRoute;
    if (H2_ENFORCE) {
      connectRoute.authorizationType = 'CUSTOM';
      connectRoute.authorizerId = wsAuthorizer.ref;
      connectRoute.addDependency(wsAuthorizer);
    }
  }
}
