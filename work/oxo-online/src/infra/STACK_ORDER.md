# Stack instantiation and deploy order

## Stacks in this CDK app

| CDK construct ID  | CloudFormation stack name | Purpose                                           | Deploy cadence          |
|-------------------|--------------------------|---------------------------------------------------|-------------------------|
| `OxoOnlineOidcStack` | `OxoOnlineOidcStack`  | OIDC provider + `oxo-deploy` + `oxo-infra-deploy` IAM roles | One-time manual (`make -C work/oxo-online/src/infra deploy-oidc`) |
| `OxoOnlineWafUsEast1` | `OxoOnlineWafUsEast1` | **[s005-h1]** Global CLOUDFRONT-scope WAFv2 WebACL (us-east-1). Exports ARN cross-region to OxoOnlineProd | Every infra push (infra pipeline) — **first**, in us-east-1 |
| `OxoGameProd`     | `OxoGameProd`            | Lambda (`oxo-game-fn`, `oxo-ws-fn`) + DynamoDB `Games` + `Connections` + HTTP API + WS API + **[s005-h1]** regional WAFv2 WebACL + association on WS prod stage | Every infra push (infra pipeline) |
| `OxoOnlineProd`   | `OxoOnlineProd`          | S3 bucket + CloudFront distribution + Route 53 + **[s005-h1]** distribution `webAclId` = OxoOnlineWafUsEast1 ARN (cross-region import) | Every infra push (infra pipeline) |

## s005-h1 WAF deploy order (cross-region)

```
1. OxoOnlineWafUsEast1   (us-east-1)  — create global WebACL, export ARN
2. OxoGameProd           (eu-west-2)  — incl. regional WebACL + WS-stage association
3. OxoOnlineProd         (eu-west-2)  — set distribution webAclId (imports #1 cross-region)
```

`OxoOnlineWafUsEast1` deploys FIRST because `OxoOnlineProd` imports its WebACL
ARN via CDK `crossRegionReferences: true` (SSM parameter in us-east-1, read by a
custom resource in eu-west-2 — CloudFormation has no native cross-region
import). The regional WebACL + association are self-contained inside
`OxoGameProd`, so `OxoGameProd`'s "before OxoOnlineProd" position is unchanged.
The deploy-role WAFv2/CloudFront grants must be applied via `make deploy-oidc`
BEFORE this sequence runs (§39 — see DEPLOY_ROLE_EXTENSIONS.md).

§30 cross-stack contract for the ARN handoff: SYNTH-CONTRACT-WAF-1
(see `slices/s005-h1-waf/acceptance.md`).

## §39 config-follows-resource: WAFv2 grant ordering

The deploy-role WAFv2 and CloudFront grants (staged in DEPLOY_ROLE_EXTENSIONS.md)
MUST be applied BEFORE the WAF stacks deploy. Correct order:

```
1. Engineer adds Wafv2Manage + CloudFrontSetWebAcl statements to
   oxo-online-oidc-stack.ts in the deployRole definition.
2. make -C work/oxo-online/src/infra deploy-oidc   ← apply OIDC change FIRST
3. CDK bootstrap us-east-1 (if not already done — see below)
4. Infra pipeline runs: OxoOnlineWafUsEast1 → OxoGameProd → OxoOnlineProd
```

If step 4 runs before step 2, CloudFormation fails with AccessDenied on
`wafv2:CreateWebACL` / `cloudfront:UpdateDistribution` — the §39 reversal
failure mode. Fix the schedule, not the pipeline.

## us-east-1 CDK bootstrap requirement (s005-h1)

`OxoOnlineWafUsEast1` deploys to `us-east-1`. CDK bootstrap must exist in
us-east-1 before the infra pipeline can deploy that stack. As of 2026-06-06
**us-east-1 bootstrap is ABSENT** (CDKToolkit stack not found). Run this
one-time manual step before the first infra pipeline run for s005-h1:

```bash
npx cdk bootstrap aws://817047731316/us-east-1 \
  --trust 817047731316 \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess \
  --profile dev-int
```

This is the same trust pattern used for eu-west-2 bootstrap (oxo-infra-deploy
role assumes the CDK bootstrap roles). No new IAM role is created; the existing
CDK bootstrap pattern is extended to the second region.

## Why OxoGameProd must deploy before OxoOnlineProd

`OxoOnlineProd` adds a `/api/*` CloudFront cache behaviour whose origin is the
HTTP API invoke domain. That domain is an output of `OxoGameProd`. CDK resolves
cross-stack references at synth time as CloudFormation exports/imports, which means
CloudFormation itself enforces the ordering: a stack that imports a value cannot
complete while the exporting stack has not yet created that export.

If you deploy `OxoOnlineProd` before `OxoGameProd` on the first run, CloudFormation
will fail with "Export OxoGameProd-HttpApiEndpoint does not exist." Always deploy
`OxoGameProd` first.

**Slice 005 note:** The new WS API resources (`oxo-ws-fn`, `Connections` table,
`OxoGameProd-WsApiEndpoint` CfnOutput) are ALL inside `OxoGameProd`. `OxoOnlineProd`
does NOT import the WS endpoint — the SPA connects directly to the WSS URL via
runtime config injection (see below). Therefore the sequential deploy order is
unchanged and no new cross-stack CloudFormation dependency is introduced.

The pipeline command reflects this order:

```
npx cdk deploy OxoGameProd --require-approval never   # step 1
npx cdk deploy OxoOnlineProd --require-approval never  # step 2 (separate step — not batch)
```

CDK/CloudFormation honours the positional order and the cross-stack dependency graph.
The stacks are deployed as **separate sequential pipeline steps** (not a single
`cdk deploy A B` batch) because batch mode deploys concurrently and the export does
not exist on first deploy (v14 §19 checklist item).

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

## Lambda code-deploy ownership (slice 005 — OI-24 resolution)

**All Lambda code deploys are owned exclusively by `infra-oxo-online.yml` (CDK
`fromAsset`).**

The `deploy-oxo-online.yml` (app pipeline) no longer deploys Lambda code. The
hot-swap steps were removed in slice 005 for three reasons:

1. The hot-swap step zipped raw TypeScript source — un-runnable in Lambda (Node.js
   executes compiled JS from `dist/`).
2. Both pipelines triggered on `work/oxo-online/src/lambda/**`, creating a
   dual-trigger race: the CDK deploy (correct compiled asset) and the hot-swap
   (raw TypeScript) could overwrite each other mid-deploy.
3. CDK `fromAsset` already correctly builds and deploys Lambda code on every infra
   push. The hot-swap was duplicative and wrong.

The `src/lambda/**` path filter has been removed from `deploy-oxo-online.yml`.
Lambda changes now exclusively trigger `infra-oxo-online.yml`.

The GitHub Actions variables `OXO_ONLINE_LAMBDA_FUNCTION_NAME` and
`OXO_ONLINE_WS_LAMBDA_FUNCTION_NAME` are no longer used by any pipeline and can
be removed from the repository variables at next maintenance.

---

## Slice 005 — new CfnOutputs in OxoGameStack

Add these outputs to `OxoGameStack` (alongside the existing `HttpApiEndpoint` and
`LambdaFunctionName` outputs). All are additive — the s004 export-ordering lesson
(never remove/rename an export another stack imports) applies: these are new and not
imported by `OxoOnlineProd`.

```typescript
// WebSocket API endpoint — consumed by the deploy pipeline for runtime config injection.
// NOT imported by OxoOnlineProd (no new CFN cross-stack dependency).
new cdk.CfnOutput(this, 'WsApiEndpoint', {
  value: webSocketApi.attrApiEndpoint + '/prod',  // wss://<id>.execute-api.<region>.amazonaws.com/prod
  exportName: 'OxoGameProd-WsApiEndpoint',
  description: 'WebSocket API WSS invoke URL — read by deploy pipeline for SPA runtime config',
});

// WS function name — set as GitHub Actions variable OXO_ONLINE_WS_LAMBDA_FUNCTION_NAME.
new cdk.CfnOutput(this, 'WsLambdaFunctionName', {
  value: wsFn.functionName,          // 'oxo-ws-fn' (fixed functionName prop)
  exportName: 'OxoGameProd-WsLambdaFunctionName',
  description: 'WS Lambda function name — set as GH var OXO_ONLINE_WS_LAMBDA_FUNCTION_NAME',
});
```

---

## wss URL injection mechanism (slice 005)

**Chosen mechanism: deploy-time CloudFormation describe-stacks → S3 config.js**

The SPA cannot know the API Gateway WebSocket URL at build time (it contains the
API ID, which is determined by CDK/CloudFormation). The chosen approach:

1. After deploying the SPA to S3, the `deploy-oxo-online.yml` pipeline calls:
   ```
   aws cloudformation describe-stacks --stack-name OxoGameProd
   ```
   and extracts `OxoGameProd-WsApiEndpoint` from the stack outputs.

2. It writes a minimal JS file to `/config.js` on the S3 bucket:
   ```js
   window.OXO_CONFIG={"wsUrl":"wss://<api-id>.execute-api.<region>.amazonaws.com/prod"};
   ```
   with `Cache-Control: no-cache` so browsers always fetch the latest value.

3. The SPA's `index.html` includes `<script src="/config.js"></script>` **before**
   the main bundle, so `window.OXO_CONFIG` is defined when the app initialises.
   The engineer wires this in the SPA HTML template.

**Why this mechanism over alternatives:**

| Alternative | Why not chosen |
|-------------|---------------|
| Vite build-time env var (`VITE_WS_URL`) | Requires the infra pipeline to trigger the app pipeline (coupling); URL only known after CDK runs |
| SSM Parameter Store | Requires a new `ssm:PutParameter` in OxoGameStack and `ssm:GetParameter` in the deploy role; more moving parts for no benefit |
| CloudFront Lambda@Edge rewrite | Far too complex; CloudFront does not proxy WebSocket connections; not needed |
| CfnOutput import into OxoOnlineProd | Would create a new hard CFN cross-stack dependency; s004 export-ordering lesson advises against new import coupling |

**IAM:** The `oxo-deploy` role needs `cloudformation:DescribeStacks` on
`arn:aws:cloudformation:*:<account>:stack/OxoGameProd/*`. See DEPLOY_ROLE_EXTENSIONS.md.

**Graceful degradation:** If the CloudFormation call fails or the output is absent
(e.g., before `OxoGameProd` has been deployed with WS resources), the pipeline
writes `wsUrl: ""` and logs a warning. The SPA must handle a missing/empty `wsUrl`
by showing a readable error on the join screen ("Service unavailable — try again
later") rather than a white-screen crash. The engineer wires this guard in the SPA.
