---
name: aidx
description: Knowledge pack for AIDX (Aviation Information Data eXchange) — IATA's global XML standard for exchanging flight-leg operational data between airlines, airports, ground handlers, and A-CDM/billing platforms. Use whenever the user mentions AIDX, IATA_AIDX_FlightLegNotifRQ / FlightLegRQ / FlightLegRS, LegData, OperationTime, OperationQualifier, TimeType, LegIdentifier, PADIS codesets (2005 / 9750 / 1245), A-CDM milestones (AIBT / AOBT / TOBT / CTOT / ATOT), the SITA AIDX publish API, or the v21.2 XSD. Also trigger when mapping flight operational events (in-block, off-block, boarding, bags, de-icing) into stand / gate / belt / ground-handling / billing systems, comparing AIDX with OAG / FlightAware / Type-B / IS-XML, or mapping AIDX into Aerocloud's capability, persona, and domain-event model. Covers message types, the LegData element catalog, codesets, A-CDM mapping, sequences, the SITA REST API, and XSD enums. Siblings `oag-api`, `flightaware-aeroapi`, `flightaware-firehose` cover schedules and live tracking.
---

# AIDX — Aviation Information Data eXchange — Aerocloud Integration Knowledge Pack

## Why Aerocloud cares

Aerocloud's airport customers run stands, gates, check-in, baggage belts, ground handling, and billing off a shared picture of **what each flight is doing right now and what it will do next**. AIDX is the industry-standard XML envelope that carries exactly that: the confirmed and predicted milestone times, resource assignments, passenger and baggage counts, and irregularity data for every flight leg.

Where OAG is the *schedule of record* (weeks-to-months ahead) and FlightAware is the *live-movement layer* (ADS-B / surface), **AIDX is the operational data-exchange backbone between airport systems** — the AODB, DCS, ground handlers, A-CDM platform, and downstream consumers all speak AIDX. It is the standard for SESAR A-CDM, ACI ACRIS A-CDM Web Services, and ICAO A-CDM information exchange.

That makes AIDX the right integration for:

1. Ingesting confirmed milestone times (in-block, off-block, boarding, first/last bag, de-icing, take-off) to drive stand de-allocation, belt timing, and turnaround management.
2. Receiving and publishing resource assignments — parking stand, gate, terminal, check-in desks, reclaim belts, makeup belts.
3. Feeding A-CDM: every AIDX `OperationTime` maps to an A-CDM milestone via an `OperationQualifier` + `TimeType` pair.
4. Triggering ground-handling and billing events from authoritative operational facts (AIBT, ATOT, pax count → IS-XML invoicing).
5. Exchanging flight-level passenger and baggage counts, delay/irregularity data, and aircraft rotation links.

AIDX is **flight-leg-level**, not record-level: passenger-level data (PNR/API/boarding pass) rides PADIS/EDIFACT, individual bag control rides RP 1745 Type-B / BAG XML, and billing rides IATA SIS / IS-XML. AIDX complements those — it does not replace them. See `references/06-boundaries-and-comparison.md`.

## How to use this skill

When triggered, read the reference file that matches the question. Don't dump the whole pack — pull the section that answers.

| Question kind                                                        | Open                                          |
| -------------------------------------------------------------------- | --------------------------------------------- |
| "What are the AIDX message types / how is a message structured?"     | `references/01-messages-and-structure.md`     |
| "What element/attribute carries X? What's under LegData?"            | `references/02-element-catalog.md`            |
| "What are the valid codes for this attribute (codeset NNNN)?"        | `references/03-codesets.md`                   |
| "How do AIDX times map to A-CDM milestones (AIBT, TOBT, CTOT...)?"   | `references/04-acdm-milestones.md`            |
| "What order do the messages flow in for use case Y?"                 | `references/05-sequences.md`                  |
| "How does AIDX relate to OAG / FlightAware / Type-B / IS-XML?"       | `references/06-boundaries-and-comparison.md`  |
| "How do I publish AIDX to SITA / what's the REST API?"              | `references/07-sita-api.md`                   |
| "What are the exact XSD enumerations / cardinality / Fuel / GM?"     | `references/08-xsd-schema.md`                 |
| "What changed between AIDX versions? Which version do I target?"    | `references/09-version-history.md`            |
| "How does AIDX map to our capability / persona / event model?"       | `references/10-aerocloud-relevance.md`        |
| "Where is this info from / what needs refreshing?"                   | `references/sources.md`                       |
| "Show me a real AIDX message"                                        | `samples/` (create/update, delete, response)  |

## Quick facts

- **What it is:** IATA XML messaging standard for flight operational data. Endorsed as IATA **RP 1797A**, ACI **RP 501A07**, ATA **RP 30.201A**. ~180 data elements. Launched Oct 2008.
- **Three message types** (all data rides inside `LegData`; no per-domain message types):
  - `IATA_AIDX_FlightLegNotifRQ` — unsolicited push of one or more flight-leg records.
  - `IATA_AIDX_FlightLegRQ` — request for flight-leg records (filter: carrier code).
  - `IATA_AIDX_FlightLegRS` — response / acknowledgement (Success or Errors).
- **Namespace:** `http://www.iata.org/IATA/2007/00`. Encoding UTF-8. Times are `xsd:dateTime` in **UTC with trailing `Z`**; dates `YYYY-MM-DD`.
- **The flight-leg key (UFI):** Airline + FlightNumber + OperationalSuffix + OriginDate + DepartureAirport + ArrivalAirport + RepeatNumber. `OriginDate` and `ArrivalAirport` never change once set (diversions go to `PlannedArrivalAptHistory`).
- **Milestone model:** each `OperationTime` = `@OperationQualifier` (the activity, e.g. `ONB` on-block) + `@TimeType` (the stage: `SCT`/`PLN`/`EST`/`TAR`/`CAL`/`ACT`). This two-attribute model started at **schema v12.1**; ≤ v11.1 used a single combined code.
- **Current guide:** v22.1 (Mar 2022), aligned to schema 22.1. **Feature high-water mark is schema 16.2**; 17.x–21.x are almost all "no AIDX-relevant changes."
- **`nil` vs missing:** element *missing* = no change (don't clear); element present with `xsi:nil="true"` = explicitly clear the stored value. Never send empty elements.
- **Transport is not mandated.** AIDX defines the payload; transport (SOAP/TCP/MQ/REST), security, and mandatory-vs-optional fields are set in a **bilateral agreement**. SITA's publish API (see `07`) is one concrete transport.

## The six operational domains (all carried in LegData)

| Domain | What AIDX carries | Key elements |
| --- | --- | --- |
| **Arrivals** | Radar-to-stand milestones, first-bag-off, arrival gate & reclaim belt | `OperationTime` (THM/TEN/TDN/ONB/CGT/FBG/LBG), `AirportResources` (Arrival) |
| **Departures** | Gate-open to take-off milestones, delay/irregularity, rotation links | `OperationTime` (GTO/BST/GCL/OFB/TKO), `IrregularityDelay`, `AssociatedFlightLegAircraft` |
| **Passenger processing** | Flight-level pax counts, check-in & gate resources | `CabinClass/PaxCount`, `CheckInInfo`, `PassengerGate` |
| **Baggage** | Reclaim belt, makeup belt, timing, handler identity (flight-level only) | `BaggageClaimUnit`, `BaggageMakeUpBelt`, `AircraftInfo/Baggage`, `AgentInfo` |
| **IT / comms** | The message envelope, identity, routing, versioning, extension | root attributes, `Originator`, `DeliveringSystem`, `TPA_Extension` |
| **Financial / billing** | No billing elements — AIDX is the *source of truth* that triggers charges | `OperationTime` (AIBT, ATOT), `PaxCount` → IS-XML |

## Known gaps (verify during a spike)

1. **Full raw PADIS Code Set Directory** is gated behind the PADIS extranet. This pack carries IATA's *AIDX-preferred subset* (Implementation Guide Appendix D) plus the XSD enums — sufficient for interoperable exchange, but not every code in every codeset. See `references/03-codesets.md`.
2. **Delay reason codes** moved to the new **AHM 732** schema (guide v22.1); AHM 730/731 phase out at the AHM 44th edition. The code list itself lives in the AHM (free app at iata-ahm732.azurewebsites.net), not in AIDX.
3. **Transport/security specifics** are per-bilateral-agreement. The SITA REST API (`07`) is documented; other deployments (MQ, SOAP, direct AODB feeds) will differ.
4. **Stand/turnaround logic is not an AIDX primitive.** AIDX carries the parking position and rotation links; the allocation logic is an Aerocloud primitive that consumes AIDX-derived events.

## Working principles

- **AIDX is the operational fact bus.** When a milestone is confirmed (AIBT, ATOT) or a resource is assigned (stand, belt), AIDX is the authoritative carrier between airport systems. Schedules come from OAG; live positions from FlightAware.
- **Commands in, events out.** AIDX is a data-exchange standard, not a command channel — a `FlightLegNotifRQ` is a *notification*, not an instruction to act. The ingestion layer converts inbound AIDX into canonical domain events (`FlightMilestoneRecorded`, `StandAssigned`, `ReclaimBeltAssigned`, `FlightDelayed`, `FlightCancelled`, ...).
- **Composition over coupling.** Keep AIDX vocabulary (`OperationQualifier`, `TimeType`, `RepeatNumber`, PADIS codesets) behind the ingestion boundary; downstream teams consume canonical events only.
- **Explain the change.** When any diagram or mapping in this pack changes, append a row to the Refinement log in `references/sources.md`.

## Triggering examples

Use this skill when the user asks things like:

- "Which AIDX element carries the actual in-block time, and how do I map it to AIBT?"
- "What are the valid `OperationQualifier` codes for departure milestones?"
- "Design a flow to ingest AIDX `FlightLegNotifRQ` and drive stand de-allocation."
- "How do I publish a flight update to the SITA AIDX API?"
- "What's the difference between AIDX and Type-B baggage messages?"
- "Validate this AIDX message against the v21.2 schema — what enums are allowed for `MeasurementUnit`?"
- "Which AIDX version introduced General Aviation and de-icing milestones?"
- "Map AIDX into our capability / persona / domain-event model."
