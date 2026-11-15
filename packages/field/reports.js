import { invoiceBalance } from "../commercial/workflows.js";
import { csvCell } from "../reports/report.js";
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function fieldDashboard(state, now = Date.now()) {
  const counts = {};
  for (const j of state.jobs) counts[j.status] = (counts[j.status] || 0) + 1;
  return { jobs: state.jobs.length, counts, production: state.jobs.reduce((n, j) => n + j.production, 0), exceptions: state.jobs.filter((j) => j.status === "exception").map((j) => j.id), overtimeMinutes: state.routes.reduce((n, r) => n + r.plan.overtimeMinutes, 0), telemetry: state.vehicles.map((v) => {
    const t = state.telemetry.find((t2) => t2.vehicleId === v.id);
    return { vehicleId: v.id, status: !t ? "absent" : now - Date.parse(t.timestamp) > 3e5 ? "stale" : "synthetic fresh", timestamp: t?.timestamp || null };
  }) };
}
function exportCsv(job) {
  if (job.status !== "complete") throw Error("Export is not complete");
  const keys = ["id", "status", "date", "driverId", "production"];
  return "\uFEFF" + [keys, ...job.rows.map((r) => keys.map((k) => r[k]))].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
function unicodeReport(state, certificateId = null) {
  const c = certificateId ? state.certificates.find((c2) => c2.id === certificateId) : null;
  if (certificateId && !c) throw Error("Certificate not found");
  const data = c ? { certificate: c, job: state.jobs.find((j) => j.id === c.jobId), custody: state.custody.filter((e) => e.jobId === c.jobId) } : { dashboard: fieldDashboard(state), jobs: state.jobs };
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Synthetic field report</title><style>body{font-family:system-ui,sans-serif;margin:2rem;line-height:1.5}h1{color:#a00}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:1cm}}</style><h1>SAMPLE / NOT PROOF OF DESTRUCTION</h1><p>Synthetic records only. This is not an issued operational certificate or a certification claim.</p><pre>` + esc(JSON.stringify(data, null, 2)) + "</pre></html>";
}
function officeDashboard(c, now = Date.now()) {
  if (!c?.synthetic) return null;
  const issued = c.invoices.filter((i) => i.status === "issued"), today = new Date(now).toISOString().slice(0, 10);
  return { accounts: c.accounts.length, customers: c.accounts.filter((a) => a.stage === "customer").length, prospects: c.accounts.filter((a) => a.stage === "prospect").length, estimates: c.estimates.length, acceptedEstimates: c.estimates.filter((e) => e.status === "accepted").length, receivableCents: issued.reduce((n, i) => n + Math.max(0, invoiceBalance(c, i).dueCents), 0), overdueCents: issued.filter((i) => i.due < today).reduce((n, i) => n + Math.max(0, invoiceBalance(c, i).dueCents), 0), providerFailures: c.outbox.filter((o) => o.status === "failed").length, reconciliationConflicts: c.outbox.filter((o) => o.reconciliation?.status === "conflict").length };
}
export {
  exportCsv,
  fieldDashboard,
  officeDashboard,
  unicodeReport
};
