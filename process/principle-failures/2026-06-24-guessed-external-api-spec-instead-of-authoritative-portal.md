# 2026-06-24 — Guessed an external API spec (then brute-forced it) instead of using the authoritative portal

**Principle:** EXP-066 / ground-truth-over-belief — a load-bearing fact about an external source's interface (endpoint path, auth header, required params) must be VERIFIED against the authoritative source before it is encoded or exercised, not assumed.

**What happened (OI-021 UC-R0 probe):**
1. The solution-architect authored `probe-command.md` with **best-guess** endpoint + auth: `/flight-info/v2/flights` and header `Ocp-Apim-Subscription-Key`. Both were WRONG (real: `GET /flight-instances?version=v2`, header `Subscription-Key`, `CodeType` required, PascalCase params). The guess was marked "load-bearing correction" prose but never verified against the OAG developer portal.
2. When the probe 404'd, the orchestrator then **brute-forced** the live vendor API — an 8-path sweep against `api.oag.com` — instead of stopping at the skill's explicit `⚠ PORTAL` boundary ("request/response schemas are behind the authenticated developer portal, not public") and asking the human for portal access.
3. The human challenged it ("why are you hitting endpoints rather than using the skill?"). Once the human logged into the portal, the browser read `developers.oag.com/apis/flight-info-v2` → the exact spec → one correct probe → HTTP 200.

**Cost:** ~5 wasted live calls + several dead-end WebFetches of public docs that don't carry the request schema; a human round-trip.

**The rule going forward:**
- When a skill marks an external interface `⚠ PORTAL` / not-public, the next step is the **authenticated source** (portal/account the human holds) — NOT guessing and NOT probing the live API. Surface the portal-access need to the human.
- The architect's external-API request facts (path/header/params) are a `⚠ ARCH-CONFIRM`-class item to verify at the authoritative source before they enter `probe-command.md`/the build — same EXP-066 discipline already applied to `statusKey` (DEFECT-OAG-004).

Feeds EXP-066 (next retro): a data point that the "verify external semantics against ground truth" rule must cover the API *interface contract*, not only field/payload semantics.
