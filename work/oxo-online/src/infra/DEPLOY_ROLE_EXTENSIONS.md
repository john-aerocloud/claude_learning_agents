# Deploy role extensions required for slice 004

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
