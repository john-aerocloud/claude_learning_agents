---
last_refreshed: 2026-07-11
sources:
  - IATA AIDX XML Implementation Guide v22.1 §3.4
  - SITA developer.aero AIDX API 17.1.6
---

# 05 · Message-Flow Sequences

AIDX defines the payload, not the transport. But the standard documents three canonical exchange patterns, and the flight lifecycle drives a predictable stream of `OperationTime` updates. This file is the "what order do the messages go in" reference.

## Pattern A — Unsolicited notification (the common case)

The producer (AODB / DCS / handler) pushes flight-leg updates as facts change. No request needed.

```
Producer                                   Consumer
   |  IATA_AIDX_FlightLegNotifRQ  ------->  |   (1..N FlightLeg records)
   |                                        |   validate + apply
   |  <-------  IATA_AIDX_FlightLegRS  ----  |   (optional ack: Success or Errors)
```

- The ack is **optional** and agreed in the bilateral agreement. Many high-volume feeds run fire-and-forget with validation on the receiver side.
- One `FlightLegNotifRQ` may carry **many** `FlightLeg` records (batch, e.g. a daily schedule load) or a single record (a live milestone tick).
- The message is a **notification, not a command** — the receiver decides what to do.

## Pattern B — Request with synchronous reply

The consumer pulls current data (e.g. on startup, resync, or gap recovery).

```
Consumer                                   Producer
   |  IATA_AIDX_FlightLegRQ  ------------>  |   (filter: Airline/Code)
   |  <-------  IATA_AIDX_FlightLegRS  ----  |   (Success + 0..N FlightLeg)
```

- The only defined request filter is **carrier code**; omit it to request all relevant carriers. Extra criteria (date window, airport) are by bilateral agreement.
- Keep the connection open only briefly — see Pattern C for slow data.

## Pattern C — Request, sync ack, async reply

Preferred when assembling the response is slow (large resync). Avoids holding a connection open.

```
Consumer                                   Producer
   |  IATA_AIDX_FlightLegRQ  ------------>  |
   |  <----  IATA_AIDX_FlightLegRS (ack) --  |   (Success, no data yet)
   |                                        |   ... assemble ...
   |  <----  IATA_AIDX_FlightLegNotifRQ ---  |   (the data, out of band)
   |  IATA_AIDX_FlightLegRS (ack)  ------>   |
```

## The flight lifecycle as an OperationTime stream

A single leg emits a sequence of `OperationTime` elements as it progresses. Each is one `@OperationQualifier` + `@TimeType`; the same qualifier reappears as its `TimeType` sharpens from `SCT`→`EST`/`TAR`→`ACT`. (See `04-acdm-milestones.md` for the full A-CDM mapping.)

**Arrival leg:**
```
THM (in range) → TEN (approach) → TDN (touchdown) → ONB (on-block / AIBT)
   → CGT (commence ground handling) → FBG (first bag off) → LBG (last bag off)
   → ABA (air-bridge attach)
```

**Departure leg (turn):**
```
CHK (check-in open) → CHC (check-in closed) → GTO (gate open) → BST (boarding)
   → FCT (final call) → BEN (final boarding) → GCL (gate close) → FCL (closed)
   → ABD (air-bridge detach) → RDT (ready) → SRT (startup req) → SAT (startup appr)
   → OFB (off-block / AOBT) → DIC/DIE (de-ice start/end) → TKO (take-off / ATOT)
```

Typical Aerocloud reactions along the stream:
- `ONB`/`ACT` → confirm arrival, start turnaround clock, release inbound stand logic.
- `FBG`/`LBG` → belt timing, reclaim SLA.
- `BST` → boarding gate state to FIDS.
- `OFB`/`ACT` (AOBT) + `TKO`/`ACT` (ATOT) → close the turn, trigger ground-handling billing, free the stand.

## Resource-assignment flow

Resource assignments arrive in the same `FlightLegNotifRQ`, inside `AirportResources`:
```
AirportResources[@Usage="Planned"]  → pre-allocation (stand/gate/belt proposed)
AirportResources[@Usage="Actual"]   → real-time assignment (what was truly used)
   Resource[@DepartureOrArrival="Arrival"]   → reclaim belt, arrival gate/stand
   Resource[@DepartureOrArrival="Departure"] → departure gate/stand, check-in, makeup belt
```
Consumers should treat a change of `@Usage` from Planned to Actual as an assignment-confirmed event.

## Irregular operations

Conveyed via `OperationalStatus` (codeset 2005): `DV` diverted, `DX` cancelled, `RT` re-route, `GRT` ground return, plus `SQ` reinstate (codeset 1245). Rules:
- A cancellation (`DX`) is reversible **only** by an explicit `SQ` — no other code implicitly reinstates.
- Diversions do **not** change `ArrivalAirport` in the key; the new destination is appended to `PlannedArrivalAptHistory`.
- A new departure attempt increments `RepeatNumber`; `@CurrentInd=true` marks the operating leg, and `@AirborneReturnNumber` counts airborne returns separately from ground returns.

## Billing trigger flow (financial domain)

```
AIDX FlightLegNotifRQ (AIBT via ONB/ACT, ATOT via TKO/ACT, PaxCount Class=7 Qual=70A)
   → AODB updates confirmed milestones
   → IS-XML invoice generation in IATA SIS
```
AIDX carries no billing elements; it is the authoritative operational source that triggers charge calculation downstream.
