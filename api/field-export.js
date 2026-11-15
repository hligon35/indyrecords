import { loadPrincipal } from "./auth.js";
import { can } from "../packages/security/permissions.js";
import { applyField } from "../packages/field/workflows.js";
async function continueFieldExport(env, customerId, exportId, actorId) {
  if (env.SYNTHETIC_FIELD_ENABLED !== "true") return { status: "disabled" };
  for (let tick = 0; tick < 25; tick++) {
    const principal = await loadPrincipal(env.DB, actorId, { byId: true });
    if (!can(principal, "field:manage", { customerId })) return { status: "auth-required" };
    const row = await env.DB.prepare("SELECT version,payload FROM field_workspaces WHERE customer_id=?").bind(customerId).first();
    if (!row) return { status: "missing" };
    const state = JSON.parse(row.payload), job = state.exports.find((e) => e.id === exportId);
    if (!job) return { status: "missing" };
    if (job.status === "complete") return { status: "complete", rows: job.rows.length };
    const result = await applyField(state, { clientEventId: exportId + "-chunk-" + job.offset, type: "advance_export", input: { exportId }, expectedVersion: state.version }, actorId);
    await env.DB.prepare("INSERT INTO access_audit(id,actor_id,action,resource_type,resource_id,decision) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), actorId, "EXPORT_CHUNK", "field_export", exportId, "allow").run();
    await env.DB.prepare("UPDATE field_workspaces SET payload=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE customer_id=? AND version=?").bind(JSON.stringify(result.state), customerId, row.version).run();
  }
  return { status: "resumable" };
}
export {
  continueFieldExport
};
