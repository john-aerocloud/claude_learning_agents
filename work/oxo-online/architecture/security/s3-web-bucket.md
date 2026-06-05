# Security controls — S3 web bucket (SPA hosting)

Introduced: Chunk 1. Data class: **public web assets** (no PII, no secrets).

Checkable controls (source for policy test cases):
- [ ] S3 Block Public Access is ON for all four settings; bucket has no public
      ACL or public bucket policy.
- [ ] The only principal allowed `s3:GetObject` is the CloudFront Origin Access
      Control (OAC) for this distribution; the policy is scoped to this bucket
      ARN only.
- [ ] A direct HTTPS request to the bucket/object URL (no CloudFront) returns
      403.
- [ ] Default encryption at rest is enabled (SSE-S3 or SSE-KMS).
- [ ] Bucket policy denies any request where `aws:SecureTransport = false`.
- [ ] Versioning enabled (rollback of a bad SPA deploy).
- [ ] No write permission for any principal except the `oxo-deploy` role.
