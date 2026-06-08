# Security controls — CloudFront distribution

Introduced: Chunk 1. Data class: **public web delivery** (serves the SPA; from
C4 also proxies /api and /ws).

Checkable controls:
- [ ] Viewer protocol policy = redirect-to-HTTPS (no plaintext HTTP served).
- [ ] Minimum TLS = TLSv1.2_2021 or stronger on the viewer side.
- [ ] Origin access to S3 is via OAC only; the S3 origin is not a public website
      endpoint.
- [ ] Default root object set (index.html); SPA error responses (403/404 ->
      index.html, HTTP 200) so client-side routes resolve.
- [ ] From C4: WAF web ACL attached with a rate-based rule (per-IP request cap)
      to throttle anonymous abuse of /api and /ws.
- [ ] Security response headers set (HSTS, X-Content-Type-Options,
      Content-Security-Policy) via response headers policy.
- [ ] Access logging enabled to a separate, locked-down log bucket.

## s009 (delta 010) — `/api/leaderboard` cache behaviour
A NEW cache behaviour for `GET /api/leaderboard`. Checkable controls:
- [ ] `/api/leaderboard` behaviour has `min/default/maxTTL = 5s` (NOT
      `CachingDisabled`) — collapses title-screen loads to one origin fetch per
      5s window; meets SM-1's "within 10s" (5s cache + sub-1s stream propagation).
      Synth-assert the TTL.
- [ ] `POST /api/games` behaviour stays `CachingDisabled` (writes must never
      cache) — unchanged; the 5s TTL applies ONLY to the leaderboard read path.
- [ ] The existing WAF rate rule and security response headers (HSTS, CSP,
      X-Content-Type-Options) apply unchanged to the new behaviour; **no new CSP
      directive** (leaderboard names are data rendered as escaped TEXT, not
      script — delta 010 §8). The existing CSP is the stored-XSS backstop.
