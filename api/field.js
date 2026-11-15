import { applyCommercial } from "../packages/commercial/workflows.js";
import { can } from "../packages/security/permissions.js";
import { seedField, applyField, verifyFieldCustody, DRIVER_ACTIONS } from "../packages/field/workflows.js";
const json = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
function fieldView(s, p) {
  if (p.role !== "warehouse") {
    const { receipts, ...v } = s;
    return v;
  }
  const jobs = s.jobs.filter((j) => j.driverId === p.id), ids = new Set(jobs.map((j) => j.id));
  return { ...seedField(s.customerId), version: s.version, jobs, vehicles: s.vehicles.filter((v) => s.routes.some((r) => r.driverId === p.id && r.vehicleId === v.id)), routes: s.routes.filter((r) => r.driverId === p.id && r.jobIds.every((id) => ids.has(id))), custody: s.custody.filter((e) => ids.has(e.jobId)), receipts: s.receipts.filter((r) => r.actor === p.id) };
}
async function fieldRoute(request, env, p, readBody) {
  const u = new URL(request.url);
  if (!["localhost", "127.0.0.1"].includes(u.hostname) || env.SYNTHETIC_FIELD_ENABLED !== "true" || p.id === "demo-api-user") return json({ error: "Verified local synthetic field workspace required" }, 403);
  let customerId = u.searchParams.get("customerId"), command;
  if (request.method === "POST") {
    let body;
    try {
      body = await readBody(request, 32768);
    } catch (e) {
      return json({ error: "Invalid field request" }, e.status || 400);
    }
    customerId = body?.customerId;
    command = body?.command;
  }
  if (!["c1", "c2", "c3", "c4"].includes(customerId)) return json({ error: "Synthetic customer required" }, 400);
  const certificates = ["authorize_demo_destruction", "issue_certificate", "void_certificate", "set_delivery", "batch_certificates", "deliver_batch", "review_batch"];
  const permission = request.method === "GET" ? "field:read" : DRIVER_ACTIONS.includes(command?.type) ? "field:drive" : certificates.includes(command?.type) ? "field:certificate" : "field:manage";
  if (!can(p, permission, { customerId })) return json({ error: "Forbidden" }, 403);
  if (u.pathname === "/v1/field/drivers" && request.method === "GET") {
    if (!can(p, "field:manage", { customerId })) return json({ error: "Forbidden" }, 403);
    return json({ items: (await env.DB.prepare("SELECT u.id,u.display_name FROM app_users u JOIN user_customer_access a ON a.user_id=u.id WHERE a.customer_id=? AND u.active=1 AND u.role='warehouse' ORDER BY u.id LIMIT 100").bind(customerId).all()).results || [] });
  }
  let imported = null;
  const row = await env.DB.prepare("SELECT version,payload FROM field_workspaces WHERE customer_id=?").bind(customerId).first();
  const state = row ? JSON.parse(row.payload) : seedField(customerId);
  if (u.pathname === "/v1/field/workspace" && request.method === "GET") return json(fieldView(state, p));
  if (u.pathname === "/v1/field/billing" && request.method === "POST") {
    if (!can(p, "commercial:manage", { customerId })) return json({ error: "Commercial manager required" }, 403);
    const j = state.jobs.find((j2) => j2.id === command?.input?.jobId);
    if (!j || j.status !== "completed" || !j.commercialJobId || !await verifyFieldCustody(state.custody)) return json({ error: "Completed commercial-linked job and valid custody required" }, 409);
    const commercial = await env.DB.prepare("SELECT version,payload FROM commercial_workspaces WHERE customer_id=?").bind(customerId).first();
    if (!commercial) return json({ error: "Commercial workspace unavailable" }, 409);
    const c = JSON.parse(commercial.payload);
    if (c.jobs.find((v) => v.id === j.commercialJobId)?.status === "completed") return json({ status: "already_accepted" });
    let result;
    try {
      result = applyCommercial(c, { id: command.clientEventId, type: "complete_job", input: { jobId: j.commercialJobId }, expectedVersion: c.version }, p.id);
    } catch (e) {
      return json({ error: e.message }, e.status || 409);
    }
    const saved = await env.DB.prepare("UPDATE commercial_workspaces SET payload=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE customer_id=? AND version=?").bind(JSON.stringify(result.state), customerId, commercial.version).run();
    return saved.meta?.changes === 1 ? json({ status: "accepted" }, 201) : json({ error: "Commercial workspace changed; retry" }, 409);
  }
  if (u.pathname !== "/v1/field/commands" || request.method !== "POST") return json({ error: "Not found" }, 404);
  if (["create_route", "reassign_job"].includes(command?.type)) {
    const driver = await env.DB.prepare("SELECT u.id FROM app_users u JOIN user_customer_access a ON a.user_id=u.id WHERE u.id=? AND a.customer_id=? AND u.active=1 AND u.role='warehouse'").bind(command.input?.driverId, customerId).first();
    if (!driver) return json({ error: "Active scoped warehouse driver required" }, 403);
  }
  if (command?.type === "import_jobs") {
    const commercial = await env.DB.prepare("SELECT payload FROM commercial_workspaces WHERE customer_id=?").bind(customerId).first();
    const c = commercial ? JSON.parse(commercial.payload) : null;
    imported = (c?.jobs || []).filter((j) => j.status === "scheduled").map((j) => {
      const l = c.locations.find((l2) => l2.id === j.locationId);
      return { ...j, name: l.name, address: l.address, timezone: l.timezone, containers: c.estimates.find((e) => e.id === j.estimateId)?.unit === "container" ? j.price.quantity : 2, windowStart: l.windowStart, windowEnd: l.windowEnd };
    });
  }
  if (["demo_jobs", "import_jobs", "create_route"].includes(command?.type)) {
    const profile = await env.DB.prepare("SELECT active FROM customer_profiles WHERE customer_id=?").bind(customerId).first();
    if (profile?.active === 0) return json({ error: "Archived customer; new field work blocked" }, 409);
  }
  await env.DB.prepare("INSERT OR IGNORE INTO field_workspaces(customer_id,payload) VALUES(?,?)").bind(customerId, JSON.stringify(seedField(customerId))).run();
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await env.DB.prepare("SELECT version,payload FROM field_workspaces WHERE customer_id=?").bind(customerId).first();
    let result;
    const stored = JSON.parse(current.payload);
    if (stored.receipts.some((r) => r.clientEventId === command?.clientEventId && r.actor === p.id)) {
      try {
        const replay = await applyField(stored, command, p.id);
        return json({ status: replay.status, workspace: fieldView(replay.state, p) });
      } catch (e) {
        return json({ error: e.message }, e.status || 409);
      }
    }
    if (DRIVER_ACTIONS.includes(command?.type)) {
      const target = stored.jobs.find((j) => j.id === command.input?.jobId);
      if (target && target.driverId === p.id && !stored.receipts.some((r) => r.clientEventId === command.clientEventId) && command.expectedJobVersion !== target.version) {
        target.reviewRequired = { clientEventId: command.clientEventId, driverId: p.id, at: (/* @__PURE__ */ new Date()).toISOString(), currentVersion: target.version };
        stored.version++;
        const flagged = await env.DB.prepare("UPDATE field_workspaces SET payload=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE customer_id=? AND version=?").bind(JSON.stringify(stored), customerId, current.version).run();
        if (flagged.meta?.changes === 1) return json({ error: "Stale job version; supervisor review is required" }, 409);
        continue;
      }
      if (target?.commercialJobId) {
        const row2 = await env.DB.prepare("SELECT payload FROM commercial_workspaces WHERE customer_id=?").bind(customerId).first();
        const source = row2 ? JSON.parse(row2.payload).jobs.find((j) => j.id === target.commercialJobId) : null;
        if (!source || !["scheduled", "completed"].includes(source.status) || source.date !== target.date || source.locationId !== target.locationId) return json({ error: "Commercial source changed; supervisor review required" }, 409);
      }
      if (target && target.driverId !== p.id && stored.custody.some((e) => e.jobId === target.id && e.action === "reassigned" && e.data.previousDriverId === p.id)) return json({ error: "Assignment changed; retain conflict and refresh" }, 409);
    }
    try {
      result = await applyField(JSON.parse(current.payload), command, p.id, (/* @__PURE__ */ new Date()).toISOString(), void 0, imported);
    } catch (e) {
      return json({ error: e.message }, e.status || 400);
    }
    if (result.status === "already_accepted") return json({ status: result.status, workspace: fieldView(result.state, p) });
    const saved = await env.DB.prepare("UPDATE field_workspaces SET payload=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE customer_id=? AND version=?").bind(JSON.stringify(result.state), customerId, current.version).run();
    if (saved.meta?.changes === 1) {
      const response = json({ status: "accepted", workspace: fieldView(result.state, p) }, 201);
      if (command.type === "request_export") {
        response.headers.set("x-synthetic-export-id", command.clientEventId);
        response.headers.set("x-synthetic-export-customer", customerId);
        response.headers.set("x-synthetic-export-actor", p.id);
      }
      return response;
    }
    if (!DRIVER_ACTIONS.includes(command.type)) break;
  }
  return json({ error: "Concurrent field change; review before retry" }, 409);
}
export {
  fieldRoute,
  fieldView
};
