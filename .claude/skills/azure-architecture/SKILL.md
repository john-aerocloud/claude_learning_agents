---
name: azure-architecture
description: Azure Well-Architected reference for the AWS-by-default team's Azure EXCEPTION cases (a mandated Azure service or a cross-cloud bridge into AWS). Covers subscription/tenant config, IaC choice, the messaging/eventing decision tree (Service Bus / Event Hubs / Functions), cross-cloud identity federation with no long-lived secrets, security controls by resource type, cost notes at scale, and reversal conditions. Load this before producing any Azure design, Bicep/Terraform, RBAC policy, or IaC.
---

# Azure Architecture — Working Reference (the EXCEPTION path)

**Team posture: AWS Well-Architected by DEFAULT, Azure by EXCEPTION.** Prefer
AWS unless there is a real, named forcing reason — e.g. an upstream system that
only publishes to Azure, a customer/regulator mandate, or an existing Azure
estate we are integrating with. "It would be nice" or "we already know Azure" is
NOT a reason. If you reach for Azure, name the forcing constraint in the delta.
Azure is not co-equal with AWS here; this skill exists to make the exception
correct and cheap to reverse, not to normalise it.

Defaults below are for this team. Deviate only with justification; log deviations
in `/process/principle-failures/`. Reversal conditions are listed per decision so
the delta is cheap when requirements change. Backed by the **Azure Well-Architected
Framework** (Reliability, Security, Cost Optimization, Operational Excellence,
Performance Efficiency).

---

## 0. Read the Azure subscription/tenant config first

Before any `az` CLI or Azure SDK operation, resolve the target context. The AWS
side reads `.claude/config/aws-profile`; there is **no Azure equivalent yet**
(see the setup-gap note at the bottom of this section).

1. Authenticate: `az login` (interactive browser) — or, in CI, workload identity
   federation / OIDC (never a client secret; §4).
2. Select the subscription: `az account set --subscription <sub-id>`.
3. Confirm tenant + subscription: `az account show` (verify `tenantId`,
   `id`/subscription, and `user`).
4. Default region and resource-group naming come from the project delta until a
   config convention exists.

**SETUP GAP (flag to orchestrator):** there is currently no established Azure
profile/config convention in this repo — `.claude/config/` holds only
`aws-profile`. Until one exists, the subscription id, tenant id, default
resource group, and default region must be stated explicitly in the project's
`/work` delta rather than assumed. A future `.claude/config/azure-profile` (and
an `/azure-profile` command mirroring `/aws-profile`) would hold:
`tenantId`, `subscriptionId`, `defaultResourceGroup`, `defaultLocation`. Do NOT
invent one here — surface it as a decision for the orchestrator.

---

## 1. IaC default: Terraform (`azurerm` provider)

**Team preference (2026-07-11): Terraform is the preferred IaC tool.** Use it
for Azure work by default.

- **Default: Terraform with the `azurerm` (+ `azapi` where coverage lags)
  provider.** One tool/language across clouds, mature Azure coverage, and a
  single `terraform plan` gate. Layout: one root module per environment under
  `infra/terraform/`, shared resources factored into modules, env-parameterised
  via `*.tfvars`.
- **Remote state (required):** backend in an **Azure Storage account with state
  locking** (blob lease). Under a data-residency mandate the state — which can
  contain resource metadata — **stays in the same Azure tenant/region** as the
  workload; never a cross-cloud or external state backend. Enable versioning +
  soft-delete on the state container.
- **Reversal → Bicep:** only for a genuinely throwaway, single-service Azure
  spike where standing up a Terraform state backend isn't worth it, or a team
  explicitly standardised on Bicep. First-party, no state file (ARM is the
  state), `az deployment group what-if` built in — but it is Azure-only and
  does not carry across clouds, so it is the exception, not the default.
- **Never:** hand-written ARM JSON (verbose, no type help); portal ClickOps for
  anything persistent (undocumented, unreproducible).

Preview every change with `terraform plan` before `apply` (the `cdk diff`
equivalent); `az deployment group what-if` only on the Bicep reversal path.

---

## 2. Messaging / eventing decision tree (most important section)

Pick the transport by the SHAPE of the traffic, not by familiarity.

```
Is it a high-throughput, ordered, replayable STREAM of events
(telemetry/log/click firehose, many events/sec per source, consumers
that checkpoint and may replay)?
  Yes → Azure Event Hubs (partitioned log; Kafka-compatible)
  No  →
    Is it discrete MESSAGES needing per-message reliability
    (commands, work items, request/response, transactions, ordering
    per entity, dead-lettering, scheduled/deferred delivery)?
      Yes → Azure Service Bus
    Is it lightweight pub/sub of discrete reactive events
    (resource-changed notifications, CloudEvents fan-out, no replay)?
      Yes → Azure Event Grid (mentioned for completeness; not a focus)
```

Rule of thumb: **Service Bus = mailbox (each message matters, ack/retry/DLQ);
Event Hubs = tape (stream position matters, replay by offset).**

### Azure Service Bus
- **Queues** (1:1, competing consumers) vs **Topics + Subscriptions** (1:many
  pub/sub with per-subscription SQL/correlation filters). Default to a **topic**
  the moment a second independent consumer is plausible — retrofitting a queue to
  a topic is a breaking change to producers.
- **Sessions:** enable when you need FIFO / ordered processing grouped by a key
  (e.g. per-aggregate ordering). A session locks all messages of a `SessionId` to
  one consumer. Costs throughput parallelism — use only when order is required.
- **Duplicate detection:** enable on the entity with a dedup window (default
  ~10 min) keyed on `MessageId`; makes producers idempotent-safe on retry.
  Premium-friendly; has a storage/throughput cost — size the window to the real
  retry horizon, no larger.
- **Dead-lettering:** every queue/subscription has a DLQ. Set `MaxDeliveryCount`
  (default 10) and monitor DLQ depth — a rising DLQ is the primary poison-message
  signal. Have an explicit DLQ drain/replay story before go-live.
- **Receive mode:** default **Peek-Lock** (at-least-once: lock → process →
  complete; abandon/expire returns the message). Use **Receive-and-Delete** only
  for idempotent, loss-tolerant fire-and-forget. Set **lock duration** ≥ p99
  processing time (max 5 min; renew the lock for longer work rather than raising
  it blindly).
- **Standard vs Premium:**
  - **Standard** — shared multi-tenant capacity, pay-per-operation, no capacity
    floor. Default for low/spiky volume and dev.
  - **Premium** — dedicated **Messaging Units (MU)** (1/2/4/8/16), predictable
    latency, VNet/private-endpoint support, larger messages (up to 100 MB),
    higher throughput. Required when you need network isolation, steady high
    throughput, or noisy-neighbour immunity. **Reversal → Premium** when p99
    latency jitter, throttling (HTTP 429/`ServerBusy`), or the private-endpoint
    security requirement appears.
- Cost shape: Standard bills per operation (cheap when idle, grows linearly with
  message count); Premium bills per MU-hour regardless of load (cheap per message
  at sustained high volume, wasteful when idle).

### Azure Event Hubs
- **Kafka-compatible** endpoint — Kafka producers/consumers work unchanged, so an
  upstream Kafka system can publish without a rewrite (a common forcing reason to
  be on Azure at all).
- **Partitions** set the max parallelism of consumption and are **fixed at
  create** on non-dedicated tiers — over- rather than under-provision (e.g. 8–32)
  because you cannot repartition later without a new hub. Choose a partition key
  that spreads load AND preserves the ordering you need (order is per-partition
  only).
- **Consumer groups + checkpointing:** each independent reader gets its own
  consumer group and tracks its offset via a **checkpoint store** (Azure Blob
  Storage). Checkpointing is the consumer's responsibility — at-least-once with
  possible reprocessing after a crash; design consumers idempotent.
- **Capture:** point-and-click archival of the stream to Blob/Data Lake (Avro) —
  turn on for cheap durable landing / replay / audit instead of writing a
  consumer to do it.
- **Prefer Event Hubs over Service Bus** when: throughput is high and linear,
  consumers need replay by offset, multiple independent consumer groups read the
  same stream, or a Kafka producer already exists upstream. **Prefer Service Bus**
  when each message needs individual ack/retry/DLQ, ordering-per-entity via
  sessions, scheduled/deferred delivery, or transactional semantics.
- Tiers: **Basic** (1 consumer group, no Capture), **Standard** (up to 20 groups,
  Capture, Kafka), **Premium**/**Dedicated** (isolation, higher throughput,
  longer retention). Default **Standard** until isolation/retention forces up.

### Azure Functions (the compute glue)
- **Triggers** (event-driven, no polling code): the **Service Bus trigger** and
  **Event Hub trigger** are first-class — the host manages peek-lock/checkpoint,
  batching, and scaling for you. Prefer these over hand-rolled receive loops.
  Also: Timer, HTTP, Blob, Queue Storage, Cosmos DB change feed, Event Grid.
- **Hosting plans:**
  - **Consumption** — scale-to-zero, pay-per-execution (GB-s + invocations),
    default for spiky/low-volume. Downside: **cold start** (hundreds of ms to
    seconds) and no VNet on the classic plan.
  - **Premium (Elastic Premium)** — pre-warmed instances (no cold start), VNet
    integration, unlimited execution duration, per-vCPU-hour billing. **Reversal
    → Premium** when cold start breaches latency SLOs, you need VNet/private
    endpoints, or load is sustained enough that always-warm is cheaper than
    per-execution.
  - **Dedicated (App Service Plan)** — run alongside existing App Service
    capacity; predictable fixed cost, no scale-to-zero. Only when you already own
    the plan.
- **Scaling:** Consumption/Premium scale on queue depth / event backlog. For
  Event Hubs, effective parallelism is capped by **partition count** — more
  function instances than partitions gains nothing. Tune `maxConcurrentCalls`
  (Service Bus) / batch size (Event Hubs) in `host.json`.
- **Cold start / cost trade-off:** Consumption is cheapest when idle and worst at
  tail latency; Premium is the inverse. Pick by whether the workload has an
  interactive latency SLO or is background throughput.

### Bridging Azure → AWS (keep cross-cloud contact minimal)
When the value ultimately lives in AWS (the default estate) but an event
originates in Azure, use a **single edge forwarder**, not scattered cross-cloud
calls:

```
Azure source (Event Hub / Service Bus)
   → ONE Azure Function (Service Bus / Event Hub trigger)
   → authenticates to AWS via OIDC workload-identity federation (§3, no secret)
   → writes to the AWS landing edge (SQS / EventBridge / Kinesis / S3)
   → everything downstream is normal AWS Well-Architected
```

- One forwarder = one identity to federate, one contract to test, one place to
  batch/retry/DLQ. Do not let application code in Azure reach into AWS directly.
- Make the hop idempotent (carry a dedup/message id) and give the forwarder a
  DLQ on the Azure side so a failed AWS write is retryable, not lost.
- Keep the Azure footprint as small as the forcing constraint allows — the goal
  is to get onto AWS rails as early as possible.

---

## 3. Cross-cloud identity & auth (Azure → AWS): NO long-lived secrets

This is central. Long-lived secrets (AWS access keys stored in Azure, Azure
client secrets stored in AWS, SAS tokens in config) are banned. Use federation
and managed identity.

### Azure workload → AWS role (the forwarder path)
- Give the Azure Function/workload a **system-assigned Managed Identity**.
- Federate it to an **AWS IAM role via OIDC**: register Azure AD (Entra ID) as an
  OIDC identity provider in AWS IAM, then the role's trust policy allows
  `sts:AssumeRoleWithWebIdentity` for tokens whose issuer is your Entra tenant
  and whose `aud`/`sub` match the workload's app registration / managed-identity
  object id. The Function acquires an Entra token (its own identity, no secret)
  and exchanges it for short-lived AWS STS credentials.
- Scope the AWS role to exactly the landing resource (e.g. `sqs:SendMessage` on
  one queue ARN). Least privilege; short session duration.

### AWS workload → Azure (the reverse, when relevant)
- Register a **federated credential** on an Entra app registration / user-assigned
  managed identity that trusts the AWS OIDC issuer, so an AWS role can obtain an
  Entra token for an Azure resource without an Azure client secret. Symmetric to
  the above.

### Inside Azure
- **Managed Identities over connection strings / SAS keys — always.** Service Bus,
  Event Hubs, Storage, Key Vault, Cosmos DB all support Entra (Azure AD) auth with
  data-plane RBAC. A connection string / account key / SAS is a long-lived secret;
  a managed identity is not. Disable local/SAS auth on the resource where the
  service supports it (`disableLocalAuth`).
- **Azure Key Vault** for anything that MUST be a secret (a third-party API key, a
  certificate). Reference secrets from Functions/App config via Key Vault
  references or the SDK using the managed identity — never paste the secret into
  app settings or IaC. Enable soft-delete + purge protection.
- **Least-privilege RBAC:** assign the narrowest built-in data-plane role at the
  narrowest scope (resource, not subscription). Examples: `Azure Service Bus Data
  Sender` / `...Data Receiver`, `Azure Event Hubs Data Sender` / `...Data
  Receiver`, `Storage Blob Data Contributor`, `Key Vault Secrets User`. Never
  `Owner`/`Contributor` for a workload identity. One identity per workload; never
  share.

---

## 4. Security controls by resource type

Use these as the checklist when writing `architecture/security/<resource>.md`.
Each item is a **checkable statement** that becomes a policy test.

### Azure Service Bus
- [ ] Entra (Azure AD) auth via managed identity; `disableLocalAuth: true` (no
      SAS keys) where the consumers support it.
- [ ] Data-plane RBAC roles (`Data Sender` / `Data Receiver`) at the queue/topic
      scope; no `Contributor` on the namespace for apps.
- [ ] **Premium** namespace + **private endpoint** when network isolation is
      required (Standard cannot do private endpoints); public network access
      disabled.
- [ ] TLS 1.2+ enforced (`minimumTlsVersion`).
- [ ] Encryption at rest on by default; **customer-managed key (CMK)** in Key
      Vault only if data-sovereignty requires it (Premium only).
- [ ] Dead-letter monitoring + `MaxDeliveryCount` set; DLQ drain plan exists.
- [ ] Diagnostic settings → Log Analytics (operational + runtime logs).

### Azure Event Hubs
- [ ] Entra auth via managed identity; `disableLocalAuth: true`; no SAS.
- [ ] Data-plane RBAC (`Data Sender` / `Data Receiver`) at the hub scope.
- [ ] Private endpoint + public access disabled for Premium/Dedicated when
      isolation is required.
- [ ] TLS 1.2+; encryption at rest (CMK only if mandated).
- [ ] Capture destination Blob container is private (no public access) and RBAC-
      scoped.
- [ ] Checkpoint-store Blob account locked down (§Storage below).
- [ ] Diagnostic settings → Log Analytics.

### Azure Functions
- [ ] System-assigned managed identity enabled; used for all Azure + federated
      AWS access (§3). No secrets/keys in app settings.
- [ ] Secrets (if unavoidable) via **Key Vault references**, not plaintext app
      settings.
- [ ] HTTPS-only (`httpsOnly: true`); TLS 1.2+ minimum.
- [ ] Function-level auth keys NOT used for service-to-service — use Entra /
      Easy Auth (App Service Authentication) or a validated token.
- [ ] **Premium plan + VNet integration + private endpoints** when the function
      must reach private resources or be network-isolated.
- [ ] Application Insights enabled (structured logs + traces + failures).
- [ ] Storage account backing the Function (`AzureWebJobsStorage`) uses managed
      identity where supported, and is locked down (§Storage).

### Azure Storage (checkpoints, Capture, Function backing, blobs)
- [ ] `allowBlobPublicAccess: false`; `allowSharedKeyAccess: false` (force Entra)
      where consumers support it.
- [ ] `minimumTlsVersion: TLS1_2`; `supportsHttpsTrafficOnly: true`.
- [ ] Private endpoint + `publicNetworkAccess: Disabled` when isolation required;
      otherwise default-deny network rules with explicit allows.
- [ ] Encryption at rest on by default (Microsoft-managed key; CMK only if
      mandated); infrastructure encryption for sensitive data.
- [ ] RBAC data-plane roles (`Storage Blob Data Contributor/Reader`) at container
      scope; no account-key sharing.
- [ ] Soft delete / versioning on containers holding durable data.
- [ ] Diagnostic settings → Log Analytics.

### Azure Key Vault
- [ ] **Azure RBAC** authorization model (not the legacy access-policy model).
- [ ] Soft-delete + **purge protection** enabled.
- [ ] Private endpoint + public access disabled when isolation required.
- [ ] Workloads get `Key Vault Secrets User` (read) at most; rotation/admin is a
      separate scoped role.
- [ ] Diagnostic settings → Log Analytics (audit every secret access).

### Identity / federation
- [ ] No long-lived AWS access keys stored in Azure; no Azure client secrets
      stored in AWS. Cross-cloud auth is OIDC federation (§3).
- [ ] Federated-credential `subject`/`audience` constrained to the exact workload
      identity / branch — never a wildcard tenant trust.
- [ ] Workload roles cannot grant themselves more (no role-assignment write on
      the resource); privilege escalation via the workload identity is blocked.

---

## 5. Cost optimization at scale (e.g. hundreds of sources)

Brief guidance; assumptions stated, not precise pricing (verify current rates).

- **Assume ~hundreds of sources emitting a steady, non-trivial event rate.**
  At that shape, per-operation billing (Service Bus Standard) grows linearly and
  can overtake a fixed-capacity tier; per-capacity billing (Premium / Dedicated)
  becomes cheaper per message and gives predictable latency.
- **Service Bus Premium vs Event Hubs cost shape:** for a high-volume linear
  event stream, **Event Hubs** is typically the cheaper transport per event
  (throughput-unit / partition pricing on a log) than Service Bus Premium
  (per-MU messaging with per-message overhead). If the traffic is genuinely a
  stream, that alone often decides it toward Event Hubs on cost as well as fit.
  Reserve Service Bus Premium for when you truly need per-message
  reliability/ordering/DLQ semantics that justify the price.
- **Functions Consumption vs Premium at sustained load:** Consumption's
  per-execution price is cheapest while idle/spiky but, under continuous
  high-rate triggering, the aggregate GB-s + invocation charges (plus cold-start
  latency) make **Premium's fixed per-vCPU-hour** cheaper AND faster past a
  break-even throughput. Estimate both curves for the expected sustained rate;
  do not default to Consumption for an always-busy forwarder.
- **General levers:** batch at the trigger (fewer, larger invocations); right-size
  Event Hub throughput units / partitions to real load; turn on **Capture**
  instead of a bespoke archival consumer; scale-to-zero everything that is
  genuinely bursty; tag resources for cost allocation; delete idle Premium
  capacity — a provisioned MU/vCPU bills whether or not traffic flows.
- **Reversal:** start on the cheapest tier that meets the SLO and move up only
  when measured throttling / latency / spend crosses the break-even — don't buy
  Premium/Dedicated speculatively.

---

## 6. Well-Architected pillars — quick checklist

| Pillar | Default action |
|--------|---------------|
| **Reliability** | Peek-lock + DLQ + `MaxDeliveryCount` (Service Bus); checkpointing + idempotent consumers (Event Hubs); duplicate detection / dedup ids; zone-redundant Premium tiers where SLA demands; forwarder DLQ on the Azure→AWS hop |
| **Security** | Managed identity everywhere; `disableLocalAuth`/no SAS; OIDC federation for cross-cloud (no long-lived secrets); Key Vault for real secrets; private endpoints + TLS 1.2+; least-privilege data-plane RBAC at narrowest scope |
| **Cost Optimization** | Cheapest tier that meets SLO; scale-to-zero for bursty (Consumption); Premium/Dedicated only past measured break-even; Event Hubs for streams; batch triggers; delete idle provisioned capacity; tag for allocation |
| **Operational Excellence** | IaC (Bicep) for all resources; `what-if` before apply; Application Insights + Log Analytics diagnostic settings on every resource; work-item state recorded from CI (`make wi-append`); Azure Monitor alerts on DLQ depth / consumer lag |
| **Performance Efficiency** | Partition count sized to consumer parallelism (Event Hubs); Premium Functions to kill cold start on latency-SLO paths; lock duration ≥ p99 processing; batch size tuned in `host.json`; keep cross-cloud hops to one edge |

---

## 7. Reversal log

Running table of any deviation from the defaults above, with the condition that
would trigger a reversal. (Empty until a project takes the Azure exception —
this skill is new and no project has yet logged one.)

| Deviation | Project | Justification (forcing constraint) | Reversal condition |
|-----------|---------|-------------------------------------|--------------------|
| _(none yet)_ | | | |

When you take the Azure exception, add a row here AND a `/process/principle-
failures/` entry naming: the forcing constraint that ruled out AWS, the Azure
services chosen, and the concrete condition under which you would move the
workload (back to AWS, or up a tier). An undocumented Azure resource — like an
undocumented out-of-region one on the AWS side — is a review failure.
