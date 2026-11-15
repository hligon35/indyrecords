import { can } from "../packages/security/permissions.js";
import { seedCommercial, applyCommercial, TENANTS } from "../packages/commercial/workflows.js";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const view = (s) => {
  const { receipts, ...visible } = s;
  return visible;
};
async function commercialRoute(request, env, principal, readBody) {
  const u = new URL(request.url);
  if (!["localhost", "127.0.0.1"].includes(u.hostname) || env.SYNTHETIC_COMMERCIAL_ENABLED !== "true" || principal.id === "demo-api-user") return json({ error: "Verified local synthetic commercial workspace required" }, 403);
  let customerId = u.searchParams.get("customerId"), command;
  if (request.method === "POST") {
    let body;
    try {
      body = await readBody(request, 16384);
    } catch (e) {
      return json({ error: "Invalid commercial payload" }, e.status || 400);
    }
    ;
    customerId = body?.customerId;
    command = body?.command;
  }
  if (!TENANTS.includes(customerId)) return json({ error: "Synthetic customer required" }, 400);
  if (!can(principal, request.method === "GET" ? "commercial:read" : "commercial:manage", { customerId })) return json({ error: "Forbidden" }, 403);
  if (u.pathname === "/v1/commercial/workspace" && request.method === "GET") {
    const row2 = await env.DB.prepare("SELECT payload FROM commercial_workspaces WHERE customer_id=?").bind(customerId).first();
    return json(view(row2 ? JSON.parse(row2.payload) : seedCommercial(customerId)));
  }
  if (u.pathname !== "/v1/commercial/commands" || request.method !== "POST") return json({ error: "Not found" }, 404);
  if (["create_account", "import_accounts", "add_location", "create_agreement", "create_estimate", "schedule_purge", "create_plan", "generate_jobs"].includes(command?.type)) {
    const profile = await env.DB.prepare("SELECT active FROM customer_profiles WHERE customer_id=?").bind(customerId).first();
    if (profile?.active === 0) return json({ error: "Customer profile archived; new commercial work blocked" }, 409);
  }
  await env.DB.prepare("INSERT OR IGNORE INTO commercial_workspaces(customer_id,payload) VALUES(?,?)").bind(customerId, JSON.stringify(seedCommercial(customerId))).run();
  const row = await env.DB.prepare("SELECT version,payload FROM commercial_workspaces WHERE customer_id=?").bind(customerId).first();
  let applied;
  try {
    applied = applyCommercial(JSON.parse(row.payload), command, principal.id);
  } catch (e) {
    return json({ error: e.message }, e.status || 400);
  }
  if (applied.status === "already_accepted") return json({ status: applied.status, workspace: view(applied.state) });
  const saved = await env.DB.prepare("UPDATE commercial_workspaces SET payload=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE customer_id=? AND version=?").bind(JSON.stringify(applied.state), customerId, row.version).run();
  return saved.meta?.changes === 1 ? json({ status: "accepted", workspace: view(applied.state) }, 201) : json({ error: "Workspace changed; refresh before retrying" }, 409);
}
export {
  commercialRoute
};
