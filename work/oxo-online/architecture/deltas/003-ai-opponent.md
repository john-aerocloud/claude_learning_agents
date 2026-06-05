# Delta 003 — Single-player vs AI (Chunk 3)

## Decision: architecture-lite — client-only, zero infra change
Slice 003 is pre-tagged **[C2-3] = client-only, no backend** in `current.md`. The
tag still holds: the AI runs **entirely in the browser** as a pure module, plugged
into the existing `GameRoot` state machine from slice 002. No new data flow, no new
principal, no new infrastructure. Lite path (process v11 §21) applies; auto-accept.

## What changes (application only)
- **AI module** — a pure, framework-free minimax function over the existing
  `GameState`/`Cell` types from `src/app/src/game/engine.ts`. Given a board state it
  returns the optimal move index for O. No I/O, no DOM, no network, no globals.
- **Mode selector** — a UI control on the initial board view to choose
  "vs Computer" vs the existing two-player default. In single-player mode the human
  is X and the AI plays O after each human move; "Play again" stays in the chosen mode.

The AI is composed with the existing engine (`applyMove`, win/draw detection, reset)
— no engine rewrite. `GameRoot` calls the AI to produce O's move when in vs-Computer
mode.

## What does NOT change
- **Infrastructure:** no S3 bucket, CloudFront, Route 53, or ACM change. Same
  bucket, same distribution, same domain.
- **Pipeline:** no GitHub Actions change beyond shipping the new bundle through the
  existing build/upload/invalidate path.
- **IAM:** no role, policy, or trust change. `oxo-cf-oac` and `oxo-deploy` untouched.
  No new principals.
- **Two-player mode (slice 002):** untouched — the default path is preserved.
- **Still absent (C4+):** API Gateway, Lambda, DynamoDB, WAF, VPC. No data leaves
  the browser.

## Security review (lite)
The AI is local computation over the in-tab board. It adds no endpoint, no request,
no persistence, no principal. The rendered value set stays closed to {X, O, null};
no user-supplied text is introduced (mode selector is a fixed control, not free
input). React default JSX interpolation is used; `dangerouslySetInnerHTML` must not
be introduced.

**Conclusion: no new attack surface, no new data flow, no new trust boundary.**
No per-infra security note files are added (no new infrastructure). The two checkable
application controls from delta 002 still hold and are carried into this slice's
`acceptance.md`:
1. Rendered cell set is closed to {X, O, null}; `dangerouslySetInnerHTML` absent.
2. No outbound network request during gameplay (including AI move computation).
