# Complete sample dataset

Run `npm run build:sample` to create the linked, four-customer test dataset in `dist/sample`. The downloadable package also includes this dataset in the project delivery outputs. All records are sample data for feature testing; no customer or vendor systems are connected or updated.

Each customer bundle includes:

- Four account states: prospect, active customer, lost prospect and archived account; two service locations, contact history, follow-ups and an agreement.
- Estimates, scheduled jobs, recurring service with a skipped date, multiple billing periods, payment/refund/credit examples, failed and retryable provider work, and settlement files with matching and mismatching cases.
- Assigned driver jobs in ready, completed and exception states; route and vehicle records; custody events; a printable SAMPLE certificate and delivery draft.
- Warehouse boxes/files, receiving and retrieval orders, locations and courier hand-offs.
- A pending background export, archived reports/documents, and examples for indexed search and reconciliations.

Across four customers the current dataset contains 16 accounts, 8 service locations, 24 commercial jobs, 8 invoices, 20 field jobs and 36 warehouse records. Its fixed reference date makes rebuilds repeatable. `dist/sample/manifest.json` documents per-customer counts, IDs and scenario coverage. `c1.json` through `c4.json` contain full workspace bundles; matching/mismatching settlement CSV files and report/document exports support import and export checks.

The app’s **Backend Operations** screen can preview and download any customer’s full bundle. An authorized local manager can install the bundle into an empty local D1 customer workspace. Installation is atomic and will not replace existing work. See [backend setup](backend.md) before enabling local feature flags.

This package exercises the implemented feature set. It does not supply production-scale load data, real vendor records, legal destruction evidence, live payments, real delivery, navigation or ELD data.
