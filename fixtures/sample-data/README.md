# Feature testing sample data

These versioned bundles contain fictional data for four isolated customer workspaces. They include accounts, agreements, estimates, recurring schedules, billing outcomes, field jobs, fleet examples, warehouse inventory and custody, settlement files, and report sources.

- `c1.json` through `c4.json`: complete per-customer workspace bundles.
- `*-settlements-matched.csv` and `*-settlements-mismatch.csv`: reconciliation cases.
- `documents/`: sample invoice, certificate, and operations documents in PDF, HTML, and CSV formats.
- `manifest.json`: dataset version, per-customer counts, identifiers, and scenario coverage.

Regenerate from the repository root with `npm run build:sample` and `npm run build:sample-documents`. The generators also write downloadable copies under `dist/sample`. All IDs and records are fictional; the fixtures do not connect to vendor, customer, payment, delivery, or navigation systems.
