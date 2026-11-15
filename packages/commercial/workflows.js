import { parseCsv } from "../integrations/adapters.js";
const TENANTS = ["c1", "c2", "c3", "c4"];
function seedCommercial(customerId) {
  if (!TENANTS.includes(customerId)) throw Error("Synthetic customer required");
  return { schemaVersion: 1, synthetic: true, customerId, version: 0, accounts: [], imports: [], locations: [], contacts: [], activities: [], tasks: [], agreements: [], estimates: [], plans: [], jobs: [], invoices: [], payments: [], outbox: [], events: [], receipts: {} };
}
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const text = (v, label, max = 160) => {
  if (typeof v !== "string" || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) fail("Invalid " + label);
  return v.trim();
};
const num = (v, label, max = 1e8) => {
  if (!Number.isSafeInteger(v) || v < 0 || v > max) fail("Invalid " + label);
  return v;
};
const day = (v) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) fail("Invalid service date");
  return v;
};
const addDays = (v, n) => new Date(Date.parse(v) + n * 864e5).toISOString().slice(0, 10);
const bp = (amount, rate) => Number((BigInt(amount) * BigInt(rate) + 5000n) / 10000n);
function estimatePrice(p) {
  const measured = p.measuredQuantity !== undefined && p.measuredQuantity !== '';
  let quantity, quantityMilli;
  if (measured) {
    if (!['weight','hour'].includes(p.unit) || typeof p.measuredQuantity !== 'string' || !/^(0|[1-9][0-9]{0,4})(\.[0-9]{1,3})?$/.test(p.measuredQuantity)) fail('Measured units require weight/hour and up to three decimal places');
    const [whole,fraction=''] = p.measuredQuantity.split('.');
    quantityMilli = Number(whole)*1000+Number(fraction.padEnd(3,'0'));
    if (quantityMilli>10000000) fail('Measured quantity exceeds 10,000 units');
    quantity = quantityMilli/1000;
  } else quantity = num(p.quantity, "quantity", 1e4);
  if (!quantity) fail("Quantity must be positive");
  const rate = num(p.unitCents, "unit price", 1e6), minimum = num(p.minimumCents, "minimum"), discount = num(p.discountBps, "discount", 1e4), fuel = num(p.fuelBps, "fuel surcharge", 1e4), tax = num(p.taxBps, "tax", 1e4);
  const extended = measured ? Number((BigInt(quantityMilli)*BigInt(rate)+500n)/1000n) : quantity*rate;
  const base = Math.max(extended, minimum);
  const discountCents = bp(base, discount), net = base - discountCents, fuelCents = bp(net, fuel), taxCents = bp(net + fuelCents, tax);
  const totalCents = net + fuelCents + taxCents;
  if (!Number.isSafeInteger(totalCents) || totalCents > 1e8) fail("Estimate exceeds synthetic money limit");
  return { quantity, ...(measured?{quantityMilli,quantityScale:1000}:{}), unitCents: rate, minimumCents: minimum, discountBps: discount, fuelBps: fuel, taxBps: tax, baseCents: base, discountCents, fuelCents, taxCents, totalCents, currency: "USD" };
}
function invoiceBalance(s, invoice) {
  const payments = s.payments.filter((p) => p.invoiceId === invoice.id && p.status === "captured").reduce((n, p) => n + p.amountCents - p.refundedCents, 0), credits = (invoice.credits || []).reduce((n, c) => n + c.amountCents, 0);
  return { paidCents: payments, creditCents: credits, dueCents: invoice.totalCents - credits - payments };
}
function applyCommercial(state, command, actor = "demo-operator", now = (/* @__PURE__ */ new Date()).toISOString()) {
  if (!state?.synthetic || !TENANTS.includes(state.customerId)) fail("Synthetic workspace required");
  if (!command || typeof command !== "object" || !/^demo-[a-zA-Z0-9-]{1,80}$/.test(command.id)) fail("A synthetic event ID is required");
  const signature = JSON.stringify({ type: command.type, input: command.input, expectedVersion: command.expectedVersion });
  if (state.receipts[command.id]) {
    if (state.receipts[command.id].signature !== signature) fail("Event ID reused with different content", 409);
    return { state, status: "already_accepted", result: state.receipts[command.id].result };
  }
  if (command.expectedVersion !== state.version) fail("Workspace changed; refresh before saving", 409);
  if (Object.keys(state.receipts).length >= 2e3) fail("Synthetic workspace event limit reached", 413);
  const s = structuredClone(state), x = command.input || {}, id = command.id, who = text(actor, "actor"), at = new Date(now).toISOString();
  let result = { id };
  const find = (name, key) => {
    const value = s[name].find((r) => r.id === key);
    if (!value) fail("Unknown " + name + " reference", 404);
    return value;
  };
  const account = (key) => {
    const a = find("accounts", key);
    if (a.archived) fail("Account is archived", 409);
    return a;
  };
  const location = (key) => {
    const l = find("locations", key);
    account(l.accountId);
    if (l.archived) fail("Location is archived", 409);
    return l;
  };
  const enqueue = (provider, kind, entityId) => {
    const key = provider + ":" + kind + ":" + entityId + (provider === "qbo" ? ":" + s.version : "");
    if (!s.outbox.some((e) => e.key === key)) s.outbox.push({ id: "box-" + id + "-" + s.outbox.length, key, provider, kind, entityId, status: "pending", attempts: 0, nextAttemptAt: at, externalId: null, error: null, payload: structuredClone(s.invoices.find((v) => v.id === entityId) || s.agreements.find((v) => v.id === entityId) || s.payments.find((v) => v.id === entityId) || s.accounts.find((v) => v.id === entityId) || s.invoices.flatMap((i) => i.credits).find((c) => c.id === entityId) || s.payments.flatMap((p) => p.refunds || []).find((r) => r.id === entityId) || { reference: entityId }), reconciliation: null, reconciliations: [] });
  };
  const job = (estimate, date, locationId, occurrence) => {
    if (s.jobs.some((j) => j.occurrence === occurrence)) return;
    const l = location(locationId);
    if (l.accountId !== estimate.accountId) fail("Location belongs to another account");
    if (s.jobs.length >= 1e3) fail("Synthetic job limit reached", 413);
    s.jobs.push({ id: "job-" + occurrence, occurrence, accountId: l.accountId, locationId, date, status: "scheduled", invoiceId: null, estimateId: estimate.id, price: structuredClone(estimate.price) });
  };
  switch (command.type) {
    case "create_account":
      if (s.accounts.length >= 100) fail("Synthetic account limit reached", 413);
      s.accounts.push({ id, name: text(x.name, "account name"), stage: "prospect", archived: false, lossReason: null });
      break;
    case "import_accounts": {
      if (typeof x.csv !== "string" || new TextEncoder().encode(x.csv).length > 8e3) fail("Synthetic CRM CSV must be at most 8 KiB");
      const parsed = parseCsv(x.csv, { maxRows: 50 });
      if (parsed.header.join(",") !== "ExternalID,Name,Stage") fail("Use ExternalID,Name,Stage headers");
      const report = { id, contract: "synthetic-crm-v1", accepted: [], matched: [], conflicts: [], rejected: [] }, seen = /* @__PURE__ */ new Set();
      for (const [index, row] of parsed.rows.entries()) {
        if (!/^demo-[a-z0-9-]{1,40}$/.test(row.ExternalID) || !/^Demo /i.test(row.Name) || !["prospect", "customer"].includes(row.Stage) || seen.has(row.ExternalID)) {
          report.rejected.push({ row: index + 2, reason: "Invalid or duplicate fictional CRM row" });
          continue;
        }
        seen.add(row.ExternalID);
        const existing = s.accounts.find((a) => a.externalId === row.ExternalID);
        if (existing) {
          (existing.name === row.Name && existing.stage === row.Stage && !existing.archived ? report.matched : report.conflicts).push(row.ExternalID);
          continue;
        }
        if (s.accounts.length >= 100) fail("Synthetic account limit reached", 413);
        const imported = { id: "demo-import-" + row.ExternalID, externalId: row.ExternalID, name: text(row.Name, "name"), stage: row.Stage, archived: false, lossReason: null };
        if (s.accounts.some((a) => a.id === imported.id)) fail("Imported ID conflicts with an existing account", 409);
        s.accounts.push(imported);
        if (imported.stage === "customer") enqueue("qbo", "customer", imported.id);
        report.accepted.push(row.ExternalID);
      }
      s.imports ||= [];
      s.imports.push(report);
      result = report;
      break;
    }
    case "convert_account": {
      const a = account(x.accountId);
      if (a.stage !== "prospect") fail("Only prospects can be converted", 409);
      a.stage = "customer";
      enqueue("qbo", "customer", a.id);
      break;
    }
    case "update_account": {
      const a = account(x.accountId);
      a.name = text(x.name, "account name");
      if (a.stage === "customer") enqueue("qbo", "customer", a.id);
      break;
    }
    case "lose_prospect": {
      const a = account(x.accountId);
      if (a.stage !== "prospect") fail("Only prospects can be marked lost", 409);
      a.stage = "lost";
      a.lossReason = text(x.reason, "loss reason");
      break;
    }
    case "archive_account": {
      const a = account(x.accountId);
      a.archived = true;
      break;
    }
    case "add_location": {
      account(x.accountId);
      text(x.timezone, "timezone");
      try {
        new Intl.DateTimeFormat("en", { timeZone: x.timezone }).format();
      } catch {
        fail("Invalid timezone");
      }
      ;
      if (!/^\d{2}:\d{2}$/.test(x.windowStart) || !/^\d{2}:\d{2}$/.test(x.windowEnd) || x.windowStart >= "24:00" || x.windowEnd >= "24:00" || x.windowStart.slice(3) >= "60" || x.windowEnd.slice(3) >= "60" || x.windowStart >= x.windowEnd) fail("Invalid local service window");
      s.locations.push({ id, accountId: x.accountId, name: text(x.name, "location name"), address: text(x.address, "fictional address"), timezone: x.timezone, windowStart: x.windowStart, windowEnd: x.windowEnd, archived: false });
      break;
    }
    case "archive_location":
      location(x.locationId).archived = true;
      break;
    case "set_billing": {
      const a = account(x.accountId), l = location(x.locationId);
      if (l.accountId !== a.id) fail("Billing location belongs to another account");
      let c = null;
      if (x.contactId) {
        c = find("contacts", x.contactId);
        if (c.accountId !== a.id || c.archived) fail("Billing contact belongs to another account or is archived");
      }
      ;
      a.billingLocationId = l.id;
      a.billingContactId = c?.id || null;
      break;
    }
    case "add_contact":
      account(x.accountId);
      if (!/^demo-[a-z0-9-]+$/i.test(x.alias)) fail("Use a demo- contact alias");
      s.contacts.push({ id, accountId: x.accountId, name: text(x.name, "contact"), alias: x.alias });
      break;
    case "archive_contact": {
      const c = find("contacts", x.contactId);
      account(c.accountId);
      c.archived = true;
      break;
    }
    case "log_interaction":
      account(x.accountId);
      s.activities.push({ id, accountId: x.accountId, note: text(x.note, "interaction", 500), actor: who, at });
      break;
    case "create_task":
      account(x.accountId);
      s.tasks.push({ id, accountId: x.accountId, title: text(x.title, "task"), assignee: text(x.assignee, "assignee"), due: day(x.due), status: "open" });
      break;
    case "complete_task":
      find("tasks", x.taskId).status = "completed";
      break;
    case "create_agreement": {
      const a = account(x.accountId);
      const covered = x.locationIds || [x.locationId];
      if (!Array.isArray(covered) || !covered.length || covered.length > 50 || new Set(covered).size !== covered.length) fail("Choose unique agreement locations");
      const coveredLocations = covered.map((key) => location(key));
      if (coveredLocations.some((l2) => l2.accountId !== a.id)) fail("Location belongs to another account");
      const l = coveredLocations[0];
      const start = day(x.start), end = day(x.end);
      if (start > end) fail("Agreement end precedes start");
      s.agreements.push({ id, accountId: a.id, locationId: l.id, locationIds: covered, start, end, renewal: day(x.renewal), terms: text(x.terms, "cancellation terms", 500), price: estimatePrice(x), revisions: [], revision: 1, status: "draft", externalId: null });
      break;
    }
    case "revise_agreement": {
      const a = find("agreements", x.agreementId);
      if (a.status !== "draft") fail("Only draft agreements may be revised", 409);
      a.revisions.push({ revision: a.revision, price: structuredClone(a.price), at });
      a.price = estimatePrice(x);
      a.revision++;
      break;
    }
    case "send_agreement": {
      const a = find("agreements", x.agreementId);
      account(a.accountId);
      if (a.status !== "draft") fail("Agreement is not a draft", 409);
      a.status = "queued";
      enqueue("docusign", "send", a.id);
      break;
    }
    case "agreement_outcome": {
      const a = find("agreements", x.agreementId);
      if (a.status !== "sent" || !["signed", "declined", "voided"].includes(x.outcome)) fail("Invalid simulated signature transition", 409);
      a.status = x.outcome;
      break;
    }
    case "terminate_agreement": {
      const a = find("agreements", x.agreementId);
      if (a.status !== "signed") fail("Only signed agreements can terminate", 409);
      a.status = "terminated";
      a.terminationReason = text(x.reason, "termination reason");
      break;
    }
    case "create_estimate": {
      const a = account(x.accountId), l = location(x.locationId);
      if (l.accountId !== a.id) fail("Location belongs to another account");
      if (!["purge", "recurring"].includes(x.service) || !["onsite", "offsite"].includes(x.mode) || !["container", "weight", "hour", "fixed"].includes(x.unit)) fail("Invalid shredding service");
      let agreement = null;
      if (x.agreementId) {
        agreement = find("agreements", x.agreementId);
        if (agreement.accountId !== a.id || !(agreement.locationIds || [agreement.locationId]).includes(l.id) || agreement.status !== "signed") fail("Signed agreement for the same location required");
      }
      ;
      s.estimates.push({ id, accountId: a.id, locationId: l.id, agreementId: agreement?.id || null, agreementRevision: agreement?.revision || null, service: x.service, mode: x.mode, unit: x.unit, revisions: [], revision: 1, status: "draft", price: agreement ? structuredClone(agreement.price) : estimatePrice(x) });
      break;
    }
    case "revise_estimate": {
      const e = find("estimates", x.estimateId);
      if (e.status !== "draft" || e.agreementId) fail("Only uncontracted draft estimates can be revised", 409);
      e.revisions.push({ revision: e.revision, price: structuredClone(e.price), at });
      e.price = estimatePrice({...x,unit:e.unit});
      e.revision++;
      break;
    }
    case "accept_estimate": {
      const e = find("estimates", x.estimateId);
      if (account(e.accountId).stage !== "customer" || e.status !== "draft") fail("An active customer and draft estimate are required", 409);
      e.status = "accepted";
      break;
    }
    case "schedule_purge": {
      const e = find("estimates", x.estimateId);
      if (e.status !== "accepted" || e.service !== "purge") fail("Accepted purge estimate required");
      if (s.jobs.some((j) => j.estimateId === e.id)) fail("Estimate already scheduled", 409);
      const date = day(x.date);
      if (e.agreementId) {
        const a = find("agreements", e.agreementId);
        if (a.status !== "signed" || date < a.start || date > a.end) fail("Service date is outside the signed agreement");
      }
      ;
      job(e, date, e.locationId, e.id);
      break;
    }
    case "create_plan": {
      const e = find("estimates", x.estimateId);
      if (e.status !== "accepted" || e.service !== "recurring") fail("Accepted recurring estimate required");
      if (s.plans.some((p) => p.estimateId === e.id)) fail("Plan already exists", 409);
      const start = day(x.start), end = day(x.end), intervalDays = num(x.intervalDays, "interval", 90);
      if (!intervalDays || end < start) fail("Invalid schedule");
      s.plans.push({ id, estimateId: e.id, start, end, intervalDays, status: "active", exceptions: {} });
      break;
    }
    case "cancel_plan": {
      const p = find("plans", x.planId);
      if (p.status === "cancelled") fail("Plan is already cancelled", 409);
      p.status = "cancelled";
      for (const j of s.jobs.filter((j2) => j2.occurrence.startsWith(p.id + "-") && j2.status === "scheduled" && !j2.invoiceId)) j.status = "cancelled";
      break;
    }
    case "schedule_exception": {
      const p = find("plans", x.planId), date = day(x.date);
      if (date < p.start || date > p.end || (Date.parse(date) - Date.parse(p.start)) % (p.intervalDays * 864e5) !== 0) fail("Date is not a plan occurrence");
      if (s.jobs.some((j) => j.occurrence === p.id + "-" + date)) fail("Use job reschedule/cancel for generated occurrences", 409);
      if (x.action !== "skip" && x.action !== "move") fail("Invalid schedule exception");
      p.exceptions[date] = x.action === "skip" ? null : day(x.moveTo);
      break;
    }
    case "generate_jobs": {
      const p = find("plans", x.planId);
      if (p.status === "cancelled") fail("Recurring plan is cancelled", 409);
      const e = find("estimates", p.estimateId), through = day(x.through), from = day(x.from || p.start);
      if (through < from || from < p.start || Date.parse(through) - Date.parse(from) > 90 * 864e5) fail("Generation horizon must be within 90 days of generation start");
      for (let date = addDays(p.start, Math.ceil((Date.parse(from) - Date.parse(p.start)) / (p.intervalDays * 864e5)) * p.intervalDays); date <= p.end && date <= through; date = addDays(date, p.intervalDays)) {
        const actual = Object.hasOwn(p.exceptions, date) ? p.exceptions[date] : date;
        if (actual === null) continue;
        if (e.agreementId) {
          const a = find("agreements", e.agreementId);
          if (a.status !== "signed" || actual < a.start || actual > a.end) fail("Occurrence outside signed agreement");
        }
        ;
        job(e, actual, e.locationId, p.id + "-" + date);
      }
      break;
    }
    case "reschedule_job": {
      const j = find("jobs", x.jobId);
      if (j.status !== "scheduled" || j.invoiceId) fail("Only unbilled scheduled jobs can move", 409);
      const date = day(x.date), e = find("estimates", j.estimateId);
      if (e.agreementId) {
        const a = find("agreements", e.agreementId);
        if (a.status !== "signed" || date < a.start || date > a.end) fail("Date outside signed agreement");
      }
      ;
      j.date = date;
      break;
    }
    case "cancel_job": {
      const j = find("jobs", x.jobId);
      if (j.status !== "scheduled" || j.invoiceId) fail("Only unbilled scheduled jobs can cancel", 409);
      j.status = "cancelled";
      break;
    }
    case "complete_job": {
      const j = find("jobs", x.jobId);
      if (j.status !== "scheduled") fail("Job must be scheduled", 409);
      account(j.accountId);
      j.status = "completed";
      j.completedAt = at;
      break;
    }
    case "draft_invoice": {
      const a = account(x.accountId);
      if (!Array.isArray(x.jobIds) || !x.jobIds.length || x.jobIds.length > 100 || new Set(x.jobIds).size !== x.jobIds.length) fail("Choose 1\u2013100 unique completed jobs");
      const from = day(x.from), to = day(x.to);
      if (from > to) fail("Invalid billing period");
      const jobs = x.jobIds.map((key) => find("jobs", key));
      if (jobs.some((j) => j.accountId !== a.id || j.status !== "completed" || j.invoiceId || j.date < from || j.date > to)) fail("Jobs must be completed, in period, same account and unbilled", 409);
      const due = day(x.due);
      const lines = jobs.map((j) => ({ jobId: j.id, locationId: j.locationId, date: j.date, price: structuredClone(j.price) })), totalCents = lines.reduce((n, l) => n + l.price.totalCents, 0);
      num(totalCents, "invoice total");
      s.invoices.push({ id, accountId: a.id, from, to, due, status: "draft", currency: "USD", lines, totalCents, billTo: { name: a.name, location: structuredClone(s.locations.find((l) => l.id === a.billingLocationId) || s.locations.find((l) => l.accountId === a.id) || null), contact: structuredClone(s.contacts.find((c) => c.id === a.billingContactId) || null) }, credits: [] });
      jobs.forEach((j) => j.invoiceId = id);
      break;
    }
    case "cancel_invoice": {
      const i = find("invoices", x.invoiceId);
      if (i.status !== "draft") fail("Issued invoices require credits", 409);
      i.status = "cancelled";
      s.jobs.filter((j) => j.invoiceId === i.id).forEach((j) => j.invoiceId = null);
      break;
    }
    case "issue_invoice": {
      const i = find("invoices", x.invoiceId);
      if (i.status !== "draft") fail("Only draft invoices may issue", 409);
      i.status = "issued";
      i.issuedAt = at;
      enqueue("qbo", "invoice", i.id);
      break;
    }
    case "credit_invoice": {
      const i = find("invoices", x.invoiceId), amountCents = num(x.amountCents, "credit");
      if (i.status !== "issued" || !amountCents || amountCents > invoiceBalance(s, i).dueCents || s.payments.some((p) => p.invoiceId === i.id && p.status === "pending")) fail("Credit exceeds available balance or payment is pending", 409);
      i.credits.push({ id, amountCents, reason: text(x.reason, "credit reason"), at });
      enqueue("qbo", "credit", id);
      break;
    }
    case "request_payment": {
      const i = find("invoices", x.invoiceId), amountCents = num(x.amountCents, "payment");
      const pending = s.payments.filter((p) => p.invoiceId === i.id && p.status === "pending").reduce((n, p) => n + p.amountCents, 0);
      if (i.status !== "issued" || !amountCents || amountCents > invoiceBalance(s, i).dueCents - pending) fail("Payment exceeds unreserved balance", 409);
      s.payments.push({ id, invoiceId: i.id, amountCents, refundedCents: 0, refunds: [], status: "pending", checkout: "synthetic-checkout:" + id });
      enqueue("payments", "capture", id);
      break;
    }
    case "refund_payment": {
      const p = find("payments", x.paymentId), amountCents = num(x.amountCents, "refund");
      if (p.status !== "captured" || !amountCents || amountCents > p.amountCents - p.refundedCents - p.refunds.filter((r) => r.status === "pending").reduce((n, r) => n + r.amountCents, 0)) fail("Refund exceeds captured funds", 409);
      p.refunds.push({ id, amountCents, status: "pending" });
      enqueue("payments", "refund", id);
      break;
    }
    case "process_outbox": {
      const o = find("outbox", x.outboxId);
      if (!["pending", "failed"].includes(o.status) || o.attempts >= 3 || o.nextAttemptAt > at) fail("Outbox not ready or retry limit reached", 409);
      if (!["success", "failure"].includes(x.outcome)) fail("Choose a simulated provider outcome");
      o.attempts++;
      if (x.outcome === "failure") {
        o.status = "failed";
        o.error = "Synthetic provider failure";
        o.nextAttemptAt = new Date(Date.parse(at) + Math.min(3600, 2 ** o.attempts * 30) * 1e3).toISOString();
        break;
      }
      o.status = "succeeded";
      o.error = null;
      o.externalId = "synthetic-" + o.provider + "-" + o.entityId;
      if (o.provider === "docusign") {
        const a = find("agreements", o.entityId);
        a.status = "sent";
        a.externalId = o.externalId;
      }
      if (o.provider === "payments" && o.kind === "refund") {
        const p = s.payments.find((p2) => p2.refunds.some((r2) => r2.id === o.entityId));
        if (!p) fail("Refund not found");
        const r = p.refunds.find((r2) => r2.id === o.entityId);
        if (r.status !== "pending") fail("Refund already settled", 409);
        r.status = "refunded";
        p.refundedCents += r.amountCents;
        enqueue("qbo", "refund", r.id);
      }
      if (o.provider === "payments" && o.kind === "capture") {
        const p = find("payments", o.entityId);
        if (p.status !== "pending") fail("Payment already settled", 409);
        p.status = "captured";
        enqueue("qbo", "payment", p.id);
      }
      break;
    }
    case "review_delivery": {
      const o = find("outbox", x.outboxId);
      if (o.status !== "failed" || o.attempts < 3) fail("Only exhausted failed deliveries require review", 409);
      o.reviews ||= [];
      o.reviews.push({ attempts: o.attempts, error: o.error, reason: text(x.reason, "review reason"), actor: who, at });
      o.status = "pending";
      o.attempts = 0;
      o.nextAttemptAt = at;
      break;
    }
    case "reconcile_outbox": {
      const o = find("outbox", x.outboxId);
      if (o.provider !== "qbo" || o.status !== "succeeded") fail("A delivered synthetic QBO entry is required", 409);
      const observed = text(x.externalId, "simulated external reference");
      const expected = o.payload.totalCents ?? o.payload.amountCents ?? 0;
      const total = num(x.amountCents, "external total");
      o.reconciliation = { observed, total, expected, status: observed === o.externalId && total === expected ? "matched" : "conflict", at };
      o.reconciliations.push(structuredClone(o.reconciliation));
      break;
    }
    case "cancel_payment": {
      const p = find("payments", x.paymentId);
      if (p.status !== "pending") fail("Only pending payment requests can cancel", 409);
      p.status = "cancelled";
      const o = s.outbox.find((o2) => o2.provider === "payments" && o2.entityId === p.id);
      if (o) o.status = "cancelled";
      break;
    }
    default:
      fail("Unknown commercial action");
  }
  s.version++;
  s.events.push({ id, action: command.type, actor: who, at });
  s.receipts[id] = { signature, result };
  if (new TextEncoder().encode(JSON.stringify(s)).length > 15e5) fail("Synthetic workspace storage limit reached", 413);
  return { state: s, status: "accepted", result };
}
export {
  TENANTS,
  applyCommercial,
  estimatePrice,
  invoiceBalance,
  seedCommercial
};
