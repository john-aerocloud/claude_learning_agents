---
last_refreshed: 2026-07-11
sources:
  - IATA AIDX XML Implementation Guide v22.1 (schema 22.1)
  - SITA AIDX v21.2 XSD schema set
  - SITA developer.aero AIDX API 17.1.6
---

# 03 — IATA PADIS Codesets Referenced by AIDX

_Source: S1, S5. Full enumerations live on the PADIS extranet + schema zip (S6). Values below are those confirmed in the sources._

AIDX populates coded attributes from IATA **PADIS** codesets (free, PADIS extranet). `@CodeContext` on an element names the codeset in force.

| Codeset | Used for | Confirmed values |
|---|---|---|
| **2005** | `TimeType`; `OperationalStatus`/`RemarkTextCode`; legacy combined time codes | TimeType: `SCT` Scheduled, `PLN` Planned, `EST` Estimated, `TAR` Target, `CAL` Calculated, `ACT` Actual. Status: `DV` diverted, `DX` cancelled, `RT` re-route, `GRT` ground return |
| **9750** | `OperationQualifier`; displayed (FIDS) status | Qualifiers: `CHK` check-in open, `CHC` check-in closed, `GTO` gate open, `BST` start boarding, `FCT` final call, `BEN` final boarding, `GCL` gate close, `FCL` closed, `THM` in range, `TEN` approach, `TDN` touchdown, `ONB` on-block (arr), `CGT` commence ground handling, `FBG` first bag unloaded, `LBG` last bag unloaded, `ABA` air bridge attach, `ABD` air bridge detach, `RDT` ready time, `SRT` startup request, `SAT` startup approval, `OFB` off-block (dep), `DIC` de-ice start, `DIE` de-ice end, `TKO` take-off |
| **1245** | `OperationalStatus`/`PublicStatus` (flight & route type). `PublicStatus` DEPRECATED in v22.1 → use `RemarkTextCode`. | `SQ` reinstate, `NOP` non-operational, `OP` operational, `SCH` scheduled, `7DO` domestic (≤v11.1), `7IN` international (≤v11.1) |
| **9932** | `RemarkTextCode/@Qualifier`, `CheckInInfo/@Location` | `AIR`, `BAG`, `CHK`, `COU`, `GTE`, `LND`, `LOU`, `PAR`, `PUB`, `STF`, `TER` |
| **3035** | Handling-agent type (`AgentInfo/@Qualifier`) | `BAG` baggage, `PAX` passenger, `CAT` catering, `FUE` fuel, `FLT` flight (catch-all) |
| **9873** | Cabin / service class; crew qualifier | `1` First, `2` Business, `3` Third (all economy), `4` Economy Premium, `5` Economy, `6` Economy Discounted, `7` All |
| **6353** | `PaxCount/@Qualifier` | `70A` Total passengers (also `UM` unaccompanied minors by agreement) |
| **9321** | `Error/@Type` (FlightLegRS) | `294` Invalid Format (don't resend until fixed); `911` Unable to process/system error (retry). SITA also returns app codes e.g. `1007` Service Exception |
| **9970** | `ClearanceAgreement` | `TRB` Transborder, `INT` International, `DOM` Domestic, `SCH` Schengen |
| **9988** | `BaggageClaimUnit/@AreaLocation` | `DOM`, `INT`, `TRA` transit, `TRS` transfer, `SCH` |
| **7800** | `AircraftType` / `AircraftSubType` | SSIM aircraft group/type codes (e.g. `DC9`, `M83`, `321`) |
| **3223 / 3233** | `AircraftTerminal` | SSIM terminal info (SSIM App. D) |
| **3055** | Airline / airport codes | IATA vs ICAO (`CodeContext="3"` = IATA) |

## DestinationType (attribute enum, not a PADIS codeset)
`Local` | `Transit` | `Transfer` — on `PaxCount` and `Baggage`.

## CDM lifecycle status codes (codeset 9750, v22.1) — `OperationalStatus`
Added for full A-CDM lifecycle: `SCH` Scheduled, `INI` Initiated (flight plan activated), `TKO` Airborne/Departed, `FIR` Entered local FIR, `FIN` Final approach, `LAN` Landed, `ONB` On block, `SEQ` Sequenced (TSAT issued), `BST` Boarding, `RDT` Ready for start, `OFB` Off block, `DIR` Ready for de-icing, `DIC` De-icing in progress.

## Displayed status codes (codeset 9750, v22.1) — `RemarkTextCode`
`BST` Boarding, `BEN` Final Boarding, `GCL` Gate Closed, `FCL` Flight Closed, `OFB` Departed, `THM` In Range, `STE` Stack Entry, `STX` Stack Exit, `TEN` Approach, `LAN`/`ONB` Landed/Arrived, `EAR` Early, `SCT` On Time, `DEL` Delayed. (Plus 2005 `DV`/`DX`/`RT`/`GRT` for in-flight status.)

## Legacy time codes (schema ≤ v11.1)
Before v12.1, a single combined `OperationQualifier` encoded both activity and stage, with **no `TimeType`**: e.g. `EA` estimated arrival touchdown, `SCA` scheduled on-block arrival, `EB` estimated on-block, `OB` actual on-block, `SCD` scheduled off-block, `ED` estimated off-block, `AD` actual off-block, `EO` estimated take-off. v12.1 split these into `OperationQualifier` + `TimeType`.

## To capture (gap)
The values above are IATA's **AIDX-preferred subset** (Appendix D) — confirmed verbatim from both the v14.1 and v22.1 guides. The **full raw PADIS Code Set Directory** (every code, incl. non-AIDX) is **gated** behind the PADIS extranet; public mirrors (pnr.lt, Datalex, docplayer) returned empty/JS-rendered. The AIDX subset above is what matters for interoperable exchange. To get the complete registry: PADIS extranet login or drop the directory PDF into a connected folder.
