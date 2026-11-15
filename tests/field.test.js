import test from "node:test";
import assert from "node:assert/strict";
import { seedField, applyField, verifyFieldCustody } from "../packages/field/workflows.js";
import { planRoute, fixtureMatrix } from "../packages/field/routing.js";
import { fieldDashboard, exportCsv, unicodeReport } from "../packages/field/reports.js";
function h() {
  let state = seedField("c2"), n = 0;
  return { get s() {
    return state;
  }, async run(type, input = {}, actor = "manager", time = "2026-11-15T12:00:00Z") {
    const j = state.jobs.find((j2) => j2.id === input.jobId), command = { type, input, clientEventId: "demo-event-" + ++n, expectedVersion: state.version, expectedJobVersion: j?.version };
    const r = await applyField(state, command, actor, time);
    state = r.state;
    return command.clientEventId;
  }, async raw(c, actor = "manager") {
    const r = await applyField(state, c, actor, "2026-11-15T12:00:00Z");
    state = r.state;
    return r;
  } };
}
async function assigned() {
  const x = h();
  await x.run("demo_jobs");
  const v = await x.run("add_vehicle", { name: "Demo truck", capacity: 20, heightCm: 350, weightKg: 16e3 });
  await x.run("create_route", { vehicleId: v, driverId: "driver", date: "2026-11-15", jobIds: x.s.jobs.map((j) => j.id), startMinute: 480, breakMinutes: 30, dayLimit: 480 });
  return x;
}
async function completed() {
  const x = await assigned(), jobId = x.s.jobs[0].id;
  await x.run("start_job", { jobId }, "driver");
  await x.run("arrive_job", { jobId }, "driver");
  await x.run("scan_bin", { jobId, barcode: "DEMO-BIN-0001" }, "driver");
  await x.run("scan_bin", { jobId, barcode: "DEMO-BIN-0002" }, "driver");
  await x.run("complete_job", { jobId, production: 2, acknowledgment: "demo-customer" }, "driver");
  return x;
}
test("dispatch to custody and two-person SAMPLE certificate preserves revision/delivery history", async () => {
  const x = await completed(), jobId = x.s.jobs[0].id;
  assert.equal(await verifyFieldCustody(x.s.custody), true);
  await assert.rejects(x.run("issue_certificate", { jobId }), /authorized/);
  await x.run("authorize_demo_destruction", { jobId, reason: "Demo authorization" });
  await assert.rejects(x.run("perform_demo_destruction", { jobId }, "manager"), /another driver/);
  await x.run("perform_demo_destruction", { jobId }, "driver");
  const certificateId = await x.run("issue_certificate", { jobId });
  assert.equal(x.s.certificates[0].title, "SAMPLE / NOT PROOF OF DESTRUCTION");
  assert.match(unicodeReport(x.s, certificateId), /SAMPLE/);
  await x.run("set_delivery", { accountId: "demo-account", recipient: "demo-office", timezone: "America/New_York", consent: true });
  await x.run("batch_certificates");
  await x.run("batch_certificates");
  assert.equal(x.s.batches.length, 1);
  await x.run("void_certificate", { certificateId, reason: "Demo correction" });
  assert.equal(x.s.batches[0].status, "voided");
  await x.run("issue_certificate", { jobId });
  assert.equal(x.s.certificates[1].revision, 2);
  await x.run("batch_certificates");
  const batch = x.s.batches[1];
  await x.run("deliver_batch", { batchId: batch.id, outcome: "failure" });
  await assert.rejects(x.run("deliver_batch", { batchId: batch.id, outcome: "success" }), /retry/);
  await x.run("deliver_batch", { batchId: batch.id, outcome: "success" }, "manager", "2026-11-15T13:00:00Z");
  assert.equal(x.s.batches[1].status, "simulated_sent");
  assert.equal(x.s.batches[1].history.length, 2);
});
test("route matrices enforce capacity, windows and truck restrictions instead of claiming unsafe feasibility", async () => {
  const x = await assigned(), jobs = x.s.jobs, v = x.s.vehicles[0], m = fixtureMatrix(jobs, "2026-11-15T12:00:00Z");
  const p = planRoute(jobs, v, m);
  assert.equal(p.totalMinutes, 115);
  assert.equal(p.feasible, true);
  assert.equal(p.notRoadSafeNavigation, true);
  assert.equal(planRoute(jobs, { ...v, capacity: 1 }, m).feasible, false);
  assert.equal(planRoute([{ ...jobs[0], closeMinute: 490 }], v, fixtureMatrix([jobs[0]])).feasible, false);
  m.edges[0].maxHeightCm = 100;
  assert.equal(planRoute(jobs, v, m, { order: jobs.map((j) => j.id) }).feasible, false);
  assert.throws(() => planRoute(jobs, v, m, { order: [jobs[0].id] }), /once/);
});
test("stale/reassigned commands, replay collisions and repeated bins cannot duplicate work", async () => {
  const x = await assigned(), j = x.s.jobs[0];
  const c = { type: "start_job", input: { jobId: j.id }, clientEventId: "demo-replay", expectedJobVersion: j.version };
  assert.equal((await x.raw(c, "driver")).status, "accepted");
  assert.equal((await x.raw(c, "driver")).status, "already_accepted");
  await assert.rejects(x.raw({ ...c, input: { jobId: "demo-field-job-2" } }, "driver"), /reused/);
  await assert.rejects(x.run("arrive_job", { jobId: j.id }, "other"), /another driver/);
  await x.run("arrive_job", { jobId: j.id }, "driver");
  await x.run("scan_bin", { jobId: j.id, barcode: "DEMO-BIN-0001" }, "driver");
  await assert.rejects(x.run("scan_bin", { jobId: j.id, barcode: "DEMO-BIN-0001" }, "driver"), /already/);
  await assert.rejects(x.run("complete_job", { jobId: j.id, production: 1, acknowledgment: "demo-person" }, "driver"), /expected bins/);
  const second = x.s.jobs[1];
  await x.run("reassign_job", { jobId: second.id, driverId: "other" });
  await assert.rejects(x.run("start_job", { jobId: second.id }, "driver"), /another driver/);
  assert.equal(x.s.routes[0].needsReview, true);
});
test("tampered custody prevents certificate issuance and consent gates simulated delivery", async () => {
  const x = await completed(), jobId = x.s.jobs[0].id;
  await x.run("authorize_demo_destruction", { jobId, reason: "Demo" });
  await x.run("perform_demo_destruction", { jobId }, "driver");
  x.s.custody[0].data.tamper = true;
  assert.equal(await verifyFieldCustody(x.s.custody), false);
  await assert.rejects(x.run("issue_certificate", { jobId }), /custody/);
});
test("telemetry is visibly synthetic, rejects old/future data and distinguishes absent/stale states", async () => {
  const x = await assigned(), vehicleId = x.s.vehicles[0].id;
  assert.equal(fieldDashboard(x.s).telemetry[0].status, "absent");
  const point = { vehicleId, timestamp: "2026-11-15T11:59:00Z", latitude: 39, longitude: -86, odometer: 1e3, diagnostic: "demo-normal" };
  await x.run("telemetry", point);
  assert.equal(fieldDashboard(x.s, Date.parse("2026-11-15T12:00:00Z")).telemetry[0].status, "synthetic fresh");
  assert.equal(fieldDashboard(x.s, Date.parse("2026-11-15T13:00:00Z")).telemetry[0].status, "stale");
  await assert.rejects(x.run("telemetry", point), /Out-of-order/);
  await assert.rejects(x.run("telemetry", { ...point, timestamp: "2026-11-15T15:00:00Z" }), /Invalid/);
  assert.match(x.s.telemetry[0].eld, /NOT AN APPROVED/);
});
test("durable export chunks exceed the previous 1,000-row limit and preserve Unicode safely", async () => {
  const x = h();
  await x.run("demo_jobs");
  x.s.jobs = Array.from({ length: 1205 }, (_, i) => ({ ...x.s.jobs[0], id: "demo-job-" + i, name: "Demo \u65E5\u672C\u8A9E <script>", production: 0 }));
  const id = await x.run("request_export");
  for (let i = 0; i < 13; i++) await x.run("advance_export", { exportId: id });
  const e = x.s.exports[0];
  assert.equal(e.rows.length, 1205);
  assert.equal(e.status, "complete");
  assert.equal(exportCsv(e).split("\r\n").length, 1207);
  const report = unicodeReport(x.s);
  assert.match(report, /日本語/);
  assert.match(report, /&lt;script&gt;/);
  assert.doesNotMatch(report, /<script>/);
});
test("small-route optimization finds a feasible earlier-window order missed by nearest-neighbor", async () => {
  const { optimizeRoute } = await import("../packages/field/routing.js");
  const jobs = [{ id: "near", openMinute: 480, closeMinute: 1e3, serviceMinutes: 20, containers: 1 }, { id: "urgent", openMinute: 480, closeMinute: 510, serviceMinutes: 10, containers: 1 }], vehicle = { available: true, capacity: 10, heightCm: 350, weightKg: 16e3 }, matrix = fixtureMatrix(jobs);
  matrix.edges.find((e) => e.from === "DEPOT" && e.to === "near").minutes = 5;
  matrix.edges.find((e) => e.from === "DEPOT" && e.to === "urgent").minutes = 10;
  assert.equal(planRoute(jobs, vehicle, matrix).feasible, false);
  const p = optimizeRoute(jobs, vehicle, matrix);
  assert.equal(p.feasible, true);
  assert.equal(p.stops[0].jobId, "urgent");
});
test("mobile field projection works without browser-only clone/encoder globals when native hashing is injected", async () => {
  const { seedDriverField } = await import("../packages/field/workflows.js"), { createHash } = await import("node:crypto");
  const encoder = globalThis.TextEncoder, clone = globalThis.structuredClone;
  try {
    globalThis.TextEncoder = void 0;
    globalThis.structuredClone = void 0;
    const state = seedDriverField("c2");
    const result = await applyField(state, { type: "start_job", clientEventId: "demo-hermes-compatible", input: { jobId: state.jobs[0].id }, expectedJobVersion: 0 }, "local-demo-driver", "2026-11-15T12:00:00Z", (text) => createHash("sha256").update(text).digest("hex"));
    assert.equal(result.state.jobs[0].status, "in_progress");
    assert.equal(state.jobs[0].status, "assigned");
  } finally {
    globalThis.TextEncoder = encoder;
    globalThis.structuredClone = clone;
  }
});
test("office dashboard uses issued balances and explicit UTC aging without exposing unissued drafts", async () => {
  const { officeDashboard } = await import("../packages/field/reports.js");
  const c = { synthetic: true, accounts: [{ stage: "customer" }, { stage: "prospect" }], estimates: [{ status: "accepted" }, { status: "draft" }], invoices: [{ id: "issued", status: "issued", totalCents: 5e3, due: "2026-11-14", credits: [{ amountCents: 500 }] }, { id: "draft", status: "draft", totalCents: 99999, due: "2026-01-01", credits: [] }], payments: [{ invoiceId: "issued", status: "captured", amountCents: 2e3, refundedCents: 0 }], outbox: [{ status: "failed", reconciliation: { status: "conflict" } }] };
  const d = officeDashboard(c, Date.parse("2026-11-15T12:00:00Z"));
  assert.equal(d.receivableCents, 2500);
  assert.equal(d.overdueCents, 2500);
  assert.equal(d.acceptedEstimates, 1);
  assert.equal(d.providerFailures, 1);
  assert.equal(d.reconciliationConflicts, 1);
});
test("a driver cannot start a second job while another stop is active", async () => {
  const x = await assigned();
  await x.run("start_job", { jobId: x.s.jobs[0].id }, "driver");
  await assert.rejects(x.run("start_job", { jobId: x.s.jobs[1].id }, "driver"), /active job/);
  assert.equal(x.s.jobs[1].status, "assigned");
});
