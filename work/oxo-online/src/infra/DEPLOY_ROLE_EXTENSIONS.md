# Deploy role extensions — oxo-online

The `oxo-deploy` role (created in `OxoOnlineOidcStack`) currently has:
- S3 read/write on the web bucket
- `cloudfront:CreateInvalidation`
- CDK diff/deploy helpers (CloudFormation, SSM, S3 staging bucket)
- IAM read-only

For slice 004, the `deploy-oxo-online.yml` pipeline gains a Lambda code update
step (`aws lambda update-function-code`). The following permissions must be added
to the `oxo-deploy` role.

## Permissions to add

Add these statements to `OxoOnlineOidcStack` (`lib/oxo-online-oidc-stack.ts`) in
the `deployRole` definition. The engineer wires this when they implement the
Lambda in `OxoGameStack`.

```typescript
// Lambda code deploy — scoped to the single game function ARN.
// UpdateFunctionCode is the only action needed for CI/CD hot-swap.
// GetFunction is used to verify the update completed successfully.
// No iam:* actions; the Lambda execution role is managed by CDK/CloudFormation.
deployRole.addToPolicy(
  new iam.PolicyStatement({
    sid: 'LambdaCodeDeploy',
    effect: iam.Effect.ALLOW,
    actions: [
      'lambda:UpdateFunctionCode',
      'lambda:GetFunction',           // health-check: confirm update applied
    ],
    resources: [
      // Scoped to the specific function ARN — no wildcard.
      // The function lives in the same account and region as the rest of the stack.
      `arn:aws:lambda:*:${deployRole.stack.account}:function:oxo-game-fn`,
    ],
  }),
);
```

## Why these permissions, not broader ones

| Action | Reason |
|--------|--------|
| `lambda:UpdateFunctionCode` | Required by `aws lambda update-function-code` in the pipeline |
| `lambda:GetFunction` | Allows the pipeline (or a health-check step) to confirm the new code is active before running smoke tests |
| NOT `lambda:UpdateFunctionConfiguration` | Configuration changes (env vars, memory, timeout) are infra changes and go through CDK/CloudFormation, not the app pipeline |
| NOT `lambda:CreateFunction` / `lambda:DeleteFunction` | Function lifecycle is owned by CDK, not the deploy pipeline |
| NOT `lambda:AddPermission` / `lambda:RemovePermission` | IAM-adjacent; not needed for code updates |
| NOT `iam:*` | The Lambda execution role is created by the CDK CloudFormation execution role under the bootstrap trust, not by `oxo-deploy` directly |

## When to apply

1. The engineer adds `LambdaCodeDeploy` policy statement to `oxo-online-oidc-stack.ts`.
2. The infra pipeline deploys `OxoOnlineOidcStack` (manual step — this stack is
   excluded from the automated pipeline to avoid re-creating the OIDC provider).
   Run: `make deploy-oidc` from `work/oxo-online/src/infra` locally.
3. After the role is updated, set the GitHub Actions variable
   `OXO_ONLINE_LAMBDA_FUNCTION_NAME` to the function name output from `OxoGameProd`.
4. The `deploy-oxo-online.yml` pipeline will then be able to call
   `lambda:UpdateFunctionCode` when `work/oxo-online/src/lambda/**` changes.

## Rollback note

`lambda:UpdateFunctionCode` is reversible. Lambda maintains previous code versions
when versioning is enabled (to enable: set `currentVersionOptions` on the CDK
`Function` construct). To roll back: re-deploy the prior Lambda package or trigger
the pipeline from the prior commit.

If Lambda versioning is not enabled (the slice 004 default), roll forward by
pushing a corrected commit — the pipeline will overwrite the function code.

---

# Deploy role extensions required for slice 005

## New permissions needed

### 1. oxo-ws-fn Lambda code deploy (same pattern as oxo-game-fn)

Add a second `LambdaCodeDeploy` statement scoped to `oxo-ws-fn`:

```typescript
// Lambda code deploy — scoped to the WS function ARN (slice 005).
// Same pattern as oxo-game-fn above; separate statement keeps each scope explicit.
deployRole.addToPolicy(
  new iam.PolicyStatement({
    sid: 'WsLambdaCodeDeploy',
    effect: iam.Effect.ALLOW,
    actions: [
      'lambda:UpdateFunctionCode',
      'lambda:GetFunction',
    ],
    resources: [
      // Scoped to the specific WS function ARN — no wildcard.
      `arn:aws:lambda:*:${deployRole.stack.account}:function:oxo-ws-fn`,
    ],
  }),
);
```

### 2. CloudFormation DescribeStacks (for wss URL injection)

The `deploy-oxo-online.yml` pipeline fetches the `OxoGameProd-WsApiEndpoint`
CloudFormation output at deploy time to write the runtime config. The `oxo-deploy`
role needs read access to that stack's outputs:

```typescript
// Allow reading OxoGameProd outputs so the deploy pipeline can inject
// the wss URL into the SPA runtime config (config.js on S3).
// cloudformation:DescribeStacks is already present on the CDK helpers policy;
// add an explicit scoped statement here for clarity and auditability.
deployRole.addToPolicy(
  new iam.PolicyStatement({
    sid: 'ReadGameStackOutputs',
    effect: iam.Effect.ALLOW,
    actions: [
      'cloudformation:DescribeStacks',
    ],
    resources: [
      `arn:aws:cloudformation:*:${deployRole.stack.account}:stack/OxoGameProd/*`,
    ],
  }),
);
```

## When to apply (slice 005)

1. The engineer adds `WsLambdaCodeDeploy` and `ReadGameStackOutputs` policy
   statements to `oxo-online-oidc-stack.ts` in the `deployRole` definition.
2. Redeploy `OxoOnlineOidcStack` manually (this stack is excluded from the
   automated pipeline):
   ```
   make -C work/oxo-online/src/infra deploy-oidc
   ```
3. After the infra pipeline deploys `OxoGameProd` with the new WS resources,
   copy the `WsLambdaFunctionName` CfnOutput value into the GitHub Actions
   variable `OXO_ONLINE_WS_LAMBDA_FUNCTION_NAME`.
4. The `deploy-oxo-online.yml` pipeline will then be able to:
   - Call `lambda:UpdateFunctionCode` on `oxo-ws-fn` when `src/lambda/**` changes.
   - Fetch the `OxoGameProd-WsApiEndpoint` output and write `/config.js` to S3.

## Why no `iam:*` actions

The `oxo-ws-fn` execution role is created by CDK/CloudFormation under the CDK
bootstrap execution role. The `oxo-deploy` role only needs to push code to an
existing function — it never creates, modifies, or attaches IAM roles. This
preserves the principle that the deploy pipeline cannot escalate its own IAM
privileges.
