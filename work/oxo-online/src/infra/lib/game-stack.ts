import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';

// slice 004: OxoGameStack
// Resources:
//   - DynamoDB `Games` table (PK: gameId; TTL: ttl; on-demand; SSE)
//   - Lambda `oxo-game-fn` (Node.js 20.x; POST /api/games handler; env: TABLE_NAME)
//   - HTTP API Gateway (POST /games -> lambda proxy; $default stage)
//   - IAM execution role scoped to PutItem on Games ARN + its own log group
//   - CfnOutput: HttpApiEndpoint (consumed by OxoOnlineProd as /api/* origin)
//   - CfnOutput: LambdaFunctionName (consumed by deploy-oxo-online.yml)
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
      handler: 'handler.handler',
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
    // HTTP API — single route POST /games -> Lambda proxy ($default stage).
    // The SPA calls /api/games; CloudFront strips the /api prefix so the API
    // sees /games (see OxoOnlineProd /api/* behaviour). TLS 1.2+ is enforced by
    // the service. CORS is not configured because CloudFront makes the SPA path
    // same-origin (delta 004).
    // -------------------------------------------------------------------------
    const httpApi = new apigatewayv2.HttpApi(this, 'GameApi', {
      apiName: 'oxo-game-api',
    });

    const integration = new apigatewayv2integrations.HttpLambdaIntegration(
      'GameIntegration',
      gameFunction,
    );

    httpApi.addRoutes({
      path: '/games',
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
  }
}
