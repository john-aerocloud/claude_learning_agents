---
last_refreshed: 2026-07-11
sources:
  - IATA AIDX XML Implementation Guide v22.1 (schema 22.1)
  - SITA AIDX v21.2 XSD schema set
  - SITA developer.aero AIDX API 17.1.6
---

# 09 — v21.2 XSD Schemas & Machine-Readable Enumerations

_Source: SITA AIDX v21.2 schema set (12 XSDs, `sources/aidx-schema-v21/`), IATA release `id="IATA2021.2"` (2021-11-08). All schemas: `targetNamespace="http://www.iata.org/IATA/2007/00"`, `elementFormDefault="qualified"`. This is the authoritative machine-readable complement to the prose guide — exact enums, cardinality, nillability._

## Big finding: three schema families, not one

The SITA package is broader than the core AIDX FlightLeg trio. It bundles two additional message domains that share the AIDX flight-leg key:

1. **Core FlightLeg** — `FlightLegNotifRQ` (v2.006) / `FlightLegRQ` (v1.002) / `FlightLegRS` (v2.007).
2. **Fuel pre-transaction** — `FuelCommonTypes` + `FuelNotifRQ` (v1.002). Notify-only (no RQ/RS), supports W3C XML digital signature.
3. **Ground Movement** — `GroundMovementCommonTypes` + `FlightLegLinkGroundMovement` NotifRQ (v1.001) / RQ (v1.000) / RS (v2.007).

### File inventory
| File | version | Role |
|---|---|---|
| `IATA_SimpleTypes.xsd` | — | Primitive types + generic enums (Cabin, Condition, Time, Usage…). |
| `IATA_CommonTypes.xsd` | — | Message envelope (`IATA_PayloadStdAttributes`), `SuccessType`, `WarningsType`, `ErrorsType`, `CompanyID_AttributesGroup`. |
| `IATA_AIDX_CommonTypes.xsd` | 2.009 | **AIDX core**: `FlightLegType`, `FlightLegIdentifierType`, `GeneralAviationFlightLegIdentifierType`, AIDX enums. |
| `IATA_AIDX_FlightLegNotifRQ/RQ/RS.xsd` | 2.006/1.002/2.007 | The 3 core messages. |
| `IATA_AIDX_FuelCommonTypes.xsd` | 1.002 | Fuel domain types. |
| `IATA_AIDX_FuelNotifRQ.xsd` | 1.002 | Fuel notify (imports `xmldsig-core-schema.xsd`). |
| `IATA_AIDX_GroundMovementCommonTypes.xsd` | 1.000 | Ground-movement types. |
| `IATA_AIDX_FlightLegLinkGroundMovementNotifRQ/RQ/RS.xsd` | 1.001/1.000/2.007 | GM messages. |

## Message envelope — `IATA_PayloadStdAttributes` (on every root)
`Version` (xs:decimal) is the **only required** attribute. Others optional: `EchoToken`, `TimeStamp`, `Target` (**default `Production`**; enum `Test`|`Production`), `TransactionIdentifier`, `SequenceNmbr`, `TransactionStatusCode` (`Start`|`End`|`Rollback`|`InSeries`|`Continuation`|`Subsequent`), `RetransmissionIndicator`, `CorrelationID`, `AsynchronousAllowedInd`. Rule: if a request has an `EchoToken`, the response MUST echo the identical value.

## Core message roots
- **FlightLegNotifRQ**: `Originator` (1..1) → `DeliveringSystem` (0..1) → `FlightLeg` (1..∞). Doc: "push update flight leg data from an airline to an airport."
- **FlightLegRQ**: `Airline` (0..1; `@Code` required, `@CodeContext` optional). "Request that updated flight leg data be sent."
- **FlightLegRS**: `xs:choice` — either Success branch (`Success` 1..1 empty element → `Warnings` 0..1 → `FlightLeg` 0..∞) **OR** `Errors` 1..1. You get data OR errors, never both.

### `FlightLegType` (payload workhorse)
1. `xs:choice`: **`LegIdentifier`** (`FlightLegIdentifierType`) OR **`GeneralAviationLegIdentifier`** — exactly one.
2. `SpecialAction` (0..1, nillable): `Delete` | `LockDown` | `DoNotDisplay`.
3. `LegData` (bulk container).

`FlightLegIdentifierType`: `Airline`(+CodeContext) → `FlightNumber` (NumericStringLength1to4) → `OperationalSuffix` (0..1) → `DepartureAirport` → `ArrivalAirport` → `OriginDate` (xs:date) → `RepeatNumber` (0..1, attrs `@CurrentInd`, `@AirborneReturnNumber`). `@CurrentInd` true = this leg operated the flight; false = replaced by a later RepeatNumber.

## Enumerations (verbatim — the payoff of the XSD)

### AIDX-specific (`IATA_AIDX_CommonTypes.xsd`)
| Type / attribute | Values |
|---|---|
| `DepartureArrivalType` | `Departure`, `Arrival` |
| `DestinationType` | `Local`, `Transfer`, `Transit` |
| `OriginationType` | `Local`, `Transfer`, `Transit` |
| `DCS_UsageType` | `Booked`, `Accepted`, `Boarded` |
| `FlightLegScopeType` | `Departure`, `Arrival`, `FlightLeg` |
| `FuelQualifierEnumType` | `FuelUplift`, `FuelOnboard`, `TripFuel`, `TakeoffFuel`, `Other_` |
| `MeasurementUnitType` | `Kilogram`, `Pound`, `Ton`, `Tonne`, `Litre`, `USGallon`, `ImperialGallon`, `CubicMetre`, `Centigrade`, `Fahrenheit` |
| `GeneralAviationIdentifier/@Category` (required) | `Callsign`, `Registration`, `Other` |
| `SpecialAction` | `Delete`, `LockDown`, `DoNotDisplay` |
| `AssociatedFlightLegAircraft/@FlightSequence` | `downline`, `upline` |
| `@InternationalStatus` | `International`, `Domestic` |

Open (NOT enumerated in XSD — value list comes from elsewhere/agreement):
- `AircraftParkingPosition/@Qualifier` — required `xs:NMTOKEN`, open (guide lists Gate/Public/Remote/Other but XSD doesn't constrain it).
- `ServiceType` — `xs:string` pattern `[A-Z]{1}` (single letter, per SSIM App. C — not an enum).
- `QualifierType` = union of `AlphaLength4` + `IATA_CodeType`.

### Fuel (`IATA_AIDX_FuelCommonTypes.xsd`)
| Type | Values |
|---|---|
| `ActivityTypeType` | `Refuelling`, `Defuelling`, `Nofuelling` |
| `FuelOrderModeType` | `uplift`, `onboard` |
| `FuelOrderStateType` | `preliminary`, `final` |
| `ProductTypeType` | `JetA`, `JetA1`, `TS1`, `RT` |
| `SignalSourceType` | `Airline`, `GroundHandler`, `Refueller`, `Unknown` |

### Ground Movement (`IATA_AIDX_GroundMovementCommonTypes.xsd`)
| Type | Values |
|---|---|
| `GroundMovementActionType` | `Engine`, `Tow` |
| `SpecialAction` | `Delete`, `LockDown`, `DoNotDisplay` |

### Generic (`IATA_SimpleTypes.xsd`) — relevant subset
`CabinType`: `First`, `Business`, `Economy`. `ConditionType`: `RampTaxi`, `TakeOff`, `ZeroFuel`, `Landing`, `Inflight`. `TimeType`: `UTC`, `Local`. `UsageType`: `Planned`, `Actual`. `IATA_OrICAO_Type`: `IATA`, `ICAO`.

## Fuel schema — what it models
`IATA_AIDX_FuelNotifRQ`: "Fuel pre-transaction message... create and exchange fuel ordering data, fuel delivery data, aircraft's fuel on board, fuelling progress, flight operational data and airport resource data within a wrapper keyed on the AIDX flight-leg key." Optional `ds:Signature` (only message that can be cryptographically signed).

Root: `Originator` (1..1) → `DeliveringSystem` (0..1) → `FuelFlightLeg` (1..∞) → `ds:Signature` (0..1).
`FuelType` holds 4 unbounded collections: `FuelOnBoard`, `FuelOrder`, `FuelProgress`, `FuelSummary`.
- `FuelOrderType` required attrs: `State` (preliminary/final), `Mode` (uplift/onboard), `ActivityType`, `ProductType`. Elements: `OrderId`, `Quantity` (1..2), `AdditiveRequested`, `TruckOnStandby`, `TargetFinishTime`, `Acknowledgement`…
- `FuelSummaryType`: `ReceiptID`, `DeliveryDate`, `IntoPlaneAgentName/Code`, `SupplierName/Code`, `Density`, `Temperature`, `Quantity` (1..2), `FuelStartTime`/`FuelEndTime`.
- `FuelQualifierType` has `@extension` to carry values behind the open `Other_` enum.

## Ground Movement schema — what it models
Links two flight legs of the **same physical aircraft** on the surface — aircraft moving under `Engine` or by `Tow` between an arriving (Previous) and departing (Next) leg, with stand/parking-position resourcing and timestamps.

`FlightLegLinkGroundMovementType`: `GroundMovementIdentifier` (0..1) → `SpecialAction` (0..1) → `GroundMovementData` (1..1):
- `PreviousGroundMovementIdentifier` (0..1, chains movements)
- `AirportOperationLocation` (0..1)
- `Cancelled` (xs:boolean, 0..1)
- `OperationTime` (0..99, nillable)
- `GroundMovementAction` (`Engine`|`Tow`, 0..1)
- `AirportResources` (`GroundMovementAirportResourcesType`, 0..2) — `@Usage` Planned/Actual, `Resource` (0..2) each with `AircraftParkingPosition` + `@DepartureOrArrival`. **This is the stand/gate linkage (arrival stand + departure stand, planned vs actual).**
- `AircraftInfo` (0..1): AircraftType (0..2), AircraftSubType, Registration (0–10), TailNumber (0–5), AgentInfo (0..5, `@Qualifier`=3035).
- `xs:choice` "landing flight": `PreviousFlightLegAircraft` OR `PreviousGeneralAviationFlightLegAircraft`.
- `xs:choice` "departing flight": `NextFlightLegAircraft` OR `NextGeneralAviationFlightLegAircraft`.
- `RemarkTextCode` (0..50), `RemarkFreeText` (0..1).

GM RQ filters on `Airline` (0..1) and/or `Registration` (0..1, nillable, 0–10 chars).

## Cardinality & nillability rules (from XSD, not obvious in prose)
- `OperationalStatus` 0..**5**; `PublicStatus` 0..**2**; `PlannedArrivalAptHistory` 0..**10**; `RemarkTextCode` 0..**50**; `BagCount` 0..**50**; `AircraftType` 0..**2** (IATA + ICAO); `AgentInfo` 0..**5**; `AirportResources`/`Resource` 0..**2** (one departure, one arrival); fuel/GM `Quantity` **1..2** (two units, e.g. mass + volume); GM `OperationTime` 0..**99**.
- **Nillable** (empty element = "explicitly no value", distinct from omitted): `AircraftParkingPosition`, `OperationTime`, `RemarkTextCode`, `RemarkFreeText`, `OperationalStatus`, `AssociatedFlightLegAircraft`, `AircraftType`, `Registration`, `TailNumber`, `AgentInfo`, `SpecialAction`, `Baggage/Weight`, `DeadLoad/Weight`, `Fuel/Quantity`, `BagCount`, GM Previous/Next FlightLegAircraft.
- **Key stability** (doc): `OriginDate` "must not change once initialized"; GA `PlannedDepartureDateTime` is part of the identifier, static.

## Validation asset
These 12 XSDs are the machine-readable schema — usable directly for XML validation of AIDX/Fuel/GM messages. **Bundled with this skill at `schemas/aidx-v21.2/`** (see `schemas/README.md` for validation commands). Example:

```bash
xmllint --noout --schema schemas/aidx-v21.2/IATA_AIDX_FlightLegNotifRQ.xsd samples/create-update-flightlegnotifrq.xml
```
