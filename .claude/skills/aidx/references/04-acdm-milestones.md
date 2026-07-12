---
last_refreshed: 2026-07-11
sources:
  - IATA AIDX XML Implementation Guide v22.1 (schema 22.1)
  - SITA AIDX v21.2 XSD schema set
  - SITA developer.aero AIDX API 17.1.6
---

# 04 — A-CDM Milestone Mapping

_Source: S1 Appendix D / §3.3 "CDM Support". Each A-CDM milestone = one `<OperationTime>` with the activity in `@OperationQualifier` and the stage in `@TimeType`. Added at schema v12.1 to serve worldwide CDM initiatives._

| CDM Acronym | CDM Term | OperationQualifier | TimeType |
|---|---|---|---|
| ELDT | Estimated Landing Time | TDN | EST |
| ALDT | Actual Landing Time | TDN | ACT |
| EIBT | Estimated In-Block Time | ONB | EST |
| AIBT | Actual In-Block Time | ONB | ACT |
| ACGT | Actual Commence of Ground Handling Time | CGT | ACT |
| ASBT | Actual Start Boarding Time | BST | ACT |
| ARDT | Actual Ready Time | RDT | ACT |
| TSAT | Target Start Up Approval Time | SAT | TAR |
| ASRT | Actual Start Up Request Time | SRT | ACT |
| ASAT | Actual Start Up Approval Time | SAT | ACT |
| SOBT | Scheduled Off-Block Time | OFB | SCT |
| TOBT | Target Off-Block Time | OFB | TAR |
| EOBT | Estimated Off-Block Time | OFB | EST |
| AOBT | Actual Off-Block Time | OFB | ACT |
| ECZT | Estimated Commencement of De-icing | DIC | EST |
| ACZT | Actual Commencement of De-icing | DIC | ACT |
| EEZT | Estimated End of De-icing | DIE | EST |
| AEZT | Actual End of De-icing | DIE | ACT |
| TTOT | Target Take Off Time | TKO | TAR |
| CTOT | Calculated Take Off Time | TKO | CAL |
| ATOT | Actual Take Off Time | TKO | ACT |

## Full flight lifecycle (qualifier order, arrival → turn → departure)

Arrival: `THM` in range → `TEN` approach → `TDN` touchdown → `ONB` on-block → `CGT` commence ground handling → `FBG` first bag off → `LBG` last bag off / `ABA` air-bridge attach.

Departure: `CHK` check-in open → `CHC` check-in closed → `GTO` gate open → `BST` start boarding → `FCT` final call → `BEN` final boarding → `GCL` gate close → `FCL` closed → `ABD` air-bridge detach → `RDT` ready → `SRT` startup request → `SAT` startup approval → `OFB` off-block → `DIC`/`DIE` de-ice → `TKO` take-off.

## Billing triggers (financial domain)
Confirmed milestones that drive downstream IS-XML invoice generation in IATA SIS: **AIBT** (ONB/ACT), **ATOT** (TKO/ACT), and total **pax count** (CabinClass Class=7 Qualifier=70A). Flow: AIDX FlightLegNotifRQ → AODB → confirmed milestones → IS-XML invoice in IATA SIS.
