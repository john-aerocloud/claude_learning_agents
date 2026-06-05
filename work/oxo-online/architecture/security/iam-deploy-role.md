# Security controls — GitHub OIDC deploy role (oxo-deploy)

Introduced: Chunk 1. Data class: **deployment credentials** (no static keys).

Checkable controls:
- [ ] No IAM user or long-lived access key exists for deployment; CI assumes the
      role via GitHub OIDC web-identity federation only.
- [ ] Trust policy restricts `token.actions.githubusercontent.com:sub` to the
      specific repo AND deploy branch (e.g. `repo:<org>/oxo-online:ref:refs/heads/main`).
- [ ] Trust policy asserts `aud = sts.amazonaws.com`.
- [ ] Permissions are scoped by resource ARN: PutObject/DeleteObject on the web
      bucket only; CreateInvalidation on this distribution only; (from C4)
      UpdateFunctionCode on the named functions only.
- [ ] No `iam:*`, no `*:*`, no PassRole except to the specific function
      execution roles if needed.
- [ ] Session duration capped (e.g. <= 1 hour).
- [ ] No secrets in repo or workflow logs; AWS account id is not itself a secret
      but no credentials are printed.
