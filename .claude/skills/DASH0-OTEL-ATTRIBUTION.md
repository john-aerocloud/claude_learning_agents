# Dash0 OpenTelemetry agent skills — attribution

The skills `otel-instrumentation`, `otel-collector`, `otel-ottl`, and
`otel-semantic-conventions` are pulled verbatim from **dash0hq/agent-skills**
(https://github.com/dash0hq/agent-skills), maintained by Dash0, licensed
Apache-2.0 (per-skill `license:` in each SKILL.md frontmatter; some MIT). Pulled
2026-06-17 for OagEventSource's OTLP observability work and as reusable
agent-system capability. Vendor-neutral (any OTLP backend); they teach the agents
to EMIT high-quality OpenTelemetry — they are NOT Dash0-platform config.

NOT included (gated / org-specific — still open as vision VERIFY #4/#5): the
Dash0 OTLP **ingestion endpoint + auth token for this org** (pattern is public:
`https://ingress.<region>.aws.dash0.com` + `/v1/{traces,metrics,logs}`, e.g.
`eu-west-1`; the org's region + an Ingesting-scoped authToken come from the
authenticated Dash0 account), the Dash0 **read API** (`POST /api/logs` filter
schema), the **webhook notification payload**, and the **target ticketing system**.
Those live behind `app.dash0.com` (login-gated) — supply from the account, or I
can build a Dash0-platform reference skill from the public `dash0.com/documentation`.
