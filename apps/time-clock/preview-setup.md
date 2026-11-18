# IRM Time Clock preview — manual setup

## Fixed preview configuration
- Worker name: `irm-time-clock-preview`
- D1 database name: `irm_employees`
- Worksite ID: `irm-indianapolis-30th`
- Worksite address: 6737 E 30th St, Suite B, Indianapolis, IN 46219, United States
- Worksite coordinate: 39.80869, -86.05169 (user supplied; management must verify)
- Geofence: 500 feet; admins can change 100 to 2,000 feet
- Payroll: `ADP_MODE=simulated` only; simulated results must never be treated as paid time
- Security: Cloudflare Access application protecting all routes (not only `/api`). Employees need to be specifically provisioned in D1.

## Cloudflare setup
1. D1 database `irm_employees` has been supplied (ID `1d5d2fef-9a3d-4996-b50c-6f2d3abd1c26`) and its binding is configured in `apps/time-clock/wrangler.toml`. Verify the database is in the Cloudflare account used for deployment.
2. Configure a Cloudflare Access policy that only allows pilot participants on the eventual `workers.dev` hostname. Confirm the Access policy covers both the PWA and `/api/*`. Cloudflare account plans and Access application hostname support may affect this: if the preview hostname cannot be protected with Access, **do not** expose employee punches there; use a managed preview custom hostname or local testing instead.
3. Configure `ACCESS_ISSUER` to the exact `https://<team>.cloudflareaccess.com` issuer and `ACCESS_AUDIENCE` to that specific Access application AUD. Do not put privileged tokens or API credentials in source control.
4. After database UUID + Access are configured, from `apps/time-clock`: `npx wrangler d1 migrations apply irm_employees --remote --config wrangler.toml`, then `npx wrangler deploy --config wrangler.toml`.
5. Get the exact `workers.dev` URL from the Wrangler deployment output. It cannot be predicted from the repo alone. Verify Access protection in a private browser before inviting any testers.
6. Provision employees with their actual Access JWT subject (`sub`) and approved worksite assignment, using administrator-only D1 operations. Do not expose a public self-registration API. Suggested commands are included below.
7. Run manual GPS tests on site and outside the allowed radius. Check that clock-in/out and break events are marked SIMULATED, not ADP CONFIRMED.

## Manual database provisioning example
Replace all values with approved identifiers and never submit sensitive user information into chat or commit it to GitHub:

```sql
INSERT INTO employees(id,identity_sub,display_name,role,active)
VALUES('EMPLOYEE_INTERNAL_ID','ACCESS_VERIFIED_SUBJECT','Employee Display Name','employee',1);
INSERT INTO assignments(employee_id,worksite_id)
VALUES('EMPLOYEE_INTERNAL_ID','irm-indianapolis-30th');
```

For the designated manager, use `'admin'` instead of `'employee'` and assign the worksite. The `identity_sub` must be the identity asserted by the configured Access policy. Do not use an unverified email address or create shared logins.

## Before payroll go-live
The real approved ADP gateway, processing-status reconciliation, exceptions and corrected punch approvals, mobile/device acceptance, privacy policy, backup and retention, and a security review are required. Tests in a browser with self-reported GPS coordinates do not prove physical presence; a malicious device can spoof location. Never represent simulation punches as actual payroll entries.

## Setup decisions (November 18, 2026)
- Q1 — Underlying ADP payroll/time product: deferred until owner or payroll administrator confirms.
- Q2 — Employee authentication: individual email-and-password accounts. Approved as desired UX; implementation is pending. The existing Worker only verifies Cloudflare Access JWTs and does NOT currently implement password registration, password hashing, password reset, MFA, or a complete email-password identity flow. Implement through a vetted identity provider or audited authentication service before employees use the app; never store plaintext passwords in D1.
- Q3 — Employee accounts are created by authorized administrators only. Administrators enter the employee's verified email address, and the system sends a single-use, expiring email invitation for the employee to set their own password. No public self-registration; accounts remain unusable until invitation acceptance and activation. Implement invitation issuance, secure password setup, expiration/revocation, duplicate-account checks, audit logging and restricted resend actions as part of the approved email/password identity provider. This is an approved requirement, not a claim that invitation delivery or local passwords are implemented.

- Q4 — Supervisor permissions and administrative roles: awaiting decision.
