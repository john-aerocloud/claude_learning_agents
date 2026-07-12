---
last_refreshed: 2026-07-11
sources:
  - IATA AIDX XML Implementation Guide v22.1 (schema 22.1)
  - SITA AIDX v21.2 XSD schema set
  - SITA developer.aero AIDX API 17.1.6
---

# 02 — LegData Element Catalog

_Source: S1 (IATA Impl Guide v3.0 / schema 14.1), S5 (SITA v21.2). Paths quoted verbatim._

## Core hierarchy

```
IATA_AIDX_FlightLeg{Notif}RQ / RS
├── Originator                     (NotifRQ)
├── DeliveringSystem               (NotifRQ)
├── Success / Errors>Error         (RS only)
└── FlightLeg  (REPEATING — no limit)
    ├── LegIdentifier   (a.k.a. FlightLegIdentifier — the UFI)
    └── LegData
```

## LegIdentifier — the Unique Flight Identifier (UFI)

Keys the flight. A DELETE needs only this (LegData empty).

| Element | Notes |
|---|---|
| `Airline` (@CodeContext) | Operating airline IATA/ICAO code. `CodeContext="3"` = IATA. Codeset 3055. |
| `FlightNumber` | Per SSIM ch. 4/5/6; pad ≤2-digit to 3 with leading zeros. |
| `OperationalSuffix` | Optional single char A–Z. Recommended use only `'Z'` to split two same-airline+number flights departing same UTC date. Static — change = cancel + recreate. |
| `OriginDate` | UTC scheduled **departure date of the flight** (not the leg). Multi-leg: ALL legs use the first leg's origin date (SFO-DEN-LHR → both legs use SFO date). Static. |
| `DepartureAirport` (@CodeContext) | IATA/ICAO. Codeset 3055. |
| `ArrivalAirport` (@CodeContext) | IATA/ICAO. Does NOT change on diversion/re-route — changes go to `PlannedArrivalAptHistory`. |
| `RepeatNumber` | Departure-attempt number; first = `1`, increments each attempt (min 1 / max 9 since guide v1.1). Each repeat = an additional unique flight leg. |

Edge cases: non-compliant systems w/o OriginDate → dummy `2000-01-01` + mandatory scheduled dep/arr in OperationTime. General Aviation → carrier `"GN"`, FlightNumber = local dep time HHMM, single leg, no suffix, `Registration` mandatory.

## LegData sub-elements

### OperationTime — `LegData/OperationTime`
Carries every milestone time. One element per (milestone × stage).

| Attribute | Meaning | Codeset |
|---|---|---|
| `@OperationQualifier` | Activity the time relates to (touchdown, on-block…) | 9750 (some 2005) |
| `@TimeType` | Significance (scheduled/planned/estimated/target/calculated/actual) | 2005 |
| `@CodeContext` | Which codeset the OperationQualifier is from (2005 or 9750) | — |
| `@RepeatIndex` | Position across repeating times | — |

Example: `<OperationTime OperationQualifier="ONB" CodeContext="9750" RepeatIndex="8" TimeType="ACT">2012-05-19T16:45:00Z</OperationTime>`. Flight status can be inferred from OperationTime. See `04-acdm-milestones.md` for full qualifier/type lists + A-CDM mapping.

### AirportResources — `LegData/AirportResources`
- `AirportResources/@Usage` ∈ `Planned` | `Actual`. Required per assigned resource.
- `Resource/@DepartureOrArrival` ∈ `Departure` | `Arrival`.
- `Resource` children:
  - `AircraftParkingPosition` (@Qualifier ∈ Gate|Public|Remote|Other) — gate / hard stand.
  - `AircraftTerminal` (SSIM App. D; codesets 3223/3233).
  - `PublicTerminal` (@RepeatIndex) — SSIM App. D.
  - `AirportZone` — e.g. "Concourse C", "Charter", "GA".
  - `PassengerGate` (@RepeatIndex).
  - `Runway`.
  - `BaggageClaimUnit` (@AreaLocation codeset 9988; @Qualifier; @ServiceClass codeset 9873; children `OpenTime`, `CloseTime`, `SegregationName`).
  - `BaggageMakeUpBelt` — makeup belt(s) for outgoing bags, repeating up to 5.
  - `CheckInInfo` (@Class codeset 9873; @Location codeset 9932; @Qualifier — [truncated in S1]).

### AircraftInfo — `LegData/AircraftInfo`
| Child | Notes |
|---|---|
| `Registration` | Manufacturer registration (e.g. `GEUXH`). |
| `AircraftType` | Codeset 7800 / SSIM App. A aircraft group (e.g. `DC9`, `321`). |
| `AircraftSubType` | Codeset 7800 SSIM type (e.g. `M83`). |
| `CallSign` | From flight plan (e.g. `AAL1234`). |
| `AgentInfo` | Handling-agent id/name; included only if not the airline. `@Qualifier` codeset **3035** (mandatory if populated), `@DepartureOrArrival`. |
| `CrewInfo` | `@Qualifier` codeset 9873 (recommend `7`=All). |
| `Baggage` | `BagCount` (@Location = bin/ULD id, e.g. `UKE1234UA`), `Weight` (+@MeasurementUnit), `@DestinationType` Local/Transit/Transfer, `@ServiceClass` codeset 9873. |
| `OwnerAirline` | `Airline` = aircraft owner if ≠ operator. |

### Passenger counts — `LegData/CabinClass`
- `CabinClass/@Class` — codeset 9873 (1 First … 7 All).
- `CabinClass/PaxCount` — `@Qualifier` codeset 6353 (recommend `70A` = total), `@DestinationType` Local/Transit/Transfer.
- `CabinClass/SeatCapacity` — sibling; requires `@Class`.

```xml
<CabinClass Class="2"><PaxCount Qualifier="70A">25</PaxCount></CabinClass>
<CabinClass Class="7"><PaxCount Qualifier="70A" DestinationType="Transfer">42</PaxCount></CabinClass>
```

### Status / display
- `LegData/OperationalStatus` — codesets 1245 & 2005. Irregular ops: `DV` diverted, `DX` cancelled, `RT` re-route, `GRT` ground return, `SQ` reinstate.
- `LegData/PublicStatus` (@CodeContext 1245 or 2005) — publicly displayable.
- `LegData/RemarkTextCode` (@Qualifier codeset 9932; also 2005/9750) — display-only, no processing.
- `LegData/PublicFlightDisplay/AirlineType` — carrier for public display if ≠ LegIdentifier/Airline.
- `LegData/PlannedArrivalAptHistory` — arrival-airport change history (diversions/re-routes).
- `LegData/ServiceType` — SSIM service type (e.g. `J` scheduled pax).

### Associated legs / code share
- `AssociatedFlightLegSchedule/@FlightSequence` ∈ `upline` | `downline` (multi-leg same flight number).
- `AssociatedFlightLegAircraft` — next flight served by this aircraft (Airline, FlightNumber, Dep/ArrAirport, OriginDate, RepeatNumber).
- `CodeShareInfo/Airline` — marketing carrier.

### Customs / security
- `LegData/ClearanceAgreement` — codeset 9970: `TRB` Transborder, `INT` International, `DOM` Domestic, `SCH` Schengen.
- `LegData/ArrSecurityCheckInd` — Boolean; TRUE if extra arrival security checks required.

## Known gaps ([truncated in S1] / to confirm from S2/S6)
Dedicated **Delay** (reason-code) elements, **Cargo**, **Fuel**, `CrewInfo` detail, and Weight rows fall in the truncated tail of the S1 Data Description Table. Confirm exact element/attribute names from v22.1 guide (S2) or schema zip (S6).

---

# Part 2 — Appendix J: Full Element Rows (Delay / Fuel / Cargo / Crew / GA) + Appendix K Schema Changes

_Source: S2 (IATA Impl Guide v22.1) Appendices J & K, extracted from the raw PDF via `pdftotext -layout`. These are the rows the earlier web_fetch passes could not reach. Element / path / codeset / notes quoted verbatim._

## Previously-missing element families (past letter C)

### Delay / Irregularity — `LegData/IrregularityDelay` (repeating group, up to 8)
| Element | Path | Codeset | Notes |
|---|---|---|---|
| `ReasonCode` | `LegData/IrregularityDelay` | **IRR** | IATA delay code from the **Airport Handling Manual (AHM)**. Format: numeric or 2-char alpha code + one-char sub-code. **New delay-code schema = AHM 732** (as of AHM 44th ed., AHM 730 & 731 phased out; free app at iata-ahm732.azurewebsites.net). |
| `Duration` | `LegData/IrregularityDelay` | — | Actual delay duration. ISO-8601 duration, always starts `PT` (e.g. `PT2H15M`). |
| `IrregularityDelay/@DepartureOrArrival` | `LegData` | enum | `Arrival` \| `Departure`. |

### Fuel — `LegData/AircraftInfo/Fuel`
| Element | Path | Notes |
|---|---|---|
| `Quantity` | `LegData/AircraftInfo/Fuel` | Quantity of fuel (nillable since 14.2). |
| `Quantity/@MeasurementUnit` | `LegData/AircraftInfo/Fuel` | enum: Kilogram, Pound, Ton, Tonne, Litre, USGallon, ImperialGallon. |
| `Type` | `LegData/AircraftInfo/Fuel` | enum: **FuelUplift** (fuel the fueller should load), **FuelOnboard** (fuel in tanks on stand), **TripFuel** (predicted burn in flight), **TakeoffFuel** (fuel at takeoff). |
| `Type/@extension` | `LegData/AircraftInfo/Fuel` | Non-enumerated fuel type by mutual agreement. |

### Dead load / Cargo — `LegData/AircraftInfo/DeadLoad` + `LegData`
| Element | Path | Codeset | Notes |
|---|---|---|---|
| `Type` | `LegData/AircraftInfo/DeadLoad` | **7085** | Type of dead load (e.g. `D` = crew bags). |
| `DeadLoad/@DestinationType` | `LegData/AircraftInfo` | enum | Local \| Transit \| Transfer — onward routing of cargo/mail. |
| `Weight` | `LegData/AircraftInfo/DeadLoad` | — | Repeating dead-load weights (cargo, mail…). Summary level for ground-handler resourcing. |
| `Weight/@MeasurementUnit` | `LegData/AircraftInfo/DeadLoad` | enum | Only Kilogram/Pound/Ton/Tonne valid for DeadLoad. |
| `SpecialCargo` | `LegData` | **CAR** | Special cargo onboard (live animals, HazMat, human remains…). |

### Baggage weight — `LegData/AircraftInfo/Baggage`
| Element | Notes |
|---|---|
| `Weight` | Weight of baggage loaded (nillable since 14.2). |
| `Weight/@MeasurementUnit` | Only Kilogram/Pound/Ton/Tonne valid for baggage. |
| `BagCount` | Nillable since 14.1; `@Location` = bin/ULD id; maxOccurs 50. |

### Crew — `LegData/AircraftInfo/CrewInfo`
| Element | Codeset | Notes |
|---|---|---|
| `CrewInfo` | — | Number of crew (cockpit & cabin, jump seat). Repeatable. |
| `CrewInfo/@Airline` | IATA/ICAO | Airline associated with the crew. |
| `CrewInfo/@Qualifier` | **9873** | Cabin class associated with the crew. Mandatory when CrewInfo provided. |
| `FlightCrewAirline` | `LegData` | Airline providing flight crew if ≠ operator. |
| `CabinCrewAirline` | `LegData` | (added 16.1) cabin crew airline if ≠ operator. |

### General Aviation — `GeneralAviationLegIdentifier` (added schema 16.2)
| Element | Notes |
|---|---|
| `GeneralAviationIdentifier` | Unique GA id — ATC callsign or registration. |
| `GeneralAviationIdentifier/@Category` | enum: Callsign \| Registration \| Other. |
| `DepartureAirport`, `FlightNumber`, `OperationalSuffix` | GA flights typically have no flight number/suffix. |
| `PlannedDepartureDateTime` | Part of the GA identifier; static (differentiates same-aircraft repeat departures same day). |
| `RepeatNumber` (+ `@CurrentInd`, `@AirborneReturnNumber`) | As per commercial LegIdentifier. |

### De-icing resource — `LegData/AirportResources/Resource` (added 16.1, A-CDM)
| Element | Codeset | Notes |
|---|---|---|
| `DeIceLocation` | — | Where the aircraft is de-iced (e.g. `S34`). |
| `DeIceLocation/@Qualifier` | **9932** | `PAR` parking stand \| `PAN` dedicated de-ice pan. |

### Check-in position ranges — `LegData/AirportResources/Resource/CheckInInfo`
| Element | Notes |
|---|---|
| `FirstPosition` / `LastPosition` | Start/end of a desk-position range. Repeating; single desk → first = last. |
| `CheckInInfo/@Qualifier` | codeset **CHK** — type of position range (e.g. `ODD` out-of-gauge). |
| `CheckInInfo/@Class` | codeset 9873. `@Location` codeset 9932. |

### Additional resource / gate elements
`PassengerGate` (repeat ×3), `PublicTerminal` (3223/3233, repeat ×3), `AircraftParkingPosition` (+@Qualifier Gate/Public/Remote/Other), `RemoteOperationalGate` (repeat ×3), `RemoteOperationalStand`, `PreClearedGateInd` (Boolean — Schengen/trans-border pre-clear gate), `PaxBusInd`, `CrewBusInd`, `Runway`, `Resource/@ChargeType` (codeset **5903**), `BaggageMakeUpBelt` (repeat up to 100 since 20.2).

### Other LegData elements worth cataloguing
| Element | Codeset / type | Notes |
|---|---|---|
| `OperationalStatus/@FlightLegScope` | enum | Arrival \| Departure \| FlightLeg. `DX` cancel only reversible via `SQ`. |
| `RemarkTextCode` (+@FlightLegScope, @Qualifier 9932) | 2005 & 9750 | Coded remarks; sender never sends free words. `TER` public, `PAR` apron. |
| `RemarkFreeText` (+@FlightLegScope) | free text | Staff supplementary info. |
| `PublicStatus` (+@FlightLegScope) | 1245 & 2005 | **DEPRECATED**. |
| `SpecialAction` | enum | `Delete` (only for legs created in error), `LockDown` (restrict access on incident), `DoNotDisplay`. |
| `SpecialEmphasis` | **EMP** | Flag special handling (e.g. `VP` VIP), repeat ×3. |
| `TechnicalStopInd` (+@DepartureOrArrival) | Boolean | Arrive/depart w/o enplaning pax/cargo/bags. |
| `ServiceType` | IATA (SSIM App. C) | Any single alpha char since 13.2 (incl. `Y`). |
| `OperatingAlliance` / `SharedAlliance` | **9906** | e.g. `701` = oneworld. |
| `EstFlightDuration` | ISO-8601 | Off-blocks→on-blocks (e.g. `PT11H45M`). |
| `OperationDuration` (+@OperationQualifier 9750, @TimeType 2005) | — | Durations (taxi, turnaround, de-ice) vs times-of-day. Added 16.2. |
| `InflightService` (9932, repeat ×10) / `InflightMealService` (7161) | per cabin | On-board facilities / meals. |
| `FleetNumber`, `TailNumber` | — | Airline ship/fleet number; tail number (often last 3 of registration). |
| `DepSecurityCheckInd` / `ArrSecurityCheckInd` | Boolean | Extra security required dep/arr. |
| `PaxCount/@DCS_Usage` | enum | Booked \| Accepted \| Boarded (added 16.2). |
| `PaxCount/@OriginationType` | enum | Local \| Transit \| Transfer at departure (added 16.2). |
| `PaxCount/@Usage` | enum | Planned \| Actual (mandatory if PaxCount provided). |
| `CodeShareInfo` | — | `Airline`, `FlightNumber`, `OriginationDate`, `OperationalSuffix` (20.2), `SharedAlliance`. |

### Generic attributes (J3)
- `RepeatIndex` — order for a repeating item.
- `CodeContext` — names the IATA codeset for the coded value (often 3055 for airline/airport).

## New codesets surfaced here (add to 03-codesets.md scope)
- **IRR** — irregularity/delay reason codes (now **AHM 732**).
- **7085** — dead load type.
- **CAR** — special cargo type.
- **EMP** — special emphasis / handling.
- **9906** — airline alliance (`701` oneworld…).
- **5903** — resource charge type.
- **7161** — inflight meal service.
- **AGT** — handling-agent identifier (note: `AgentInfo/@Qualifier` uses 3035, not AGT — corrected in schema 13.2).
- **CHK** — check-in position-range type.
- OperationQualifier additions (codeset 9750, schema 20.2): **`FBA`** First Bag Arrived, **`LBA`** Last Bag Arrived.

---

## Appendix K — Schema Change Log (12.2 → 22.1)

Changes are generally backwards-compatible. Codeset changes are NOT recorded in the guide (additions only, so compatibility holds).

- **13.1** — no changes.
- **13.2** — `ServiceType` restriction relaxed to any single alpha char (allows `Y`); corrected `AgentInfo/@Qualifier` doc to codeset **3035** (was AGT).
- **14.1** — `AssociatedFlightSchedule/@FlightSequence` (upline/downline) added; `TechnicalStopInd/@DepartureOrArrival` added + made repeating (max 2); `CabinClass/PaxCount` maxOccurs 3→20; `BagCount` made nillable.
- **14.2** — `Baggage/Weight`, `DeadLoad/Weight`, `Fuel/Quantity` made nillable (so an erroneous value can be cleared, not zeroed).
- **15.1** — fixed `downlilne`→`downline` typo; added MeasurementUnit values (fuel pre-transaction only).
- **15.2** — `WarningsType`/`ErrorsType`: `Type` made optional, `Owner` attribute added; removed codeset 9321 ref from `Type` doc.
- **16.1** — `DeIceLocation` (+@Qualifier) added (A-CDM); `AircraftType/@CodeContext` (codeset 3055) added, allow 4-char + up to 2 instances (IATA+ICAO), `ZZZ` for undefined types; `FlightCrewAirline` & `CabinCrewAirline` added; `LegIdentifier/RepeatNumber/@AirborneReturnNumber` added; `AssociatedFlightLegAircraft/@FlightSequence` (upline/downline) added.
- **16.2** — **`GeneralAviationLegIdentifier`** added; **`OperationDuration`** added; `PaxCount/@DCS_Usage` (Booked/Accepted/Boarded) added + `@Usage` made optional; `PaxCount/@OriginationType` added; `PaxCount/@Qualifier` allows 4-char alphanumeric (RP 1708a reduced-mobility codes); `PaxCount` maxOccurs 20→99; `@FlightLegScope` added to OperationalStatus/PublicStatus/RemarkTextCode/RemarkFreeText, PublicStatus & RemarkFreeText maxOccurs 1→2.
- **17.1 / 17.2 / 18.1 / 18.2 / 19.1 / 19.2 / 20.1** — no AIDX-relevant changes.
- **20.2** — `CodeShareInfo/OperationalSuffix` added; `RemarkFreeText` FlightLegScope typo fix; `AircraftTerminal`/`PublicTerminal` restricted to alphanumeric, no zero-length; `BaggageClaimUnit`/`BaggageMakeupBelt` maxOccurs 5→100; added `BaggageProcess`, `SegregationName`, `OpenTime`, `CloseTime` to claim unit/makeup belt; **codeset 9750 gains `FBA` (First Bag Arrived), `LBA` (Last Bag Arrived)**.
- **21.1** — `AssociatedGeneralAviationFlightLegAircraft` added to LegData.
- **21.2 / 21.3 / 21.4** — no AIDX-relevant changes.
- **22.1** — `ReasonCode` note updated to reference new delay-code schema **AHM 732**.
