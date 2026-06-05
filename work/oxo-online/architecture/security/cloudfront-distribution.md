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
