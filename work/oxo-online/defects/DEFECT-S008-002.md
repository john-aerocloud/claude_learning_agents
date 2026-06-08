# DEFECT-S008-002 — copy control copies the URL when the user expects the code

- **Expected:** clicking copy by the game CODE copies the code (to share/type).
- **Actual:** it copies the share URL (`origin + /join/ + code`), not the code.
- **Intent:** share the game with a friend who will join.
- **Importance:** MEDIUM — share/join friction; the joiner who TYPES the code gets the wrong thing copied.

**Confirmed:** code root-cause — `GameRoot.tsx` s008 UC1 copy handler copies `window.location.origin + "/join/" + code`. There is one copy affordance and it serves the link-path while sitting by the code.
**Root cause (process):** the multi-party share flow was modelled from the SHARER's side only; the RECEIVING party has two join paths (type the code / click the link) and the affordance served one while reading as the other. **Gap → EXP-015** (multi-party modelling).
**§5a class:** our defect (affordance/UX). **Needs product ruling:** copy-code, copy-link, or BOTH (both serve real joiner paths).
**Priority:** fix in the s009 window (s009 touches the same create/join screens for name-entry — natural to fix the affordance there) OR now; orchestrator to sequence.

## Product ruling (human, 2026-06-08)
TWO controls: "Copy code" (copies the 6 chars — for a joiner who will TYPE it) AND "Copy link" (copies /join/<code> — for one-click join). Serves both receiving-party paths explicitly (the §12b multi-party model). FOLDED INTO s009 build (same create/waiting screens as name-entry); added as an s009 acceptance case. Closes via s009 delivery.

## CLOSED 2026-06-08 (sha 1c49c28, via s009)
Two copy controls live in prod: copy-code-btn copies the 6-char code, copy-link-btn copies the /join URL (D1-5 pass, confirmed via navigator.clipboard.readText). Gap-closing experiment EXP-015 (multi-party modelling) exercised by s009's §12b sync-point table — scored at the s009 retro.
