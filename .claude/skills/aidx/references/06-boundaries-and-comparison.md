---
last_refreshed: 2026-07-11
sources:
  - IATA AIDX XML Implementation Guide v22.1 §1, domain intros
  - Sibling skills oag-api, flightaware-aeroapi, flightaware-firehose
---

# 06 · Boundaries & Comparison

AIDX is one layer in a stack of aviation data standards. Knowing where it stops is as important as knowing what it carries — most integration mistakes come from expecting AIDX to do a neighbour's job.

## What AIDX explicitly does NOT carry

| Concern | Not AIDX — use instead | Why |
| --- | --- | --- |
| Passenger-level data (PNR, API, boarding pass, seat) | **IATA PADIS / EDIFACT** (PNRGOV, PAXLST, etc.) | AIDX is flight-leg level. `PaxCount` is a count, never a passenger. |
| Individual bag control (sortation, no-show offload, transfer) | **IATA RP 1745 Type-B** (BSM/BPM/BUM/BTM/BNS) or **BAG XML** | AIDX carries flight-level bag *summary* (belt, counts, weight, handler) only. |
| Invoicing / charges | **IATA SIS / IS-XML** | AIDX has no billing elements; it supplies the events (AIBT, ATOT, pax) that trigger charges. |
| Published forward schedules (weeks–months) | **OAG Schedules** (sibling `oag-api`) | AIDX operates in the operational window, not the seasonal planning horizon. |
| Live aircraft position / surface movement | **FlightAware AeroAPI / Firehose** (siblings) | AIDX carries milestone *times*, not ADS-B tracks or ASDE-X surface positions. |
| Stand / gate / belt *allocation logic* | **Aerocloud primitives** | AIDX carries the assigned resource, not the algorithm that chose it. |

## AIDX vs the sibling flight-data sources

| Dimension | **AIDX** | **OAG** (`oag-api`) | **FlightAware** (`flightaware-*`) |
| --- | --- | --- | --- |
| Role | Operational data-exchange **backbone** between airport systems | Schedule **of record** | Real-world **movement** layer |
| Horizon | Operational window (hours around the flight) | Up to 12 months forward | Live + short historical |
| Shape | XML messages (push/pull), flight-leg level | REST JSON / push / Snowflake | REST (AeroAPI) + TCP stream (Firehose) |
| Direction | Bidirectional between peers (airline ↔ airport ↔ handler) | Vendor → you | Vendor → you |
| Milestone model | `OperationQualifier` + `TimeType` → A-CDM | `Scheduled/Estimated/Actual` gate+runway times | ADS-B events, Foresight predictions |
| Resources | Yes — stand, gate, belt, check-in, makeup belt | Terminal/gate where published | No resource model |
| Identity | UFI (Airline+Number+Suffix+OriginDate+Dep+Arr+RepeatNumber) | Instance key (hash) | `fa_flight_id` |
| Authority | Authoritative for **confirmed operational facts & assignments** | Authoritative for **what's scheduled** | Authoritative for **where the aircraft actually is** |

**Rule of thumb:** OAG tells you a flight *will* exist; FlightAware tells you where it *is*; AIDX is how airport systems *tell each other what it's doing and what resources it's using*. They are complementary layers, not competitors — a mature Aerocloud deployment ingests all three and reconciles them into one canonical flight picture.

## Where the three overlap (and who wins)

- **Times.** OAG gives scheduled/estimated times; FlightAware gives observed movement; AIDX gives the airport's *confirmed* milestone (AIBT/AOBT) plus A-CDM targets (TOBT/TSAT). For A-CDM and billing, **AIDX/AODB milestones win** — they're the operational truth of record for the airport.
- **Status.** All three can say "cancelled/diverted". AIDX's `OperationalStatus` + `PlannedArrivalAptHistory` is the airport-authoritative version once the flight is in the operational window.
- **Gate/terminal.** OAG may publish a gate; AIDX carries the *assigned* gate/stand with Planned-vs-Actual usage. AIDX wins inside the operational window.

## Same-standard neighbours bundled in the SITA XSD set

The v21.2 schema package (see `08-xsd-schema.md`) includes two sibling message families that reuse the AIDX flight-leg key but are distinct domains:

- **Fuel pre-transaction** (`FuelNotifRQ`) — fuel ordering/delivery/on-board/progress; the only signable AIDX message.
- **Ground Movement** (`FlightLegLinkGroundMovement`) — links an arriving and departing leg of the same aircraft moving under Engine or Tow, with stand linkage. This is the closest AIDX gets to a turnaround/tow primitive.

Both are optional extensions; core flight-leg exchange does not require them.
