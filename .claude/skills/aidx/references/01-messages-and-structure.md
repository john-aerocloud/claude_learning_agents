---
last_refreshed: 2026-07-11
sources:
  - IATA AIDX XML Implementation Guide v22.1 (schema 22.1)
  - SITA AIDX v21.2 XSD schema set
  - SITA developer.aero AIDX API 17.1.6
---

# 01 — AIDX Overview & Message Types

_Source: S1 (IATA Impl Guide v3.0 / schema 14.1), S5 (SITA), S11/S12 (orientation)._

## What AIDX is

AIDX = **Aviation Information Data Exchange**: the global XML messaging standard for exchanging flight data between airlines, airports, and any third party consuming operational data. Endorsed by IATA and ACI.

- Development began 2005 (roots in the ACI/A4A **FIMS** schema, "Seattle Summit" 2003). Launched Oct 2008 as a combined effort of 80+ airlines, airports, and vendors.
- ~**180 distinct data elements**: flight identification, operational times, disruption details, resource requirements, passenger/baggage/fuel/cargo statistics, aircraft details.
- Endorsed as **IATA RP 1797A**, **ACI RP 501A07**, **ATA RP 30.201A**.
- Standard for **SESAR A-CDM** information exchange, **ACI ACRIS A-CDM Web Services**, ICAO-supported A-CDM exchange.
- Governance: IATA XML Working Group under **PADIS** (Passenger Data Interface Standards). Changes go to the PADIS Board twice a year. Contact `padis.secretariat@iata.org`; forums `www.aidx.aero`.

## The three message types

AIDX defines exactly three message types; each has its own schema. All domain data rides inside the `LegData` structure — there are **no separate message types per domain**.

### 1. `IATA_AIDX_FlightLegNotifRQ` — Notification (unsolicited push)
- Transfers **unsolicited** flight records between airlines, airports, aggregators, vendors.
- Sent on an update trigger, on a schedule, or at a time interval.
- Carries **one or more** flight leg records (`FlightLeg` repeats, no limit).
- Despite the `RQ` suffix it is a **notification, not a command** — the recipient is not required to act.

### 2. `IATA_AIDX_FlightLegRQ` — Request (pull)
- Requests flight records from a partner.
- Only defined parameter is a **carrier code**; if omitted, return all relevant carrier flights. Extra criteria (e.g. next 24h) by bilateral agreement.
- Response is either (a) synchronous `FlightLegRS` with the data, or (b) synchronous `FlightLegRS` ack followed by asynchronous `FlightLegNotifRQ` with the data.

### 3. `IATA_AIDX_FlightLegRS` — Response / acknowledgement
- Ack to a `FlightLegNotifRQ`, or synchronous response to a `FlightLegRQ`.
- Indicates success (`<Success/>`) or errors (`<Errors><Error .../></Errors>`).
- `Error/@Type` (guide) / `Error/@Code` + `@ShortText` (SITA) — error codeset **9321**.

## Three data-flow patterns (Impl Guide §3.4)

1. **Unsolicited Notification + optional sync ack** — push `FlightLegNotifRQ`; optional `FlightLegRS` ack.
2. **Request + synchronous reply** — `FlightLegRQ` → `FlightLegRS` with data.
3. **Request + sync ack + async reply** — `FlightLegRQ` → `FlightLegRS` ack → later `FlightLegNotifRQ` with data. Preferred when data packaging is slow (keep connections open only a few seconds).

## Message envelope / root

Root element = the message-type name. Default namespace `http://www.iata.org/IATA/2007/00`.

Root attributes seen: `Version`, `TimeStamp`, `Target`, `TransactionIdentifier`, `TransactionStatusCode`, `RetransmissionIndicator`, `PrimaryLangID`, `AltLangID`, `CodeContext`, `SequenceNmbr`.

Routing/header elements (in NotifRQ): `<Originator>` and `<DeliveringSystem>`, each with `Code`, `CodeContext`, `CompanyShortName`, `TravelSector`.

## Structural principles

- **Flight leg** = one aircraft movement (dep airport → arr airport). A turnaround = two leg structures (arriving + departing).
- Multi-leg flights linked via `AssociatedFlightLegSchedule`; same-aircraft turns via `AssociatedFlightLegAircraft`.
- **Code shares**: all data for a leg (incl. code shares) in a single `LegData`; marketing carriers in `CodeShareInfo`. No separate leg per code share.
- **Nil vs missing**: element *missing* = no info / no change (don't clear). Element present with `xsi:nil="true"` = explicitly clear stored value. Never send empty elements like `<PassengerGate/>`. Mandatory fields must not be nil.
- **Repeating elements**: keep same order across messages; `RepeatIndex` tracks list position; if one changes, resend all siblings.
- **Dates/times**: `xsd:DateTime`, always **UTC with trailing Z** (`2015-06-03T12:15:00Z`); dates `YYYY-MM-DD`. Encoding **UTF-8**.
- **Cancellation** = set `OperationalStatus="DX"` (deletion is only for flights sent in error).
- **Validation**: at least one side must XML-validate every message; double validation is default.
- AIDX does **not** mandate transport or security — bilateral agreements define SOAP/TCP/MQ/web-service transport, SSL/auth, mandatory vs optional fields, valid-value lists.

## Domain boundaries (what AIDX does NOT carry)

- **Passenger-level data** (PNR, API, boarding pass) → IATA PADIS/EDIFACT, not AIDX.
- **Bag-level control** (BSM, BPM, BUM, BTM, BNS) → IATA RP 1745 Type B / BAG XML. AIDX carries only flight-level bag summary.
- **Billing** → IATA SIS / IS-XML. AIDX supplies the operational events (AIBT, ATOT, pax count) that trigger invoicing.
