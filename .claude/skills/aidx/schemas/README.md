# AIDX XSD Bundle

`aidx-v21.2/` — the complete IATA AIDX v21.2 schema set (release `IATA2021.2`, 2021-11-08) as distributed via the SITA AIDX API. 12 XSDs, all in namespace `http://www.iata.org/IATA/2007/00`.

Three message families (see `../references/08-xsd-schema.md` for the full analysis — enums, cardinality, nillability):

- **Core FlightLeg** — `IATA_AIDX_FlightLegNotifRQ.xsd`, `IATA_AIDX_FlightLegRQ.xsd`, `IATA_AIDX_FlightLegRS.xsd`
- **Fuel pre-transaction** — `IATA_AIDX_FuelCommonTypes.xsd`, `IATA_AIDX_FuelNotifRQ.xsd`
- **Ground Movement** — `IATA_AIDX_GroundMovementCommonTypes.xsd`, `IATA_AIDX_FlightLegLinkGroundMovementNotifRQ.xsd`, `...RQ.xsd`, `...RS.xsd`

Shared type libraries (included by the above): `IATA_AIDX_CommonTypes.xsd`, `IATA_CommonTypes.xsd`, `IATA_SimpleTypes.xsd`.

## Validate a message

The `*.xsd` files `<xs:include>` each other by relative filename, so validate from inside `aidx-v21.2/`:

```bash
# Validate a FlightLegNotifRQ instance against the schema
xmllint --noout --schema aidx-v21.2/IATA_AIDX_FlightLegNotifRQ.xsd path/to/message.xml

# Sample messages to test against live in ../samples/
xmllint --noout --schema aidx-v21.2/IATA_AIDX_FlightLegNotifRQ.xsd ../samples/create-update-flightlegnotifrq.xml
```

> Note: `IATA_AIDX_FuelNotifRQ.xsd` imports `xmldsig-core-schema.xsd` (W3C XML-DSig) for the optional `ds:Signature`. That file is not bundled here; fetch it from `http://www.w3.org/2000/09/xmldsig#` if you need to validate signed fuel messages.
