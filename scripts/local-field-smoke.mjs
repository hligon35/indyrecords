import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createApiClient } from "../packages/api-client/index.js";
import { unicodeReport } from "../packages/field/reports.js";
const managerToken = process.env.IRM_TEST_MANAGER_SESSION, driverToken = process.env.IRM_TEST_DRIVER_SESSION;
if (!managerToken || !driverToken) throw Error("Temporary verified local manager and driver sessions required");
const client = (token) => createApiClient({ baseUrl: "http://127.0.0.1:8787", getAccessToken: () => token.trim(), readOnly: false });
const manager = client(managerToken), driver = client(driverToken), customerId = "c2";
let commands = 0;
const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), due = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
async function commercial(type, input) {
  const state = await manager.getCommercialWorkspace(customerId), id = "demo-" + crypto.randomUUID();
  await manager.commercialCommand({ customerId, command: { id, type, input, expectedVersion: state.version } });
  return id;
}
async function field(type, input = {}, who = manager, billing = false) {
  const state = await manager.getFieldWorkspace(customerId), j = state.jobs.find((j2) => j2.id === input.jobId), command = { clientEventId: "demo-" + crypto.randomUUID(), type, input, expectedVersion: state.version, expectedJobVersion: j?.version };
  const body = { customerId, command }, response = await who[billing ? "fieldBilling" : "fieldCommand"](body);
  assert.equal(response.status, "accepted");
  const repeat = await who[billing ? "fieldBilling" : "fieldCommand"](body);
  assert.equal(repeat.status, "already_accepted");
  commands++;
  return command.clientEventId;
}
try {
  const before = await manager.getRecord("IRM-BX-1002"), identity = await driver.getSession();
  assert.equal(identity.user.role, "warehouse");
  const accountId = await commercial("create_account", { name: "Demo Phase B Local" });
  await commercial("convert_account", { accountId });
  const locationId = await commercial("add_location", { accountId, name: "Demo Field Site", address: "200 Fictional Road", timezone: "America/Indiana/Indianapolis", windowStart: "08:00", windowEnd: "17:00" });
  const estimateId = await commercial("create_estimate", { accountId, locationId, service: "purge", mode: "onsite", unit: "container", quantity: 2, unitCents: 2500, minimumCents: 0, discountBps: 0, fuelBps: 0, taxBps: 0 });
  await commercial("accept_estimate", { estimateId });
  await commercial("schedule_purge", { estimateId, date: day });
  const commercialState = await manager.getCommercialWorkspace(customerId), source = commercialState.jobs.find((j) => j.accountId === accountId);
  await field("import_jobs");
  let state = await manager.getFieldWorkspace(customerId);
  const jobId = state.jobs.find((j) => j.commercialJobId === source.id).id;
  const vehicleId = await field("add_vehicle", { name: "Demo Local Truck", capacity: 20, heightCm: 350, widthCm: 250, lengthCm: 1e3, weightKg: 16e3 });
  await field("create_route", { vehicleId, driverId: identity.user.id, date: day, jobIds: [jobId], startMinute: 480, breakMinutes: 30, dayLimit: 480 });
  assert.equal((await driver.getFieldWorkspace(customerId)).jobs.length, 1);
  await field("start_job", { jobId }, driver);
  await field("arrive_job", { jobId }, driver);
  const code = String(Date.now()).slice(-8);
  for (const suffix of ["0", "1"]) await field("scan_bin", { jobId, barcode: "DEMO-BIN-" + code + suffix }, driver);
  await field("complete_job", { jobId, production: 2, acknowledgment: "demo-customer" }, driver);
  await field("authorize_demo_destruction", { jobId, reason: "Demo supervisor authorization" });
  await field("perform_demo_destruction", { jobId }, driver);
  const certificateId = await field("issue_certificate", { jobId });
  await field("set_delivery", { accountId, recipient: "demo-office", timezone: "America/Indiana/Indianapolis", consent: true });
  await field("batch_certificates");
  state = await manager.getFieldWorkspace(customerId);
  const batchId = state.batches.find((b) => b.certificateIds.includes(certificateId)).id;
  await field("deliver_batch", { batchId, outcome: "success" });
  await field("handoff_billing", { jobId }, manager, true);
  const invoiceId = await commercial("draft_invoice", { accountId, jobIds: [source.id], from: day, to: day, due });
  assert.equal((await manager.getCommercialWorkspace(customerId)).invoices.find((i) => i.id === invoiceId).totalCents, 5e3);
  const exportId = await field("request_export");
  state = await manager.getFieldWorkspace(customerId);
  for (let attempt = 0; attempt < 100 && state.exports.find((e) => e.id === exportId).status !== "complete"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    state = await manager.getFieldWorkspace(customerId);
  }
  assert.equal(state.exports.find((e) => e.id === exportId).status, "complete", "Worker background export must finish without manual chunk requests");
  await assert.rejects(driver.getFieldWorkspace("c3"), (e) => e.status === 403);
  assert.deepEqual(await manager.getRecord("IRM-BX-1002"), before);
  assert.equal((await driver.getFieldWorkspace(customerId)).certificates.length, 0);
  await mkdir(new URL("../dist/readiness/", import.meta.url), { recursive: true });
  await writeFile(new URL("../dist/readiness/phase-b-sample.html", import.meta.url), unicodeReport(state, certificateId));
  await writeFile(new URL("../dist/readiness/phase-b-local.json", import.meta.url), JSON.stringify({ passed: true, synthetic: true, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), fieldCommands: commands, replayedEveryFieldCommand: true, backgroundExportCompleted: true, sourceInventoryUnchanged: true, driverScopeDenied: true, certificateTitle: state.certificates.find((c) => c.id === certificateId).title, batchStatus: state.batches.find((b) => b.id === batchId).status, invoiceTotalCents: 5e3, exportRows: state.exports.find((e) => e.id === exportId).rows.length }, null, 2));
  console.log("PASS: local D1 commercial-to-dispatch-to-driver-to-SAMPLE-certificate-to-invoice workflow, with replay and isolation.");
} finally {
  await Promise.allSettled([manager.endSession(), driver.endSession()]);
}
