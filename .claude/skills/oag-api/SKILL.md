---
name: oag-api
description: Reference for the OAG Flight Info Alerts feed and Flight Info API — the source the OagEventSource project ingests. Covers the two delivery channels (Azure Event Hub pull, HTTP Push beta), the Create-Alert API and alert types, the schedule vs status event schemas, the scheduleInstanceKey/statusKey idempotency keys, OOOI/times/gate/baggage fields, the changes[] indicator, and v1→v2 differences. Load this before defining, refining, or debugging any OAG ingestion/normalisation requirement or behaviour, or when the live API does not behave as the requirements assumed. Built from live knowledge.oag.com docs (verified 2026-06-17) — deeper detail is one WebFetch away via the source index at the end.
---

# OAG Flight Info Alerts & Flight Info API

OAG provides flight schedule + operational status data. **OagEventSource ingests the
Flight Info Alerts feed** and normalises it to canonical Aerocloud domain events behind
an anti-corruption boundary — so everything here is OAG-side semantics that **must not
leak past ingestion** (downstream FIDS/BIDS/Stand never see these field names).

> Verified live against `knowledge.oag.com/docs` on 2026-06-17. The **request/response
> schemas behind the developer portal** (`developers.oag.com`) need an authenticated
> account and are not all public — items still needing the portal/sandbox are tagged
> ⚠ PORTAL below. The machine-readable doc index is `knowledge.oag.com/llms.txt`.

## What it is
Flight Info **Alerts** = near-real-time **change events** (schedule changes + operational
status) for the slice of OAG's data you subscribe to — no per-flight API lookup needed.
Flight Info **API** = the request/response REST API for point-in-time lookups (the
reconciliation/pull side). The Alerts feed is the push side; the API is the authoritative
backstop the requirements use as the reconciliation poller.

## Two delivery channels

### 1. Azure Event Hub (GA, self-service) — the primary feed
- Events land on an **Azure Event Hub**; you consume them. **No Azure subscription
  required** to connect.
- **Protocols:** AMQP (Azure Event Hubs SDK) or **Kafka** (near-identical features).
- **Retention: 7 days** (confirmed — replay window for DR / catch-up). [resolves VERIFY #3]
- **Consumer groups:** 4 by default (`$Default`, `consumergroup-1/2/3`), up to 20 on request.
- **Ordering:** events for the **same service number (carrier + flight number) go to the
  same partition**, preserving per-flight chronological order. This is exactly the
  per-flight ordered stream the canonical event store needs.
- **Checkpointing:** external store (e.g. Blob Storage) under AMQP, or Kafka offset mgmt.
  Consumer owns its cursor — matches the event-sourcing "consumer-owned checkpoint" model.
- **Connection:** OAG hands you connection strings when you complete your profile. ⚠ PORTAL
  (exact connection-string format + whether OAG provisions a checkpoint store).

### 2. HTTP Push (BETA) — alternative delivery
- OAG `POST`s each event to **your** endpoint, `Content-Type: application/json`.
- **Payload is the v2 contract only** (status or schedules messages) — note: forces v2.
- **Auth:** `x-api-key` header today; OAuth2/JWT planned.
- **Delivery:** failed deliveries (HTTP 5xx / network) are **retried indefinitely to
  preserve message order** ⇒ **at-least-once**, ordered per service number. This is the
  "at-least-once push feed" the requirements reference.
- **Setup is manual** (not self-service): contact OAG Support with profile + endpoint URL
  (+ optional API key); OAG returns an `accountId`. Content config is **account-level**
  (`includeContent`), not per-alert.
- **Maturity caveat:** BETA. For a production primary feed, Event Hub (GA) is safer; treat
  HTTP Push as optional/secondary until it leaves beta. Flag in the architecture gate.

## Creating an alert (what you subscribe to)
`POST https://api.oag.com/flight-info-alerts/alerts?version=v1`  ·  header
`Subscription-Key: <key>`  ·  `201 Created` on success.

**Body fields:** `accountId`, `name`, `description`, `alertType`, `iataCarrierCode`,
`icaoCarrierCode`, `flightNumber` (int), `departureAirport`, `arrivalAirport`,
`departureDate`/`arrivalDate` (`yyyy-MM-dd`), `schedules` (bool), `status` (bool),
`gaFlights` (bool), `unscheduledFlights` (bool), `content` (str), `state` (str),
`statusChangeFilters` (object: baggage, aircraftRegistrationNumber, gates, terminal,
seats, aircraftType).

**`alertType` ∈ `global` | `port` | `carrier`.** Required-by-type [resolves VERIFY #2]:
| alertType | required | notes |
|---|---|---|
| (all) | `accountId`, `name`, `description`, `alertType` | |
| `global` | + nothing | covers ALL OAG flights, all future dates; **max ONE per customer**; other filters ignored |
| `port` | + `departureAirport`, `arrivalAirport` | route-scoped; optional dates |
| `carrier` | + `iataCarrierCode` | most specific; add `flightNumber`/range + airports + dates to narrow; single-flight = carrier + dep/arr airport + departureDate + flightNumber |

**Per-alert options:** `schedules`/`status` toggles (track one or both); `content` adds
`seats` and `changeindicator` (the `changes[]` array — see below). Subscribe to a
**bounded set of airports** (the SLO doc relies on this for metric cardinality).

## The two event kinds (the canonical-mapping source)

### Schedule events — `documentType: "ScheduleInstance"`
Planned/published schedule data + changes to it. **`state` ∈ `NEW` | `UPDATED` |
`REINSTATED` | `DELETED`** (v1 used a `status` of `changed`/`deleted`, deprecated → `state`).
Carries routing (stops, intermediate airports), aircraft, booking/freight classes,
seating capacity, on-time-performance, codeshare. When `state = NEW` or `DELETED`,
`changes` is always empty.

### Status events — `documentType: "FlightStatus"`
Operational reality. **`state` ∈ `Scheduled` | `OutGate` | `InAir` | `Landed` | `InGate`
| `Canceled` | `Proposed`** (Proposed = GA flight plan filed; Scheduled appears up to ~52h
before departure). **Delay is NOT a state** — it surfaces as `outGateTimeliness`/
`inGateTimeliness` ∈ `OnTime`|`Early`|`Delayed` plus a variation value. `flightType` ∈
`Scheduled`|`Unscheduled`|`GA`.

**Schedule vs status are kept separate internally** even though Flight Info v2 merges the
two contracts — preserve that split in the canonical model (a requirements decision).

### Identity & idempotency keys (load-bearing)
- **`scheduleInstanceKey`** — stable hash (SHA-256-style) **derived from flight properties;
  consistent across updates** for the same flight instance. The per-flight aggregate id.
- **`statusKey`** — hash of the **current status content; changes whenever the event
  content changes**. The dedup/idempotency key for status updates.
- `messageId` (per-delivery UUID), `messageTimestamp` (epoch ms).
- **Idempotency rule (from requirements):** dedupe by `scheduleInstanceKey`/`statusKey`;
  the same logical event redelivered (at-least-once) must fold to the same state.

### Times — scheduled / estimated / actual + OOOI
Departure & arrival each carry `scheduledTime`, `estimatedTime`, `actualTime` in
`{local, utc}` (`YYYY-MM-DDTHH:mm:ss±HH:mm`). **OOOI block times:** `outGate` (pushback),
`offGround` (wheels-off), `onGround` (touchdown), `inGate` (block-on) — these drive the
canonical status-change events. Plus timeliness + variation per phase.

### Fields the consumers care about
- **Gate, Terminal** (departure + arrival) → FIDS/GIDS + Stand.
- **`baggage`** = claim **belt/carousel** identifier → **BIDS** (the belt-assignment app).
- **Codeshare:** `isOperating` bool; operating flight lists `marketingFlights[]`, marketing
  flight carries `operatingFlight`. Normalise on the operating flight.
- **Irregular ops:** `irregularOperationType` `Diversion`|`Recovery`; `diversionAirport`,
  `originalStatusKey`; during a diversion the `scheduled` sub-blocks keep the original
  airport while primary fields show the diverted one.

### `changes[]` indicator (incremental folds)  [resolves VERIFY #1]
When `content` includes `changeindicator`, **every status AND schedule message** carries a
`changes[]` array (v1 & v2; only the `propertyName` paths differ by contract):
- `propertyName` — dot path (e.g. `equipment.aircraftType.iata`); `previousValue` present
  for **update/delete**, absent for **add**.
- Empty when `ScheduleState = NEW` or `DELETED`.
This is what lets a consumer fold incremental deltas onto state — the heart of the
OagEventSource value. No version-gated availability date found (contradicts an earlier
requirements assumption that it might be date-gated — appears generally available).

## v1 → v2 (the contract is moving to v2)
- Field naming **PascalCase → camelCase**; `premiumContent.seatingCapacity` → top-level
  `seatingCapacity`; schedule `status` → `state`.
- **HTTP Push delivers v2 only.** Create-Alert endpoint shown is `?version=v1`; a
  `switching-from-v1-to-v2` guide exists. Build canonical mapping against **v2** and treat
  v1 as legacy. ⚠ PORTAL: confirm the v2 Event-Hub envelope vs the v1 samples here.

## Still open (need the authenticated portal / sandbox or are non-OAG)
- ⚠ PORTAL — exact Event-Hub connection-string format; full v2 sample JSON envelope;
  precise required-field validation messages; rate/quota limits.
- ⚠ NON-OAG (out of this skill, still open in the vision): Dash0 OTLP ingestion
  endpoint/region + `POST /api/logs` filter schema (VERIFY #4); Dash0 webhook payload +
  target ticketing system (VERIFY #5).

## Source index (WebFetch for depth; all under knowledge.oag.com/docs/, add `.md`)
Alerts: `flight-info-alerts-overview` · `-create-alert` · `-connect-to-event-hub` ·
`-http-pushbeta` · `-change-indicators` · `-event-samples-v1-schedule-events` ·
`-event-samples-v1-status-events` · `-event-samples-v2-schedule-events` ·
`-event-samples-v2-status-events` · `-event-samples-status-field-definitions` ·
`-event-samples-schedules-field-definitions` · `what-type-of-alerts-can-i-create` ·
`how-does-flight-info-alerts-work` · `what-is-an-event-hub`.
API: `flight-info-api-getting-started` · `-requesting-a-subscription` ·
`-response-layout-descriptions` · `-content-parameters` ·
`switching-from-flight-info-api-v1-to-v2-a-step-by-step-guide`.
Index: `knowledge.oag.com/llms.txt`. Portal (auth): `developers.oag.com`.
