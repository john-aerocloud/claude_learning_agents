# Principle deviation — Azure-native platform instead of AWS-by-default

- **Date:** 2026-07-11
- **Agent:** solution-architect (recorded by orchestrator)
- **Project:** ROC
- **Principle:** Default to AWS Well-Architected; Azure only *by exception*
  with justification (per the `aws-architecture` / `azure-architecture` skills).

## Deviation

ROC's entire pipeline is built on Azure, not AWS: the append-only log is Azure
Event Hubs (not Kinesis), compute is Azure Functions / Durable Functions (not
Lambda), the alert-state store is Cosmos DB (not DynamoDB), secrets are in Key
Vault (not Secrets Manager), and IaC is Bicep (not CDK). No AWS services are
used for event data at all. See `work/ROC/architecture/deltas/002-azure-native-topology.md`.

## Justification

Two forcing reasons, both external and non-negotiable:
1. **Contractual data-residency mandate (governing constraint, 2026-07-11):**
   all events and data for this project MUST stay within Azure. This overrides
   architectural preference and rules out any AWS-resident store or compute for
   event data.
2. **Upstream is Azure:** the CUPPS feed is published to Azure Service Bus,
   which ROC does not own or control.

An earlier design (delta-001) had put the log in AWS (Kinesis) with a single
cross-cloud Azure→AWS bridge; the residency constraint dissolved that — and with
it the cross-cloud OIDC-federation complexity. For this project Azure is the
*mandated* platform, not a discretionary exception. The two sanctioned egresses
(ops telemetry → Dash0; PPSM Alert fields → Jira Cloud) are human-confirmed.

## Reversal condition

If the data-residency contract is lifted or changed, re-evaluate against the
`aws-architecture` skill (AWS-by-default). The delta-002 topology lists
per-service reversal conditions (Event Hubs Standard→Premium→Dedicated;
Functions Consumption→Elastic Premium; Cosmos serverless→Table Storage/Azure
SQL). This deviation is also recorded in `work/ROC/decision-log.md`
(2026-07-11 governing-constraint row) and should get an `azure-architecture`
§7 reversal-log row when that skill is next touched.
