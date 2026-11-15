import test from "node:test";
import assert from "node:assert/strict";
import { seedCommercial, applyCommercial, estimatePrice, invoiceBalance } from "../packages/commercial/workflows.js";
const price = { quantity: 2, unitCents: 2500, minimumCents: 1e3, discountBps: 500, fuelBps: 1e3, taxBps: 700 };
function harness() {
  let state = seedCommercial("c2"), n = 0;
  return { get state() {
    return state;
  }, run(type, input = {}, time = "2026-03-01T12:00:00Z") {
    const command = { id: "demo-event-" + ++n, type, input, expectedVersion: state.version };
    const result = applyCommercial(state, command, "demo-manager", time);
    state = result.state;
    return command.id;
  }, raw(command) {
    const r = applyCommercial(state, command);
    state = r.state;
    return r;
  } };
}
function customer(h) {
  const accountId = h.run("create_account", { name: "Demo Legal" });
  h.run("convert_account", { accountId });
  const locationId = h.run("add_location", { accountId, name: "Demo Branch", address: "100 Fictional Lane", timezone: "America/New_York", windowStart: "09:00", windowEnd: "12:00" });
  return { accountId, locationId };
}
function estimate(h, a, service = "purge") {
  const id = h.run("create_estimate", { ...a, service, mode: "onsite", unit: "container", ...price });
  h.run("accept_estimate", { estimateId: id });
  return id;
}
test("commercial office completes prospect, agreement, recurring/purge, consolidated billing and settlement", () => {
  const h = harness(), a = customer(h);
  h.run("add_contact", { accountId: a.accountId, name: "Demo Contact", alias: "demo-contact" });
  h.run("log_interaction", { accountId: a.accountId, note: "Synthetic consultation" });
  const task = h.run("create_task", { accountId: a.accountId, title: "Demo callback", assignee: "demo-sales", due: "2026-03-02" });
  h.run("complete_task", { taskId: task });
  const agreementId = h.run("create_agreement", { ...a, start: "2026-03-01", end: "2027-03-01", renewal: "2027-02-01", terms: "Demo 30 day cancellation", ...price });
  h.run("revise_agreement", { agreementId, ...price, unitCents: 3e3 });
  h.run("send_agreement", { agreementId });
  const out = h.state.outbox.find((o) => o.provider === "docusign");
  h.run("process_outbox", { outboxId: out.id, outcome: "success" });
  h.run("agreement_outcome", { agreementId, outcome: "signed" });
  assert.equal(h.state.agreements[0].revisions.length, 1);
  const recurring = estimate(h, { ...a, agreementId }, "recurring");
  const planId = h.run("create_plan", { estimateId: recurring, start: "2026-03-01", end: "2026-12-31", intervalDays: 7 });
  h.run("schedule_exception", { planId, date: "2026-03-08", action: "move", moveTo: "2026-03-09" });
  h.run("generate_jobs", { planId, from: "2026-03-01", through: "2026-03-15" });
  assert.deepEqual(h.state.jobs.map((j) => j.date), ["2026-03-01", "2026-03-09", "2026-03-15"]);
  h.run("generate_jobs", { planId, from: "2026-03-01", through: "2026-03-15" });
  assert.equal(h.state.jobs.length, 3);
  const second = h.run("add_location", { accountId: a.accountId, name: "Demo Annex", address: "200 Fictional Lane", timezone: "America/New_York", windowStart: "10:00", windowEnd: "15:00" });
  const purge = estimate(h, { accountId: a.accountId, locationId: second });
  h.run("schedule_purge", { estimateId: purge, date: "2026-03-05" });
  for (const j of h.state.jobs) h.run("complete_job", { jobId: j.id });
  const invoiceId = h.run("draft_invoice", { accountId: a.accountId, jobIds: h.state.jobs.map((j) => j.id), from: "2026-03-01", to: "2026-03-31", due: "2026-04-10" });
  assert.equal(h.state.invoices[0].lines.length, 4);
  assert.throws(() => h.run("draft_invoice", { accountId: a.accountId, jobIds: [h.state.jobs[0].id], from: "2026-03-01", to: "2026-03-31", due: "2026-04-10" }), /unbilled/);
  h.run("issue_invoice", { invoiceId });
  const total = h.state.invoices[0].totalCents;
  const paymentId = h.run("request_payment", { invoiceId, amountCents: total });
  assert.throws(() => h.run("request_payment", { invoiceId, amountCents: 1 }), /balance/);
  const capture = h.state.outbox.find((o) => o.provider === "payments");
  h.run("process_outbox", { outboxId: capture.id, outcome: "success" });
  assert.equal(invoiceBalance(h.state, h.state.invoices[0]).dueCents, 0);
  const refund = h.run("refund_payment", { paymentId, amountCents: 100 });
  assert.equal(invoiceBalance(h.state, h.state.invoices[0]).dueCents, 0);
  const refundBox = h.state.outbox.find((o) => o.entityId === refund);
  h.run("process_outbox", { outboxId: refundBox.id, outcome: "success" });
  assert.equal(invoiceBalance(h.state, h.state.invoices[0]).dueCents, 100);
  h.run("credit_invoice", { invoiceId, amountCents: 100, reason: "Demo service adjustment" });
  assert.equal(invoiceBalance(h.state, h.state.invoices[0]).dueCents, 0);
  assert.equal(h.state.invoices[0].totalCents, total);
  assert.throws(() => h.run("cancel_invoice", { invoiceId }), /credits/);
  const qbo = h.state.outbox.find((o) => o.kind === "invoice");
  h.run("process_outbox", { outboxId: qbo.id, outcome: "success" });
  const delivered = h.state.outbox.find((o) => o.id === qbo.id);
  h.run("reconcile_outbox", { outboxId: qbo.id, externalId: delivered.externalId, amountCents: total - 1 });
  assert.equal(h.state.outbox.find((o) => o.id === qbo.id).reconciliation.status, "conflict");
  h.run("reconcile_outbox", { outboxId: qbo.id, externalId: delivered.externalId, amountCents: total });
  assert.equal(h.state.outbox.find((o) => o.id === qbo.id).reconciliations.length, 2);
});
test("exact prices, minimums and safe rounding reject invalid financial input", () => {
  assert.equal(estimatePrice(price).totalCents, 5591);
  assert.equal(estimatePrice({ ...price, quantity: 1, unitCents: 1, minimumCents: 1e3, discountBps: 0, fuelBps: 0, taxBps: 0 }).totalCents, 1e3);
  for (const quantity of [-1, 0, 1.5, Infinity]) assert.throws(() => estimatePrice({ ...price, quantity }));
  assert.throws(() => estimatePrice({ ...price, taxBps: 10001 }));
  assert.throws(() => estimatePrice({ ...price, unitCents: 1e6, quantity: 1e4 }));
});
test("receipt replay, stale versions, cross-account references and failed mutations preserve state", () => {
  const h = harness();
  const c = { id: "demo-replay", type: "create_account", input: { name: "Demo" }, expectedVersion: 0 };
  assert.equal(h.raw(c).status, "accepted");
  assert.equal(h.raw(c).status, "already_accepted");
  assert.equal(h.state.accounts.length, 1);
  assert.throws(() => h.raw({ ...c, input: { name: "Different" } }), /reused/);
  assert.throws(() => h.raw({ ...c, id: "demo-stale" }), /changed/);
  const a = customer(h);
  const other = h.run("create_account", { name: "Other Demo" });
  const before = JSON.stringify(h.state);
  assert.throws(() => h.run("create_estimate", { accountId: other, locationId: a.locationId, service: "purge", mode: "onsite", unit: "fixed", ...price }), /another account/);
  assert.equal(JSON.stringify(h.state), before);
  h.run("archive_account", { accountId: a.accountId });
  assert.throws(() => h.run("create_estimate", { ...a, service: "purge", mode: "onsite", unit: "fixed", ...price }), /archived/);
});
test("provider failures back off, replay cannot double-settle and retry exhaustion is visible", () => {
  const h = harness(), a = customer(h);
  let o = h.state.outbox[0];
  h.run("process_outbox", { outboxId: o.id, outcome: "failure" });
  assert.throws(() => h.run("process_outbox", { outboxId: o.id, outcome: "success" }), /not ready/);
  h.run("process_outbox", { outboxId: o.id, outcome: "failure" }, "2026-03-01T13:00:00Z");
  h.run("process_outbox", { outboxId: o.id, outcome: "failure" }, "2026-03-01T14:00:00Z");
  assert.throws(() => h.run("process_outbox", { outboxId: o.id, outcome: "success" }, "2026-03-01T15:00:00Z"), /retry limit/);
  assert.equal(h.state.outbox[0].attempts, 3);
});
test("rolling generation, skips and draft cancellation do not duplicate jobs or billing", () => {
  const h = harness(), a = customer(h), estimateId = estimate(h, a, "recurring"), planId = h.run("create_plan", { estimateId, start: "2026-01-01", end: "2026-12-31", intervalDays: 7 });
  h.run("schedule_exception", { planId, date: "2026-01-08", action: "skip" });
  h.run("generate_jobs", { planId, from: "2026-01-01", through: "2026-01-15" });
  assert.equal(h.state.jobs.length, 2);
  h.run("generate_jobs", { planId, from: "2026-07-01", through: "2026-07-31" });
  assert.equal(h.state.jobs.filter((j2) => j2.date.startsWith("2026-07")).length, 5);
  const j = h.state.jobs[0];
  h.run("complete_job", { jobId: j.id });
  const invoiceId = h.run("draft_invoice", { accountId: a.accountId, jobIds: [j.id], from: "2026-01-01", to: "2026-01-31", due: "2026-02-01" });
  h.run("cancel_invoice", { invoiceId });
  assert.equal(h.state.jobs[0].invoiceId, null);
  h.run("draft_invoice", { accountId: a.accountId, jobIds: [j.id], from: "2026-01-01", to: "2026-01-31", due: "2026-02-01" });
  assert.equal(h.state.invoices.length, 2);
});
test("synthetic CRM imports reconcile duplicate and conflicting rows without overwriting accounts", () => {
  const h = harness();
  const csv = "ExternalID,Name,Stage\ndemo-a,Demo Alpha,customer\ndemo-b,Demo Beta,prospect\ndemo-a,Demo Duplicate,prospect\nreal,Not Fictional,customer\n";
  h.run("import_accounts", { csv });
  assert.equal(h.state.accounts.length, 2);
  assert.equal(h.state.imports[0].rejected.length, 2);
  h.run("import_accounts", { csv: "ExternalID,Name,Stage\ndemo-a,Demo Changed,customer\ndemo-b,Demo Beta,prospect\n" });
  assert.deepEqual(h.state.imports[1].conflicts, ["demo-a"]);
  assert.deepEqual(h.state.imports[1].matched, ["demo-b"]);
  assert.equal(h.state.accounts[0].name, "Demo Alpha");
});
test("plan cancellation and exhausted-delivery review preserve prior evidence", () => {
  const h = harness(), a = customer(h), estimateId = estimate(h, a, "recurring"), planId = h.run("create_plan", { estimateId, start: "2026-03-01", end: "2026-12-31", intervalDays: 7 });
  h.run("generate_jobs", { planId, through: "2026-03-15" });
  h.run("cancel_plan", { planId });
  assert.ok(h.state.jobs.every((j) => j.status === "cancelled"));
  assert.throws(() => h.run("generate_jobs", { planId, through: "2026-03-15" }), /cancelled/);
  const o = h.state.outbox[0];
  for (let i = 0; i < 3; i++) h.run("process_outbox", { outboxId: o.id, outcome: "failure" }, "2026-03-01T" + (13 + i) + ":00:00Z");
  h.run("review_delivery", { outboxId: o.id, reason: "Demo provider outage resolved" }, "2026-03-01T16:00:00Z");
  h.run("process_outbox", { outboxId: o.id, outcome: "success" }, "2026-03-01T16:00:01Z");
  assert.equal(h.state.outbox[0].reviews.length, 1);
  assert.equal(h.state.outbox[0].status, "succeeded");
});
test("multi-location agreements and invoice billing snapshots retain the original customer details", () => {
  const h = harness(), a = customer(h);
  const second = h.run("add_location", { accountId: a.accountId, name: "Demo Billing Office", address: "200 Demo Street", timezone: "UTC", windowStart: "09:00", windowEnd: "17:00" });
  const contact = h.run("add_contact", { accountId: a.accountId, name: "Demo Billing", alias: "demo-billing" });
  h.run("set_billing", { accountId: a.accountId, locationId: second, contactId: contact });
  const agreementId = h.run("create_agreement", { accountId: a.accountId, locationIds: [a.locationId, second], start: "2026-01-01", end: "2026-12-31", renewal: "2026-11-01", terms: "Demo terms", ...price });
  h.run("send_agreement", { agreementId });
  h.run("process_outbox", { outboxId: h.state.outbox.find((o) => o.provider === "docusign").id, outcome: "success" });
  h.run("agreement_outcome", { agreementId, outcome: "signed" });
  const e = estimate(h, { accountId: a.accountId, locationId: second, agreementId });
  h.run("schedule_purge", { estimateId: e, date: "2026-03-01" });
  const j = h.state.jobs[0];
  h.run("complete_job", { jobId: j.id });
  h.run("draft_invoice", { accountId: a.accountId, jobIds: [j.id], from: "2026-03-01", to: "2026-03-31", due: "2026-04-01" });
  h.run("update_account", { accountId: a.accountId, name: "Demo Renamed" });
  assert.equal(h.state.invoices[0].billTo.name, "Demo Legal");
  assert.equal(h.state.invoices[0].billTo.location.name, "Demo Billing Office");
  assert.equal(h.state.invoices[0].billTo.contact.alias, "demo-billing");
  assert.equal(h.state.agreements[0].locationIds.length, 2);
});
