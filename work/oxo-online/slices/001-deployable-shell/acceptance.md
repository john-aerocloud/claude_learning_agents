# Acceptance — Slice 001: Deployable shell

Co-authored: Product (value) + Solution Architect (technical/observable conditions).

Scope under test: a React SPA served at the production HTTPS URL via CloudFront +
S3, deployed by GitHub Actions over OIDC. No backend, DB, or WebSocket.

Conventions:
- `$URL` = production HTTPS URL (e.g. `https://oxo.<domain>`).
- `$BUCKET` = web bucket name; `$DIST_ID` = CloudFront distribution id.
- Each AC is automatable via curl, AWS CLI, or a Playwright smoke test against
  the live URL. "Smoke" tests run against the deployed environment, not local.

---

## AC-1 — HTTPS URL is live with a valid TLS cert and no mixed content
**Given** the stack is deployed
**When** a client requests `$URL`
**Then** it returns HTTP 200 with the React shell, over a publicly-trusted TLS
certificate, and the page loads no `http://` sub-resources.

Automatable checks:
- `curl -sS -o /dev/null -w "%{http_code}" $URL` returns `200`.
- `curl -sS $URL` body contains the SPA root element (e.g. `<div id="root">`).
- TLS chain validates without `-k`: `curl -sS --fail $URL` exits `0`; cert is not
  self-signed and CN/SAN matches the domain (`openssl s_client -connect <host>:443
  -servername <host> </dev/null | openssl x509 -noout -subject -issuer`).
- Negotiated protocol is TLS 1.2 or higher (`curl -sS --tlsv1.2 $URL` succeeds;
  `curl --tls-max 1.1 $URL` fails).
- Playwright: page loads with zero console errors of type `mixed-content`; assert
  no network request URL starts with `http://`.

## AC-2 — HTTP redirects to HTTPS
**Given** the distribution viewer policy is redirect-to-HTTPS
**When** a client requests the plaintext HTTP origin (`http://<host>/`)
**Then** it is redirected (301/308) to the `https://` equivalent; no content is
served over plaintext.

Automatable checks:
- `curl -sS -o /dev/null -w "%{http_code} %{redirect_url}" http://<host>/`
  returns a `301`/`308` whose `redirect_url` begins `https://<host>/`.
- Following the redirect (`curl -sSL`) lands on `200` over HTTPS.

## AC-3 — S3 bucket returns 403 to direct (non-CloudFront) requests
**Given** the bucket is private with OAC-only `s3:GetObject`
**When** a client requests the object directly via the S3 REST or website endpoint
**Then** the request is denied (403); content is reachable only through CloudFront.

Automatable checks:
- `curl -sS -o /dev/null -w "%{http_code}" https://$BUCKET.s3.amazonaws.com/index.html`
  returns `403`.
- `aws s3api get-public-access-block --bucket $BUCKET` shows all four flags `true`.
- `aws s3api get-bucket-policy-status --bucket $BUCKET` reports `IsPublic=false`.
- Bucket policy contains a `Deny` when `aws:SecureTransport=false` (assert via
  `aws s3api get-bucket-policy`).

## AC-4 — SPA deep-link routing survives a refresh
**Given** CloudFront maps 403/404 error responses to `/index.html` with HTTP 200
**When** a client requests/refreshes a client-side route that has no S3 object
(e.g. `$URL/game/anything`)
**Then** the SPA shell is returned with HTTP 200 (not a 403/404), letting the
client router resolve the route.

Automatable checks:
- `curl -sS -o /dev/null -w "%{http_code}" $URL/some/deep/route` returns `200`.
- `curl -sS $URL/some/deep/route` body is the SPA shell (contains `<div id="root">`),
  not an error page.
- Playwright: `page.goto("$URL/some/deep/route")` then `page.reload()` keeps the
  app mounted (no browser 404 page).

## AC-5 — CI/CD: commit to main builds, deploys, and invalidates over OIDC (no static keys)
**Given** the GitHub Actions workflow assumes `oxo-deploy` via OIDC
**When** a commit is pushed to `main`
**Then** the workflow builds the SPA, syncs artifacts to S3, creates a CloudFront
invalidation, and the new content becomes live — using no long-lived AWS keys.

Automatable checks:
- Workflow run for the head commit completes with conclusion `success`
  (`gh run list --branch main` / `gh run view <id> --json conclusion`).
- A build-unique marker (e.g. commit SHA injected into the SPA or a
  `/build-info.json`) is served at `$URL` after the run
  (`curl -sS $URL/build-info.json` contains the deployed SHA).
- A CloudFront invalidation exists for the deploy
  (`aws cloudfront list-invalidations --distribution-id $DIST_ID` shows an entry
  created during the run).
- No static credentials: repo/workflow define no `AWS_ACCESS_KEY_ID` /
  `AWS_SECRET_ACCESS_KEY` secrets; the auth step uses
  `aws-actions/configure-aws-credentials` with `role-to-assume` + `id-token: write`
  (grep the workflow YAML). No IAM access key exists for the deploy principal
  (`aws iam list-access-keys` for any deploy user returns none / no deploy user).
- Trust policy is repo+branch scoped: `sub` condition equals
  `repo:<org>/oxo-online:ref:refs/heads/main` and `aud = sts.amazonaws.com`
  (assert via `aws iam get-role --role-name oxo-deploy`).

## AC-6 — Security response headers present
**Given** a CloudFront response-headers policy is attached
**When** a client requests `$URL`
**Then** the response carries HSTS, CSP, X-Frame-Options, and
X-Content-Type-Options.

Automatable checks (`curl -sSI $URL`):
- `Strict-Transport-Security` present with a non-zero `max-age` (and
  `includeSubDomains`).
- `Content-Security-Policy` present and non-empty.
- `X-Frame-Options: DENY` (or `SAMEORIGIN`) present.
- `X-Content-Type-Options: nosniff` present.

## AC-7 — CDK stack deploys cleanly from scratch and is idempotent
**Given** the CDK app defines the bucket, distribution, OAC, DNS, ACM cert, and
deploy role
**When** `cdk deploy` runs against a clean account/region
**Then** it completes with no errors, and a second `cdk deploy` with no source
changes reports no changes (idempotent).

Automatable checks:
- `cdk synth` exits `0` and produces a CloudFormation template.
- First `cdk deploy --require-approval never` exits `0`; stack status is
  `CREATE_COMPLETE` / `UPDATE_COMPLETE`.
- Immediately re-running `cdk deploy` (or `cdk diff`) reports "no changes" /
  empty diff (exit `0`, no resource churn).
- Post-deploy, AC-1 through AC-6 pass against the freshly deployed URL.

---

## Out of scope (must NOT be present in this slice)
- No API Gateway (HTTP or WS), Lambda, DynamoDB, or VPC resources in the stack
  (`cdk synth` template contains none of these types).
- No gameplay/backend behaviour — the shell only proves the deployment path.
