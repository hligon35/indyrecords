# Remote inventory preview (development only)

The **Remote Read-Only** navigation item is an opt-in client for approved development APIs. The synthetic Inventory Search and Warehouse Scanner remain isolated. The remote screen sends GET requests only and does not save credentials to localStorage or the repository.

## Before testing

- Obtain written authorization for the API and the specific records. Use synthetic or de-identified test data until then.
- The current Worker uses a shared `DEMO_API_TOKEN`, not individual sessions or RBAC. **Do not deploy that shared-token API publicly or distribute its token in browser or desktop builds.**
- Browser requests to a different API origin require narrowly scoped CORS on the API. This is **not implemented** in the Worker. The current Tauri CSP also restricts `connect-src` to `'self'`. Consequently, the remote screen is a UI integration scaffold, **not a verified end-to-end remote connection**.
- Do not loosen CORS to `*` with authorization credentials, or relax CSP to arbitrary origins as a shortcut. Use an approved same-origin gateway with user sessions, scoped permissions and audit logging instead.

## Intended pilot architecture

1. Authenticate individual users using secure sessions; map users to read-only roles.
2. Serve the web UI and API through an approved same-origin gateway. Configure the desktop client to reach a specifically allowlisted API origin.
3. Return only fields the signed-in role is permitted to view; log access and apply rate limits.
4. Test record searches, pagination, revocation, expired sessions, offline behavior and performance against fictional data before authorized parallel operation.
5. Keep Q-Shred and Andrew/ASI integration read-only until a separately approved migration plan.

The remote screen currently shows the first 50 records only. It does not yet expose pagination controls or a production sign-in flow.
