import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
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
    new dynamodb.Table(this, 'GamesTable', {
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
  }
}
