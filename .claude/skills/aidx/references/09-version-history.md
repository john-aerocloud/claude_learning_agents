---
last_refreshed: 2026-07-11
sources:
  - IATA AIDX XML Implementation Guide v22.1 (schema 22.1)
  - SITA AIDX v21.2 XSD schema set
  - SITA developer.aero AIDX API 17.1.6
---

# 06 — Version History

_Source: S1 §1.5 + change log, S5._

## Schema lineage
- **FIMS** (ACI/A4A) — origin, "Seattle Summit" 2003; ~103 flight + 34 ground-stats elements by 2005.
- **7.1** (2007) — FIMS adopted as AIDX. (No RQ/RS message types; interop with later versions may need XSLT.)
- **8.1** (2008) — released with RP1797A + BRD; replaced FIMS. Impl Guide targets "8.1 and newer".
- **12.1** (2012) — added A-CDM / CDM support; **introduced the separate `TimeType` attribute** (split from combined OperationQualifier).
- **14.1** (2014) — aligned to Impl Guide v3.0.
- **15.1** — seen in older SITA delete sample.
- **17.1** — Impl Guide S3 version.
- **21.2** — schema supported by SITA API (S5).
- **22.1** — latest Implementation Guide found (S2, not yet extracted).

Changes since 8.1 are generally **additive** (few backward-compat issues).

## Implementation Guide document versions
| Ver | Date | Change |
|---|---|---|
| 1.0 | 2010-07-13 | Initial publication |
| 1.1 | 2010-11-11 | RepeatNumber min 1 / max 9 |
| 1.2 | 2012-03-05 | Updated for AIDX 12.1 |
| 2.0 | 2013-03-19 | General update |
| 3.0 | 2014-02-21 | Updated for AIDX 14.1 (fully-extracted S1) |
| 15.2 | 2015-09-21 | AIDX 15.1 & 15.2; Appendix H added; **guide version aligned to schema version from here on** |
| 16.1 | 2016-03-01 | AIDX 16.1 |
| 17.1 | 2017-03-07 | AIDX 16.2 & 17.1 (adds `GeneralAviationLegIdentifier`, from 16.2) |
| 22.1 | 2022-03-01 | General update, schema 17.1 onward; delay `ReasonCode` → AHM 732; `PublicStatus` deprecated; de-icing CDM milestones. Pages 1–52 extracted (S2); App. J & K gated |

Schema-change buckets present in v22.1 Appendix K (TOC only): versions 13.1 → 22.1 (21 sets). The v14.1→22.1 delta = change-sets 14.2, 15.1, 15.2, 16.1, 16.2, 17.1, 17.2, 18.1, 18.2, 19.1, 19.2, 20.1, 20.2, 21.1, 21.2, 21.3, 21.4, 22.1 (bodies gated).

## Key inflection for a skill
Any AIDX consumer/producer must know whether the peer is **pre-12.1** (single combined time code, no `TimeType`) or **12.1+** (OperationQualifier + TimeType). This is the biggest interop fault line.

---

# 07 — v22.1 Delta (vs v14.1 baseline)

_Source: S2 (IATA Impl Guide v22.1, effective 01 Mar 2022, aligned to schema 22.1). Extracted pages 1–52; Appendices J & K (pp. 53–78) still gated — see gaps._

Since guide v15.2, the **guide version number is aligned to the schema version**. The v22.1 change note: "General update... schema changes from version 17.1 and onward. Update of ReasonCode reference to new delay code schema **AHM 732**."

## Confirmed changes since v14.1

### Deprecations
- **`PublicStatus` is DEPRECATED** — use `LegData/RemarkTextCode` for public-facing status instead.

### New elements
- **`GeneralAviationLegIdentifier`** — added in schema **16.2**. For GA flights: ATC callsign / registration + departure airport + planned departure time. (Supersedes the old "carrier GN + HHMM flight number" GA workaround.)
- **Appendix H "Associated Flights"** — new section added in guide 15.2 (didn't exist in v14.1).

### Delay codes
- `ReasonCode` now references the **AHM 732** delay-code schema (was the older IATA delay code list). Exact Delay element path/attributes live in Appendix J (gated).

### New A-CDM milestones — de-icing quartet (added post-14.1)
| Acronym | Term | OperationQualifier | TimeType |
|---|---|---|---|
| ECZT | Estimated Commencement of De-icing | DIC | EST |
| ACZT | Actual Commencement of De-icing | DIC | ACT |
| EEZT | Estimated End of De-icing | DIE | EST |
| AEZT | Actual End of De-icing | DIE | ACT |

(Full A-CDM table in `04-acdm-milestones.md`, now updated with these.)

### New OperationalStatus / CDM lifecycle codes (codeset 9750)
Added for full CDM lifecycle status on `LegData/OperationalStatus`:
`SCH` Scheduled · `INI` Initiated (flight plan activated) · `TKO` Airborne/Departed · `FIR` Entered local FIR · `FIN` Final approach · `LAN` Landed · `ONB` On block · `SEQ` Sequenced (TSAT issued) · `BST` Boarding · `RDT` Ready for start · `OFB` Off block · `DIR` Ready for de-icing · `DIC` De-icing in progress.

### Extended displayed-status codes (codeset 9750, `RemarkTextCode`)
Adds beyond the v14.1 set: `STE` Stack Entry · `STX` Stack Exit · `EAR` Early · `SCT` On Time · `DEL` Delayed · `LAN` Landed/Arrived (`ONB`).

## Positioning
Guide now explicitly frames AIDX as the exchange standard for **SESAR A-CDM, ACI ACRIS A-CDM Web Services, and ICAO A-CDM (Asia Pacific)**.

## Still gated (need raw PDF pages 53–78 — see SOURCES gaps)
- **Appendix J — Data Description Table**: the alphabetical element rows past `CheckInInfo` — Delay (reason/duration), Cargo, Fuel, CrewInfo detail, Weight, LoadInfo. Element path + attributes + codeset per row.
- **Appendix K — Schema Changes**: bodies of change-sets K4–K21 (versions 14.2 → 22.1). TOC recovered (18 change sets) but not contents.

Recovery method that should work: open the PDF in the Chrome browser tool and `get_page_text` on pages 53–78, or drop the binary PDF into a connected folder for local `pdftotext -layout` extraction.
