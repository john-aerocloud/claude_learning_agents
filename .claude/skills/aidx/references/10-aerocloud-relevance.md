---
last_refreshed: 2026-07-11
---

# 10 · Aerocloud Relevance & Capability Mapping

## Why AIDX is a core integration for Aerocloud

Aerocloud is a one-stop airport platform: check-in, baggage, stand management, ground handling, billing, analytics. Those modules run in the **operational window** of the flight — hours around arrival and departure — and they need two things AIDX carries natively: **confirmed milestone times** and **resource assignments**. Where OAG feeds the planning horizon and FlightAware feeds live position, **AIDX is the exchange layer through which the AODB, DCS, ground handlers, and the A-CDM platform tell each other what is actually happening**.

AIDX sits at the operational end of the timeline:

| Horizon | Decisions it drives | Authoritative source |
| --- | --- | --- |
| T-12m → T-2w | Seasonal capacity, stand pre-allocation, contract sizing | **OAG** |
| T-2w → T-48h | Day-of-ops stabilisation | OAG + **AIDX** (Planned resources, first milestones) |
| T-48h → gate/stand event | Live turnaround, belt timing, gate/stand assignment, A-CDM | **AIDX** (Actual milestones + resources) + FlightAware (position) |
| Post-flight | Ground-handling billing, SLA reporting | **AIDX** milestones (AIBT/ATOT/pax) → IS-XML + warehouse |

Unlike OAG (a pure vendor feed), **AIDX is bidirectional** — Aerocloud both *consumes* AIDX (from airlines/handlers/AODB) and *publishes* AIDX (e.g. resource assignments back out, or to SITA Flight Status). The ingestion/egress layer owns both directions.

## Capability → AIDX mapping

| Aerocloud capability / module | AIDX surfaces consumed / produced | Internal domain events emitted |
| --- | --- | --- |
| Stand / Gate Management | `AirportResources` (Actual/Planned, Dep/Arr), `AircraftParkingPosition`, `OperationTime` ONB/OFB; publishes stand assignments | `StandAssigned`, `StandReleased`, `GateAssigned`, `AircraftOnBlock`, `AircraftOffBlock` |
| Turnaround / Ground Handling | Arrival→departure milestone stream, `AssociatedFlightLegAircraft`, Ground Movement (Engine/Tow) | `TurnaroundStarted`, `GroundHandlingCommenced`, `TurnaroundCompleted` |
| Baggage (belt planning) | `BaggageClaimUnit`, `BaggageMakeUpBelt`, `OperationTime` FBG/LBG/FBA/LBA, `AircraftInfo/Baggage` | `ReclaimBeltAssigned`, `FirstBagOffRecorded`, `LastBagOffRecorded`, `MakeupBeltAssigned` |
| Check-in | `CheckInInfo` (FirstPosition/LastPosition/@Class), `PassengerGate`, `OperationTime` CHK/CHC | `CheckInRangeAssigned`, `CheckInOpened`, `CheckInClosed` |
| A-CDM | every `OperationTime` (OpQualifier+TimeType), `OperationalStatus` CDM codes | `MilestoneRecorded` (AIBT/AOBT/TOBT/TSAT/TTOT/CTOT/ATOT...) |
| FIDS / Passenger Info | `RemarkTextCode` (9750/9932), `PublicFlightDisplay`, `OperationalStatus` | `PublicStatusChanged`, `GateDisplayUpdated` |
| Delay & Irregular Ops | `IrregularityDelay` (ReasonCode AHM732, Duration), `OperationalStatus` DV/DX/RT/GRT, `PlannedArrivalAptHistory` | `FlightDelayed`, `FlightCancelled`, `FlightDiverted`, `GroundReturnRecorded` |
| Billing | `OperationTime` AIBT/ATOT, `CabinClass/PaxCount` (Class=7, 70A) | `BillableMilestoneConfirmed`, `PaxCountConfirmed` |
| Fuel (optional) | `FuelNotifRQ` (order/summary/onboard/progress) | `FuelOrderRecorded`, `FuelUpliftConfirmed` |

AIDX deliberately carries the assigned resource and the confirmed fact, **not** the allocation algorithm — those remain Aerocloud primitives that consume AIDX-derived events.

## Personas and jobs

| Persona | Primary job-to-be-done | AIDX surfaces used |
| --- | --- | --- |
| Stand Allocator | Assign/free stands against confirmed arrivals & turns | `AirportResources`, ONB/OFB milestones |
| Turnaround / Ramp Coordinator | Track the turn from on-block to off-block | full milestone stream, Ground Movement |
| Belt Planner | Assign reclaim belts with lead time before first bag | `BaggageClaimUnit`, FBG/LBG times |
| Check-in Coordinator | Allocate desk ranges against the departure wave | `CheckInInfo`, CHK/CHC times |
| A-CDM / Duty Manager | Maintain the milestone picture, react to TOBT/CTOT | all `OperationTime`, `OperationalStatus` |
| Baggage Ops | Monitor makeup belts and handler assignment | `BaggageMakeUpBelt`, `AgentInfo` |
| Passenger Info | Publish accurate public status to FIDS | `RemarkTextCode`, `PublicFlightDisplay` |
| Billing Operator | Invoice ground handling against confirmed AIBT/ATOT + pax | consumes internal events (AIDX-derived) |

If two personas want the same milestone for *different intents*, that's the signal — per project principles — to make each its own service consuming a shared canonical event, rather than one service straddling both.

## Commands and events (Aerocloud-internal)

AIDX is a data-exchange standard, so a `FlightLegNotifRQ` is a **notification, not a command**. The Aerocloud AIDX boundary layer has two responsibilities:

**Ingress** — translate inbound AIDX into canonical domain events:
- Parse `FlightLegNotifRQ` / handle `FlightLegRQ`/`FlightLegRS`.
- Resolve the UFI to an internal flight identity.
- Emit `MilestoneRecorded`, `StandAssigned`, `ReclaimBeltAssigned`, `CheckInRangeAssigned`, `FlightDelayed`, `FlightCancelled`, `FlightDiverted`, `PaxCountConfirmed`, etc.
- Honour `xsi:nil` (clear) vs missing (no change) semantics; track `RepeatIndex` ordering.

**Egress** — translate internal decisions into outbound AIDX:
- `PublishResourceAssignment(leg, resource)` → `FlightLegNotifRQ` with `AirportResources[@Usage="Actual"]`.
- `PublishMilestone(leg, qualifier, timeType, time)` → `OperationTime`.
- `PublishStatus(leg, status)` → `OperationalStatus` / `RemarkTextCode`.
- Transport per bilateral agreement (e.g. the SITA REST publish API, see `07-sita-api.md`).

**No Aerocloud service outside the AIDX boundary ever knows about `OperationQualifier`, `TimeType`, `RepeatNumber`, PADIS codesets, or `LegData`** — they consume canonical domain events only. This keeps the vendor/standard surface contained and lets us swap transports (SITA REST, MQ, direct AODB feed) without touching downstream teams.

## Why AIDX, OAG, and FlightAware coexist

The canonical flight picture is assembled from all three, reconciled on the UFI / instance key:
- **OAG** seeds the flight days-to-months ahead (`FlightSchedulePublished`).
- **AIDX** supplies confirmed operational facts and resource assignments in the window (`MilestoneRecorded`, `StandAssigned`).
- **FlightAware** supplies independent position/movement truth for cross-check and prediction (`PositionUpdated`, Foresight).

When they disagree inside the operational window, **AIDX/AODB is authoritative for airport operational facts and resource assignments**; FlightAware is authoritative for physical position; OAG is authoritative for the baseline schedule.
