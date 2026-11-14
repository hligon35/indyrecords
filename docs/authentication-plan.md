# Authentication and access control implementation plan

## Implemented foundations

- `packages/security/permissions.js`: deny-by-default role and customer-scope checks, plus a minimal principal projection.
- `migrations/0002_auth_audit_foundation.sql`: disabled-by-default user identities, customer access grants and access-audit storage.
- `tests/permissions.test.js`: policy unit tests.

## Not yet implemented

No login, token verification, session issuance, revocation, identity-provider integration, user provisioning, API middleware, tenant filtering or durable audit writes have been implemented. The existing Worker still uses a development shared token for reads and must not be exposed as a production records API. The new authorization policy is **not yet enforced** by Worker routes. Do not interpret these files as an operational security system.

## Required before authorized pilot

1. Select an approved identity provider; verify signed tokens server-side against issuer, audience, expiry and rotating signing keys, or use secure server-side sessions.
2. Provision users explicitly as inactive by default. An administrator must approve role and customer scopes.
3. Resolve verified external identity to `app_users`, then load customer grants from `user_customer_access` on every authorization decision or through a tightly bounded, revocable cache.
4. Enforce `records:read` and `reports:read` at the API boundary and constrain every record query to the user's approved customer IDs. Do not rely on UI filtering.
5. Record authorization decisions and sensitive record reads in `access_audit` with retention and privacy controls. Do not log bearer tokens.
6. Add rate limits, request size bounds, CORS allowlists, CSP allowlists, session revocation, and cross-origin testing.
7. Keep scan writes disabled; implement work-order validation, custody rules, per-action authorization and idempotency before enabling any operational mutation.
8. Run migrations only against dedicated synthetic-data databases after reviewing schema and backup procedures.

The role policy is intentionally not imported into the Worker until a verified identity-to-principal pipeline exists; accepting unverified role headers would be unsafe.
