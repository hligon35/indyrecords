# Complete sample dataset

Run `npm run build:sample` and `npm run build:sample-documents` to generate the four-customer workspace data and document samples in `dist/sample`; the same versioned fixtures are checked into `fixtures/sample-data` for immediate use. All records are fictional, fixed-date test data; no customer or vendor systems are connected or updated.

Each customer bundle includes:

- Five accounts across active, prospect, lost, archived and imported states; prospect activity and follow-up; multiple locations and contacts; CRM import examples accepted, matched, conflicting and rejected.
- Draft, revised, signed, declined and terminated agreement examples; revised estimates including measured weight; active and cancelled recurring plans with skipped and moved dates; scheduled, completed and cancelled jobs.
- Draft, issued and cancelled invoices; pending, captured and cancelled payment requests; refunds and credits; provider failure, review, retry, success and reconciliation examples; matching and mismatching settlement files.
- Assigned, completed and exception driver jobs; route and vehicle data; custody events; sample certificate and delivery batch; pending field export; fictional telemetry and navigation restrictions.
- Seventeen records per customer across boxes and files; receiving, retrieval, withdrawal, return/refile and cancelled work orders; courier hand-offs, location movement and custody history.
- A full export type catalog, operational reports, indexed-search examples and document fixtures.

Across four customers the dataset contains 20 accounts, 12 service locations, 32 commercial jobs, 16 invoices, 16 field jobs and 68 warehouse records. Each customer bundle has 30 export sources. Its fixed reference date makes rebuilds repeatable. The manifest documents counts, IDs and scenario coverage; the four JSON workspace bundles and matching/mismatching settlement CSV files live in `fixtures/sample-data` and are also written to `dist/sample`.

The **Commercial Office** and **Dispatch & Driver Operations** screens can load the full linked sample into the Commercial, Dispatch and Warehouse workspaces with one action; existing local work is preserved. In verified API mode, a manager/admin can install the same bundle into an empty local D1 customer workspace from either screen or from **Data Setup**. Installation is atomic and will not replace existing work. See [backend setup](backend.md) before enabling local feature flags.

This package exercises the implemented feature set. It does not supply production-scale load data, real vendor records, legal destruction evidence, live payments, real delivery, navigation or ELD data.
