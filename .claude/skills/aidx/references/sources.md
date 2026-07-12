---
last_refreshed: 2026-07-11
---

# Sources & Refinement Log

## Primary sources

| Source | Version | Purpose |
| --- | --- | --- |
| IATA AIDX XML Implementation Guide (`iata.org/.../aidx-xml-imp-guide-v22.1.pdf`) | Guide v22.1 / schema 22.1 (Mar 2022) | **Normative reference.** Message types, LegData, codesets (Appendix D), A-CDM mapping (Appendix D3.3), full element table (Appendix J), schema change-log (Appendix K), TPA_Extensions. Fully extracted. |
| IATA AIDX XML Implementation Guide (`.../aidx-xml-implementation-guide.pdf`) | Guide v3.0 / schema 14.1 (Feb 2014) | Baseline cross-check for the v14.1→22.1 delta. |
| SITA AIDX v21.2 XSD schema set | schema 21.2 (IATA2021.2, 2021-11-08) | **Machine-readable schema.** Enumerations, cardinality, nillability, envelope attributes; core FlightLeg + Fuel + Ground Movement families. Validation-ready. |
| SITA AIDX Overview (`developer.aero/api-catalog/aidx-overview`) | API 17.1.6 / schema v21.2 | Concrete REST publish API: endpoints, OAuth2, POST/PUT/DELETE, rate limits, error codes, real XML samples. |
| IATA — Aviation Info. Data Exchange landing (`iata.org/en/publications/info-data-exchange/`) | current | Official product page; links to the current guide + schema. |
| ACI ACRIS / SESAR A-CDM references | — | AIDX as the A-CDM information-exchange standard. |

The full underlying research library (distilled notes, the v22.1 PDF, full text, and all 12 XSDs) lives alongside this skill in `../aidx-library/`.

## Endorsements

IATA **RP 1797A** · ACI **RP 501A07** · ATA/A4A **RP 30.201A** · SESAR A-CDM · ACI ACRIS A-CDM Web Services · ICAO A-CDM.

## Known gaps / confirmation needed

1. **Full raw PADIS Code Set Directory** (every code in 1245 / 2005 / 9750 beyond the AIDX-preferred subset) is gated behind the PADIS extranet; public mirrors returned empty. The subset in `03-codesets.md` + the XSD enums in `08-xsd-schema.md` cover interoperable exchange. Only needed for exhaustive code validation.
2. **Delay reason codes** live in the IATA Airport Handling Manual (**AHM 732**, replacing AHM 730/731 at the 44th edition), not in AIDX itself. Free lookup app at `iata-ahm732.azurewebsites.net`.
3. **Transport & security** are per bilateral agreement. The SITA REST API is documented in `07`; MQ / SOAP / direct-AODB deployments will differ — confirm per integration.
4. Confirm the exact bilateral field-mandatory/optional matrix with each trading partner before go-live.

## Refinement log

| Date | Change |
| --- | --- |
| 2026-07-11 | Initial skill authored from the AIDX reference library (guide v22.1 incl. Appendices J & K, v21.2 XSDs incl. Fuel + Ground Movement, SITA API). Two authored references (sequences, boundaries/comparison) and the Aerocloud capability/persona/event mapping added. |

_When any mapping or diagram in this pack changes, append a row here with the reason — consistent with the project rule that architecture updates carry an explanation._
