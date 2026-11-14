# Verified authentication and revocable sessions

The Worker verifies Cloudflare Access RS256 application JWTs against a configured team issuer and audience. It validates the signature, key identifier, issuer, audience, expiry, issued-at and optional not-before time. Signing keys come only from the configured HTTPS Cloudflare Access certs endpoint, with a five-minute cache and refresh for unknown key IDs. Identity headers, email strings and client role claims are never sufficient authorization.

Configure ACCESS_ISSUER as the exact https://TEAM.cloudflareaccess.com origin and ACCESS_AUDIENCE as the application audience. No account or provider was connected during implementation. Obtain an application token through an approved Cloudflare Access login outside this prototype. The UI exchanges that verified token for a short-lived application session, or accepts an existing session; an interactive login redirect is not implemented.

Explicitly provision app_users.external_subject with the verified sub. Users default to inactive. Approve role, active status and user_customer_access rows only in the dedicated synthetic database. No public provisioning or role management endpoint exists. Admins also require explicit customer grants.

POST /v1/session with a verified identity bearer token exchanges it for a random opaque bearer session, valid for at most 15 minutes and never beyond the identity token expiry. Only SHA-256 token hashes are stored in D1. Sessions cannot refresh themselves. GET /v1/session verifies current identity; DELETE revokes the presented application session. Deactivation, role changes and customer grant removal take effect on the next request because every request reloads the user and scopes from D1. Revoking an application session does not revoke the upstream identity-provider JWT: use provider logout/revocation policy as well.

The read-only web/desktop UI keeps tokens and inventory in memory and discards credentials on a 401. Disconnect immediately clears local state and attempts to revoke the application session; it does not revoke the upstream identity token. Failed server sign-out is reported and the session remains subject to expiry. No shared development token is bundled in clients. Shared-token authentication is accepted only for localhost/127.0.0.1 API URLs, preserving existing local demos; it is rejected on public hostnames.

All inventory list/detail and summary queries enforce customer grants in SQL. Scan submissions additionally require scans:create, remain disabled outside loopback, and reject destruction and work-order-linked operations. Session endpoints cannot modify inventory.

Every non-health API request persists its allow/deny outcome in access_audit before returning data. Audit failure returns 503. The response X-Request-Id matches the audit ID. Detail barcode paths are hashed; query text, tokens and payloads are not logged. Anonymous denials have a null actor. Preflight requests do not access data and are not audited. Audit storage is persistent but not an immutable external compliance archive.

Before any authorized pilot: approve identity-provider policy and user mapping, configure exact CORS origins, implement rate limiting and session/audit retention, review audit access and backup policy, and test provider rotation/outage and native device behavior. No public deployment or real-data migration is authorized by this implementation.

Verification reference: [Cloudflare Access token validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
