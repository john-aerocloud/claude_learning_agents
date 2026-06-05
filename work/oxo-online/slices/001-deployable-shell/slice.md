---
slice: 001-deployable-shell
chunk: 1
status: delivered
created: 2026-06-05
---

# Slice 001 — Deployable shell

## Job served

**Ambient job — reliable, always-on availability**

> When my friend and I decide to play, I want the game to just work in a browser
> with no install, no sign-up friction, and consistent uptime, so that the barrier
> to starting a game is as close to zero as possible.

This slice does not deliver gameplay. It delivers the hosting substrate that
makes all future slices available in a real browser at a real URL. The value
here is de-risking: every subsequent slice ships to a proven production
pipeline. Without this, no user can ever reach the product.

Killick's test: a user cannot yet play — but the team can now ship any future
slice to real users without discovering that the deployment path is broken
mid-iteration. The risk reduction is the outcome, and it is concrete and
observable.

## Thin scope — what IS in this slice

- React SPA (create-react-app or Vite scaffold) with a single placeholder screen
  (e.g. "OXO Online — coming soon"). No game logic.
- S3 bucket (private, OAC-only, SSE) holding the built React artifacts.
- CloudFront distribution fronting the bucket: TLS 1.2+, HTTPS redirect, SPA
  error routing (all 404s return index.html so deep-link refreshes work).
- Route 53 hosted zone + ACM certificate: DNS resolves the production domain;
  TLS terminates at CloudFront with no browser warning.
- GitHub OIDC deploy role (`oxo-deploy`) scoped to the deploy branch — no
  long-lived AWS keys in repo or CI.
- GitHub Actions workflow: on push to deploy branch — build SPA, upload to S3,
  invalidate CloudFront cache.

## Explicitly NOT in scope

- Any game logic, board rendering, or move handling.
- Backend services: no API Gateway, Lambda, DynamoDB, WebSocket, or WAF. These
  arrive no earlier than Chunk 4.
- User authentication, accounts, or session management.
- Player identity, display names, or leaderboard.
- In-game chat.
- Staging or preview environments (single prod environment only at this stage).
- Performance tuning, cache-control headers beyond CloudFront defaults.
- Mobile-specific layout or responsive polish (placeholder screen only).

## Success measures

All measures are observable by the pipeline or by a browser — no manual
inspection of internal state required.

| # | Measure | How verified |
|---|---------|--------------|
| 1 | Hitting `https://<production-domain>/` returns the React shell with a valid TLS certificate; no browser security warning is shown | Manual browser check + `curl -I` shows HTTP 200 and valid cert chain |
| 2 | HTTP requests to `http://<production-domain>/` are redirected to HTTPS (301/302) | `curl -I http://<production-domain>/` returns a 3xx redirect |
| 3 | A direct request to the S3 bucket URL (bypassing CloudFront) returns 403 — content is not publicly reachable except through the CDN | `curl -I https://<bucket>.s3.<region>.amazonaws.com/` returns 403 |
| 4 | A client-side deep-link refresh (e.g. `https://<production-domain>/game/test`) returns the SPA index, not a 404 | `curl -I https://<production-domain>/game/test` returns 200 |
| 5 | A commit pushed to the deploy branch triggers the GitHub Actions workflow, which builds, uploads, and invalidates without error — and the updated placeholder content is served within 60 seconds | GitHub Actions run shows green; new content visible in browser after invalidation |
| 6 | No long-lived AWS credentials appear in the GitHub Actions run logs or repo — OIDC assumed role is used throughout | Review Actions run: only `aws-actions/configure-aws-credentials` with role-to-assume; no `AWS_ACCESS_KEY_ID` secret |

## Acceptance criteria (co-authored with architect)

See `/work/oxo-online/slices/001-deployable-shell/acceptance.md` (authored by
Solution Architect and co-signed by Product once observable conditions above are
met).
