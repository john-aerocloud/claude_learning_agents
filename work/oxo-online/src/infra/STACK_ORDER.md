# Stack instantiation and deploy order

## Stacks in this CDK app

| CDK construct ID  | CloudFormation stack name | Purpose                                           | Deploy cadence          |
|-------------------|--------------------------|---------------------------------------------------|-------------------------|
| `OxoOnlineOidcStack` | `OxoOnlineOidcStack`  | OIDC provider + `oxo-deploy` + `oxo-infra-deploy` IAM roles | One-time manual         |
| `OxoGameProd`     | `OxoGameProd`            | Lambda (`oxo-game-fn`) + DynamoDB `Games` + HTTP API Gateway | Every infra push (infra pipeline) |
| `OxoOnlineProd`   | `OxoOnlineProd`          | S3 bucket + CloudFront distribution + Route 53    | Every infra push (infra pipeline) |

## Why OxoGameProd must deploy before OxoOnlineProd

`OxoOnlineProd` adds a `/api/*` CloudFront cache behaviour whose origin is the
HTTP API invoke domain. That domain is an output of `OxoGameProd`. CDK resolves
cross-stack references at synth time as CloudFormation exports/imports, which means
CloudFormation itself enforces the ordering: a stack that imports a value cannot
complete while the exporting stack has not yet created that export.

If you deploy `OxoOnlineProd` before `OxoGameProd` on the first run, CloudFormation
will fail with "Export OxoGameProd-HttpApiEndpoint does not exist." Always deploy
`OxoGameProd` first.

The pipeline command reflects this order:

```
npx cdk deploy OxoGameProd OxoOnlineProd --require-approval never
```

CDK/CloudFormation honours the positional order and the cross-stack dependency graph.

## Cross-stack reference pattern — HTTP API domain to CloudFront origin

### In OxoGameStack (game-stack.ts)

After creating the HTTP API, export its invoke URL via a `CfnOutput` with a stable
`exportName`:

```typescript
// Inside OxoGameStack constructor, after creating the HttpApi:
new cdk.CfnOutput(this, 'HttpApiEndpoint', {
  value: httpApi.apiEndpoint,          // e.g. https://<apiId>.execute-api.eu-west-2.amazonaws.com
  exportName: 'OxoGameProd-HttpApiEndpoint',
  description: 'HTTP API invoke URL — consumed by OxoOnlineProd /api/* origin',
});

// Export the function name so the app pipeline can call UpdateFunctionCode:
new cdk.CfnOutput(this, 'LambdaFunctionName', {
  value: gameFn.functionName,
  exportName: 'OxoGameProd-LambdaFunctionName',
  description: 'Lambda function name — set as GitHub Actions variable OXO_ONLINE_LAMBDA_FUNCTION_NAME',
});
```

### In OxoOnlineShellStack (oxo-online-shell-stack.ts)

Import the API endpoint and wire it as the `/api/*` origin:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';

// Inside OxoOnlineShellStack constructor, after the distribution is created:
const httpApiEndpoint = cdk.Fn.importValue('OxoGameProd-HttpApiEndpoint');

// Strip the "https://" prefix — CloudFront origins take domain name only:
// HttpUrlOrigin handles https:// prefix, so pass the full URL directly:
const apiOrigin = new origins.HttpOrigin(
  cdk.Fn.select(2, cdk.Fn.split('/', httpApiEndpoint)),  // domain portion only
  {
    protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    // The HTTP API's $default stage is at the root; CloudFront strips /api prefix
    // via the originPath so the Lambda sees /games:
    originPath: '',   // set to '/<stage>' if a named stage is used
  },
);

distribution.addBehavior('/api/*', apiOrigin, {
  cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
  allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
  viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
  originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
});
```

### Alternative: SSM Parameter Store (decoupled deploys)

If you want to decouple the stacks so they can deploy independently (no hard
CloudFormation import/export link), use SSM:

1. In `OxoGameStack`, write the endpoint to SSM:
   ```typescript
   new ssm.StringParameter(this, 'ApiEndpointParam', {
     parameterName: '/oxo-online/prod/api-endpoint',
     stringValue: httpApi.apiEndpoint,
   });
   ```

2. In `OxoOnlineShellStack`, read it at synth time:
   ```typescript
   const apiEndpoint = ssm.StringParameter.valueForStringParameter(
     this, '/oxo-online/prod/api-endpoint'
   );
   ```

The SSM approach requires a CDK lookup (needs AWS credentials at synth time) but
avoids the CloudFormation hard dependency. For this project the direct
`Fn.importValue` pattern is preferred — both stacks always deploy together and the
ordering is explicit and enforced.

## How to reference the Lambda function name from the app pipeline

`OxoGameStack` exports the function name via `CfnOutput` with
`exportName: 'OxoGameProd-LambdaFunctionName'`.

After the first successful infra deploy, copy the `LambdaFunctionName` output value
from the `OxoGameProd` CloudFormation stack into the GitHub Actions variable
`OXO_ONLINE_LAMBDA_FUNCTION_NAME` (not a secret — function names are not sensitive).

The `deploy-oxo-online.yml` pipeline reads this variable when `src/lambda/**`
changes and passes it to `aws lambda update-function-code --function-name`.

If CDK generates a non-deterministic function name (default), use a fixed
`functionName` prop on the Lambda construct to make it stable:

```typescript
const gameFn = new lambda.Function(this, 'GameFn', {
  functionName: 'oxo-game-fn',   // stable name; safe for a single-stack singleton
  // ...
});
```
