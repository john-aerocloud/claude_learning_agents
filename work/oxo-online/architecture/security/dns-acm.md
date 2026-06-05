# Security controls — Route 53 + ACM (domain & TLS)

Introduced: Chunk 1. Data class: **public DNS / TLS material**.

Checkable controls:
- [ ] ACM certificate covers the served domain and is issued in us-east-1 (for
      CloudFront).
- [ ] Certificate validated via DNS (CNAME) and set to auto-renew.
- [ ] CloudFront uses this ACM cert; no self-signed or default *.cloudfront.net
      cert serving the production domain.
- [ ] Route 53 alias record points to the CloudFront distribution only.
- [ ] No wildcard cert broader than needed; private keys are AWS-managed (never
      exported).
