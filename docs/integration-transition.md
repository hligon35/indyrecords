# IRM RMS: coexistence and migration strategy

## Confirmed by project stakeholder
- Office system: **Q-Shred**.
- Warehouse system: **Andrew Software**, with **ASI Mobile R** on Zebra handhelds.
- IRM RMS is intended to coexist with existing software until independently validated.

The precise product versions, vendors' interfaces, data ownership, export formats, permissions, and integration rights are **not verified**. Do not infer them from application labels.

## Non-negotiable boundaries
- No connection to company systems, vendor databases, or real records without authorization.
- No credential scraping, screen scraping, reverse engineering, undocumented endpoints, or bypass of vendor security.
- Do not place real customer data in this public prototype repository.
- No bidirectional write-back until approved, tested, and contractually permitted.
- Maintain an auditable record of import provenance, schema version, source timestamps, job IDs, row counts, rejected rows, and reconciliation outcomes.

## Phase A: discovery and read-only integration
1. Obtain approval from IRM management and appropriate vendor administrators.
2. Identify supported API endpoints, read-only database views, SFTP/CSV exports, webhook mechanisms, or vendor-supported integration products.
3. Obtain a sample **sanitized** export schema with fields and example rows only.
4. Map customer, account, box/file barcode, location, retention, work order, pickup/delivery, shredding, and event identifiers.
5. Design adapters independently for Q-Shred and Andrew; keep vendor-specific fields isolated.
6. Import into separate staging tables, never directly overwrite canonical records.
7. Reconcile by source-qualified IDs, report missing/ambiguous/conflicting data, and review differences.

## Phase B: shadow operations
- Mirror approved changes from the existing systems into IRM RMS read models.
- Run search, inventory counts, pick lists and reports in parallel.
- Compare outputs and document variance thresholds, freshness, missing records, latency and usability.
- Do not treat a read-only mirror as the authoritative system or silently issue inventory moves.

## Phase C: supervised pilot
- Choose a small workflow, location and team with written sign-off.
- Require explicit role scopes, chain-of-custody events, rollback, reconciliation and incident escalation.
- Enable only vendor-supported and approved writes behind a default-off feature flag.
- Keep old workflows available during the pilot.

## Phase D: migration
- Require management sign-off on reconciliation, data retention, performance, security, backup/restore and operator acceptance.
- Schedule a controlled cutover, preserve historical audit records and provide rollback.

## Current code
`packages/integrations/reconcile.js` offers **pure, read-only** normalization and comparison for synthetic rows. It is not a Q-Shred or Andrew API connector. Tests use invented records.

## Vendor discovery questions
- Which exact Q-Shred and Andrew products/versions are licensed?
- Are supported read-only APIs, exports, integration views or vendor-approved interfaces available?
- How are customers, work orders, boxes, files, locations and events identified?
- Which system owns each business object and when does it update?
- What data use, retention, security and licensing requirements apply?
- Can vendor-provided sandbox credentials and synthetic test datasets be provisioned?
