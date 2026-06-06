import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Shared DynamoDB document client, reused across warm invocations. Importing
// from a single module lets aws-sdk-client-mock intercept every handler's calls
// in unit tests.
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const CONNECTION_TTL_SECONDS = 2 * 60 * 60; // +2h (delta §Connections TTL).
