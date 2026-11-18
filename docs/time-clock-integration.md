# IRM RMS integration — independent time clock

The standalone app is in `apps/time-clock/`; the shared location-policy module is `packages/time-clock/policy.js`. The prototype RMS includes a Time & Attendance menu card directing employees to an independently approved and deployed time-clock application. Until a trusted SSO/session boundary is reviewed, DO NOT embed time-clock administrative controls within the RMS demo or share its development auth tokens. The standalone API is the only source of clock-event truth in this implementation; it is not an RMS payroll database.

## Deployment boundary
A dedicated Worker, dedicated D1 database and independent Cloudflare Access protection allow the time clock to be deployed while RMS remains synthetic. Assign site access and admin roles outside the public API; never connect production payroll credentials to the RMS prototype. The standalone app's URL can be configured at integration time (environment-specific URL and authorized link). The RMS page deliberately displays setup guidance before deployment rather than an invented production link.

## Future integrated experience
After production identity and service acceptance, expose a scoped IRM RMS Time & Attendance view through an approved gateway to the same time-clock API, with a reviewed SSO exchange and independent `attendance:read` / `attendance:admin` permissions. Do not mirror raw location or ADP credentials. Maintain attendance retention and correction procedures separately from warehouse custody logs.

## Verification
`npm test` includes `tests/time-clock.test.js` for accurate geofence acceptance, out-of-range denial, stale/low-accuracy denial and configured radius. Database/application/ADP end-to-end tests still need an authorized configured environment.
