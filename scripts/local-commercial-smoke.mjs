import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createApiClient } from "../packages/api-client/index.js";
const token = process.env.IRM_TEST_SESSION;
if (!token) throw Error("Temporary verified local session required");
const api = createApiClient({ baseUrl: "http://127.0.0.1:8787", getAccessToken: () => token.trim(), readOnly: false });
const customerId = "c2";
let state = await api.getCommercialWorkspace(customerId);
const before = await api.searchRecords({ q: "", limit: 100 });
let count = 0;
async function run(type, input = {}) {
  const id = "demo-" + crypto.randomUUID();
  const command = { id, type, input, expectedVersion: state.version };
  const response = await api.commercialCommand({ customerId, command });
  state = response.workspace;
  count++;
  const replay = await api.commercialCommand({ customerId, command });
  assert.equal(replay.status, "already_accepted");
  return id;
}
try {
  const accountId = await run("create_account", { name: "Demo Local Commercial" });
  await run("convert_account", { accountId });
  const locationId = await run("add_location", { accountId, name: "Demo Branch", address: "100 Fictional Road", timezone: "America/New_York", windowStart: "09:00", windowEnd: "17:00" });
  const price = { quantity: 2, unitCents: 2500, minimumCents: 0, discountBps: 0, fuelBps: 0, taxBps: 0 };
  const agreementId = await run("create_agreement", { accountId, locationId, start: "2026-01-01", end: "2027-12-31", renewal: "2027-11-01", terms: "Demo cancellation terms", ...price });
  await run("send_agreement", { agreementId });
  await run("process_outbox", { outboxId: state.outbox.find((o) => o.entityId === agreementId).id, outcome: "success" });
  await run("agreement_outcome", { agreementId, outcome: "signed" });
  const estimateId = await run("create_estimate", { accountId, locationId, agreementId, service: "recurring", mode: "onsite", unit: "container", ...price });
  await run("accept_estimate", { estimateId });
  const planId = await run("create_plan", { estimateId, start: "2026-03-01", end: "2026-04-01", intervalDays: 7 });
  await run("generate_jobs", { planId, from: "2026-03-01", through: "2026-03-15" });
  const jobs = state.jobs.filter((j) => j.accountId === accountId);
  assert.equal(jobs.length, 3);
  for (const j of jobs) await run("complete_job", { jobId: j.id });
  const invoiceId = await run("draft_invoice", { accountId, jobIds: jobs.map((j) => j.id), from: "2026-03-01", to: "2026-03-31", due: "2026-04-10" });
  await run("issue_invoice", { invoiceId });
  const paymentId = await run("request_payment", { invoiceId, amountCents: 15e3 });
  await run("process_outbox", { outboxId: state.outbox.find((o) => o.entityId === paymentId).id, outcome: "success" });
  assert.equal(state.payments.find((p) => p.id === paymentId).status, "captured");
  assert.equal((await api.getCommercialWorkspace(customerId)).version, state.version);
  assert.deepEqual(await api.searchRecords({ q: "", limit: 100 }), before);
  await assert.rejects(api.getCommercialWorkspace("c3"), (e) => e.status === 403);
  const read = await fetch("http://127.0.0.1:8787/v1/commercial/workspace?customerId=c2", { headers: { authorization: "Bearer " + token.trim() } });
  assert.ok(read.headers.get("x-request-id"));
  assert.equal(read.status, 200);
  await mkdir(new URL("../dist/readiness/", import.meta.url), { recursive: true });
  await writeFile(new URL("../dist/readiness/phase-a-local.json", import.meta.url), JSON.stringify({ synthetic: true, passed: true, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), commands: count, replayedEveryCommand: true, sourceInventoryUnchanged: true, scopeDenied: true, auditRequestId: read.headers.get("x-request-id") }, null, 2));
  console.log("PASS: local D1 prospect-to-payment workflow, replay, scope isolation, persistence and source preservation.");
} finally {
  await api.endSession();
}
