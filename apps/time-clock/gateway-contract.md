# Approved ADP integration gateway contract

The time clock calls an isolated gateway using `ADP_GATEWAY_URL` and server-only `ADP_GATEWAY_TOKEN`. The gateway must authorize the calling Worker, enforce idempotency on `eventId`, map the configured ADP product's exact event schema, use ADP-supported OAuth/client credentials, and verify the final status.

## Input
`POST` JSON `{eventId,workerId,type,worksiteId}` with an `Idempotency-Key` header and `Authorization: Bearer <gateway token>`.

## Output
`{state:"PENDING"|"CONFIRMED",reference:"<provider reference>"}`. Never return CONFIRMED solely because an HTTP POST returned 200/202. Persist the provider correlation ID and support read-back reconciliation. If the provider cannot establish a terminal status, return PENDING and retain the original idempotency key for follow-up.

## Safety boundary
`ADP_MODE=gateway` is an explicit production authorization gate. A fake gateway and simulation data are not valid for payroll. ADP product selection, event schema, worker mappings, scopes, legal authorization, and provider status verification must be validated with the employer and ADP before deployment. No user password collection or undocumented session automation.

Geofence decisions cannot establish device authenticity. For high-assurance presence checks, review attestation, managed devices or supervised kiosk workflows. Always provide an HR correction path when GPS fails, especially for clock-out.

## Read-back for pending submissions
`GET ADP_GATEWAY_URL?eventId=<internal-punch-uuid>`, authenticated with the same server-side Bearer token, must return `{state:"PENDING"|"CONFIRMED"|"FAILED"}`. Gateway lookup must resolve the original provider correlation ID, not resubmit a new punch. The standalone app exposes an employee-scoped `GET /api/punches/:id/status` to request an explicit refresh. Never change UNKNOWN to CONFIRMED without external reconciliation.
