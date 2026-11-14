# Synthetic Zebra Android scanner

Run npm ci then npm start from this directory. This Expo app only accepts the fictional barcodes defined in packages/integrations/synthetic-scanner.js. It stores scans in device SQLite before showing them as pending.

Configure a DataWedge profile associated with the installed development app: enable Barcode Input and Keystroke Output, and append an Enter key event through Basic Data Formatting. Keep Intent Output disabled for this keyboard-wedge path to avoid duplicate delivery. The scan field retains focus after processing. Use a single-line field and Enter-as-event mode; exact behavior needs validation on the target Zebra model/DataWedge version. No native intent receiver or automatic DataWedge provisioning is included.

The Synchronize synthetic queue button runs the shared single-flight coordinator against an on-device SQLite receipt simulator. This does not contact a server or change remote inventory. Stable client IDs, durable receipts, duplicate acknowledgement, interrupted-send recovery, conflicts and bounded retry scheduling are exercised. A confirmed row means acknowledged by the local simulator only. Confirmations are never presented as remote API acceptance.

The UI serializes scanning and synchronization, rejects unknown records and wrong record types, and prevents duplicate pending scans for the same barcode and operation. Receipt payload mismatches become conflicts. Real records, device encryption, remote login, native intent integration and operational custody workflows remain out of scope. Physical hardware testing and a release APK are still required before device rollout.

Reference: [Zebra DataWedge keystroke output](https://techdocs.zebra.com/datawedge/latest/guide/output/keystroke/).
