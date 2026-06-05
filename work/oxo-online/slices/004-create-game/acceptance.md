# Acceptance — Slice 004 create-game

## Functional (customer-observable)

**F1 — Play Online shows a game code**
Given a player is on the mode selector screen,
When they tap "Play Online",
Then within 3 seconds they see a "waiting for opponent" view displaying a prominent game code, and the code remains visible without any further action.

**F2 — Code is 6 characters, alphanumeric, free of ambiguous characters**
Given a game code has been issued and is displayed on screen,
Then the code is exactly 6 characters long, contains only uppercase letters and digits, and does not include any of the characters O, 0, 1, I, or L (characters that are visually ambiguous and could cause a player to misread or mistype the code).

**F3 — Code is issued within 3 seconds on a standard connection**
Given a player taps "Play Online" on a device with a standard mobile or broadband connection (not throttled),
Then the game code is visible on screen within 3 seconds of the tap. A spinner or loading indicator is shown for any wait longer than 500 ms so the player knows the request is in progress.

**F4 — Two-player local and vs-AI modes are unaffected after deploy**
Given the slice has been deployed to production,
When a player selects "Two Player (local)" or "vs Computer" from the mode selector,
Then each mode launches and plays to completion (win, loss, or draw) exactly as it did before this slice — no missing buttons, broken board state, or JavaScript errors observed.

**F5 — Backend unavailable shows a readable error without white-screening**
Given the backend is unreachable or returns a server error when "Play Online" is tapped,
Then the UI displays a short, human-readable error message (e.g. "Could not start online game — please try again"),
And the mode selector remains usable so the player can choose "Two Player (local)" or "vs Computer" without reloading the page.
The browser must not show a blank white screen or an unhandled error page.

## Technical (architecture/security policy)

**T1 — DynamoDB record shape after a successful POST**
Given a `POST /api/games` returns `201` with `{ gameId, code }`,
Then a single item exists in the `Games` table with that partition key `gameId`, `status="waiting"`, and a numeric `ttl` attribute set ~86400s (24h) ahead of the request time (within a small clock-skew tolerance).
Verifiable: `aws dynamodb get-item --table-name <Games> --key '{"gameId":{"S":"<id>"}}'` immediately after the response.

**T2 — `/api/*` CloudFront behaviour is CachingDisabled**
Given the production CloudFront distribution,
Then the `/api/*` cache behaviour uses the AWS managed `CachingDisabled` policy and never serves a cached API response (repeated identical `POST /api/games` calls return distinct `gameId`s; no `X-Cache: Hit` on `/api/*`).
Verifiable: `aws cloudfront get-distribution-config` shows the `/api/*` behaviour's `CachePolicyId` equals the managed CachingDisabled policy id.

**T3 — `oxo-game-fn` IAM policy is PutItem-on-Games-only**
Given the `oxo-game-fn` Lambda execution role,
Then its inline/attached policy grants `dynamodb:PutItem` on the `Games` table ARN only — no wildcard `Resource`, no read/query/scan, no second table — plus only its own CloudWatch log-group actions.
Verifiable: `aws iam get-role-policy` (and `list-attached-role-policies`) for the execution role.

**T4 — Pipeline deploys cleanly with no manual steps**
Given a push to the deploy branch,
Then GitHub Actions deploys `OxoGameProd` (CDK) then `OxoOnlineProd` (CDK), builds and uploads the SPA, and issues a CloudFront invalidation — all without any manual console step or out-of-band action, and the workflow run finishes green.
Verifiable: workflow run log shows CDK deploy + SPA sync + invalidation jobs succeeding end-to-end.

**T5 — Lambda reserved concurrency cap is set**
Given the `oxo-game-fn` function,
Then it has a reserved concurrency value configured greater than 0 (a finite cap, not unreserved/default).
Verifiable: `aws lambda get-function-concurrency --function-name oxo-game-fn` returns a `ReservedConcurrentExecutions` > 0.

## Security policy

**S1 — Client-supplied persisted fields are ignored; server generates all of them**
Given a `POST /api/games` whose request body supplies `gameId`, `code`, `status`, and/or `ttl`,
Then none of those client values are persisted: the stored item's `gameId`, `code`, `status`, and `ttl` are all server-generated, and the response `gameId`/`code` do not match the attacker-supplied values.
Verifiable: send a body with planted values, then `get-item` and confirm the stored fields differ and follow the server's format (UUID `gameId`, unambiguous 6-char `code`, `status="waiting"`, `ttl` ~24h ahead).

**S2 — `oxo-deploy` role extension contains no IAM-mutation actions**
Given the extended `oxo-deploy` role,
Then its effective permissions do NOT include `iam:CreateRole`, `iam:AttachRolePolicy`, or `iam:PutRolePolicy` (role creation is performed by the CDK CloudFormation execution role under bootstrap trust, not by `oxo-deploy`).
Verifiable: inspect the role's policies (`get-role-policy` / `list-attached-role-policies`) and confirm none of those three actions are granted on any resource.

**S3 — `Games` table has no public access; reachable only via the Lambda execution role**
Given the `Games` DynamoDB table,
Then it exposes no public/anonymous access path: there is no resource-based policy granting `Principal:*`, the endpoint is the regional DynamoDB service endpoint (not internet-exposed independently), and the only principal with data-plane access is the `oxo-game-fn` execution role. Encryption at rest is enabled (SSE).
Verifiable: confirm no table resource policy granting public principals, and that no role other than `oxo-game-fn` holds `dynamodb:*`/`PutItem`/read on the `Games` ARN.
