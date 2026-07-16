---
last_refreshed: 2026-07-11
sources:
  - IATA AIDX XML Implementation Guide v22.1 (schema 22.1)
  - SITA AIDX v21.2 XSD schema set
  - SITA developer.aero AIDX API 17.1.6
---

# 05 — SITA developer.aero AIDX Publish API

_Source: S5 — "Publish Flight Information - AIDX API 17.1.6", service doc "AIDX Update Service v1.0.0-SNAPSHOT". Concrete real-world AIDX REST implementation._

## Model
Publish-only **REST (XML)** service: airports/airlines PUSH flight create/update/delete into SITA's Flight Status system using AIDX. To READ data back, use the separate **SITA Flight Status API** (AIDX-in / Flight-Status-out). No webhook/subscription push here.

Supported AIDX schema: **v21.2** (`aidx-schema-v21.2.zip`). Namespace `http://www.iata.org/IATA/2007/00`.

## Endpoints
- Update resource pattern: `https://host:port/aidx/flights/update`
- OAuth token: `https://sitaopen.api.aero/update/aidx/oauth/token`
- QA update: `https://update-flifo-qa.api.aero/update/aidx/flights/update`
- Prod-style: `https://flifo.api.aero/flights/update`

## HTTP method → operation
| Method | Operation |
|---|---|
| `POST` | Flight **creation** |
| `PUT` | Flight **update** |
| `DELETE` | Flight **delete** (body needs only `LegIdentifier`; `LegData` empty) |

## Auth (OAuth2 Client Credentials)
1. Register on developer.aero → API key (`client_id`) + consumer secret (`client_secret`).
2. Base64 `client_id:client_secret` → `Authorization: Basic ...` → POST token endpoint.
3. Response JSON `access_token` (JWT). **Expires 1 hour** after issue.
4. Send messages with headers: `Content-Type: application/xml`, `Authorization: Bearer <token>`, `Accept: application/xml`.

Per-key airport authorization: each API key is scoped to a list of airports it may publish for.

## Rate limiting (response headers)
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Policy`, `X-RateLimit-Reset` (secs left in window), `retry-after` (epoch reset, only after limit exceeded).

## Responses
- Success: `200 OK`, body `<IATA_AIDX_FlightLegRS><Success/></IATA_AIDX_FlightLegRS>`.
- Error: **still `200 OK`**, body `<IATA_AIDX_FlightLegRS><Errors><Error ShortText="Service Exception" Code="1007"/></Errors></IATA_AIDX_FlightLegRS>`. Only documented app code: `1007` Service Exception.

## Revision history (SITA doc)
| Date | Ver | Change |
|---|---|---|
| 2021-11-26 | 1.0 | Initial draft |
| 2023-08-11 | 1.1 | Added rate limit + OAuth |

## Related SITA APIs (catalog)
Flight Status, Flight Status Notification, Historical Flight Status, Flight Schedule, Flight Follower, Flight Duration, Flight Connection, Advance Flight Delay Notification; plus ACRIS-based "Publish Flight Information - ACRIS API" (alternative publish path).

See `../samples/` for full create/update/delete/error XML bodies.
