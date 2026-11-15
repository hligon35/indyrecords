function encodedLength(text) {
  let bytes = 0;
  for (const char of text) {
    const c = char.codePointAt(0);
    bytes += c <= 127 ? 1 : c <= 2047 ? 2 : c <= 65535 ? 3 : 4;
  }
  return bytes;
}
import { planRoute, fixtureMatrix, optimizeRoute } from "./routing.js";
import { canonical } from "../warehouse/workflows.js";
const DRIVER_ACTIONS = ["start_job", "arrive_job", "scan_bin", "complete_job", "job_exception", "perform_demo_destruction"];
const MANAGER_ACTIONS = ["demo_jobs", "import_jobs", "add_vehicle", "configure_job", "cancel_field_job", "review_job_conflict", "set_vehicle_availability", "create_route", "resequence_route", "reassign_job", "review_exception", "authorize_demo_destruction", "issue_certificate", "void_certificate", "set_delivery", "batch_certificates", "deliver_batch", "review_batch", "telemetry", "navigation", "request_export", "advance_export"];
const fail = (m, status = 409) => {
  throw Object.assign(Error(m), { status });
};
const txt = (v, n = 160) => {
  if (typeof v !== "string" || !v.trim() || v.length > n || /[\u0000-\u001f\u007f]/.test(v)) fail("Invalid fictional text", 400);
  return v.trim();
};
const number = (v, max = 1e6) => {
  if (!Number.isSafeInteger(v) || v < 0 || v > max) fail("Invalid nonnegative quantity", 400);
  return v;
};
const date = (v) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(v).toISOString().slice(0, 10) !== v) fail("Invalid local date", 400);
  return v;
};
async function digest(v, hash) {
  const value = canonical(v);
  if (hash) return hash(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((n) => n.toString(16).padStart(2, "0")).join("");
}
function seedField(customerId = "c2") {
  if (!["c1", "c2", "c3", "c4"].includes(customerId)) fail("Synthetic tenant required", 400);
  return { schema: 1, synthetic: true, customerId, version: 0, jobs: [], vehicles: [], routes: [], custody: [], certificates: [], delivery: [], batches: [], telemetry: [], navigation: [], exports: [], receipts: [] };
}
function demoJobs(customerId) {
  return [1, 2].map((n) => ({ id: "demo-field-job-" + n, accountId: "demo-account", locationId: "demo-site-" + n, customerId, date: "2026-11-15", name: "Demo stop " + n, address: n * 100 + " Fictional Street", timezone: "America/Indiana/Indianapolis", openMinute: 480, closeMinute: 1020, serviceMinutes: 20, containers: 2, status: "unassigned", driverId: null, version: 0, bins: [], production: 0, acknowledgment: null, authorization: null, performed: null, commercialJobId: null }));
}
function seedDriverField(customerId = "c2") {
  const s = seedField(customerId);
  s.jobs = demoJobs(customerId).map((j) => ({ ...j, status: "assigned", driverId: "local-demo-driver" }));
  return s;
}
async function verifyFieldCustody(events, hash) {
  let previous = "genesis";
  for (const { hash: stored, ...event } of events) {
    if (event.previousHash !== previous || await digest(event, hash) !== stored) return false;
    previous = stored;
  }
  return true;
}
async function applyField(previous, command, actor, now = (/* @__PURE__ */ new Date()).toISOString(), hash, trustedJobs = null) {
  if (!previous?.synthetic || !["c1", "c2", "c3", "c4"].includes(previous.customerId)) fail("Synthetic workspace required", 403);
  if (!command || !/^demo-[a-zA-Z0-9-]{1,100}$/.test(command.clientEventId) || ![...MANAGER_ACTIONS, ...DRIVER_ACTIONS].includes(command.type)) fail("Invalid field command", 400);
  txt(actor);
  const fingerprint = canonical(command), receipt = previous.receipts.find((r) => r.clientEventId === command.clientEventId);
  if (receipt) {
    if (receipt.actor !== actor || receipt.fingerprint !== fingerprint) fail("Event ID reused with different actor/content");
    return { state: previous, status: "already_accepted" };
  }
  if (previous.receipts.length >= 3e3) fail("Synthetic field event limit reached", 413);
  const s = JSON.parse(JSON.stringify(previous)), x = command.input || {}, id = command.clientEventId, at = new Date(now).toISOString();
  const find = (type, key) => {
    const r = s[type].find((v) => v.id === key);
    if (!r) fail("Unknown " + type + " reference", 404);
    return r;
  };
  const j = x.jobId ? find("jobs", x.jobId) : null;
  if (DRIVER_ACTIONS.includes(command.type)) {
    if (!j) fail("Job required", 400);
    if (j.driverId !== actor) fail("Job is assigned to another driver", 403);
    if (j.reviewRequired) fail("Supervisor review required before replacement");
    if (command.expectedJobVersion !== j.version) fail("Job changed or was reassigned; review conflict");
  } else if (command.expectedVersion !== s.version) fail("Workspace changed; reload before dispatch");
  let event = null;
  const record = (action, data = {}) => {
    event = { id, jobId: j?.id || null, action, actor, at, data, previousHash: s.custody.at(-1)?.hash || "genesis" };
  };
  switch (command.type) {
    case "demo_jobs":
      if (s.jobs.length) fail("Workspace already contains jobs");
      s.jobs = demoJobs(s.customerId);
      break;
    case "import_jobs": {
      const incoming = trustedJobs || x.jobs;
      if (!Array.isArray(incoming) || incoming.length > 500) fail("Bounded commercial jobs required", 400);
      for (const value of incoming) {
        if (s.jobs.some((j2) => j2.commercialJobId === value.id && j2.status !== "cancelled")) continue;
        const minute = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
        s.jobs.push({ id: "field-" + txt(value.id) + "-" + s.jobs.length, commercialJobId: value.id, accountId: txt(value.accountId), locationId: txt(value.locationId), customerId: s.customerId, name: txt(value.name), address: txt(value.address || "Demo address pending"), timezone: txt(value.timezone || "UTC"), date: date(value.date), openMinute: minute(value.windowStart), closeMinute: minute(value.windowEnd), serviceMinutes: number(value.serviceMinutes || 20, 1440), containers: number(value.containers || 2, 1e3), status: "unassigned", driverId: null, version: 0, bins: [], production: 0, acknowledgment: null, authorization: null, performed: null });
      }
      break;
    }
    case "add_vehicle":
      s.vehicles.push({ id, name: txt(x.name), capacity: number(x.capacity, 1e3), heightCm: number(x.heightCm, 1e3), weightKg: number(x.weightKg, 1e5), widthCm: number(x.widthCm ?? 250, 1e3), lengthCm: number(x.lengthCm ?? 1e3, 5e3), available: true });
      break;
    case "review_job_conflict":
      if (!j.reviewRequired) fail("No version conflict to review");
      j.conflictReviews ||= [];
      j.conflictReviews.push({ ...j.reviewRequired, reviewer: actor, reason: txt(x.reason), reviewedAt: at });
      j.reviewRequired = null;
      j.version++;
      record("version_conflict_reviewed", j.conflictReviews.at(-1));
      break;
    case "configure_job":
      if (!["unassigned", "assigned"].includes(j.status)) fail("Only unstarted jobs can be configured");
      j.serviceMinutes = number(x.serviceMinutes, 1440);
      j.containers = number(x.containers, 1e3);
      if (!j.serviceMinutes || !j.containers) fail("Positive service duration and bin count required", 400);
      j.version++;
      if (j.routeId) find("routes", j.routeId).needsReview = true;
      record("configured", { serviceMinutes: j.serviceMinutes, containers: j.containers });
      break;
    case "cancel_field_job":
      if (j.status === "completed" || j.bins.length) fail("Completed jobs or collected bins require custody review");
      j.status = "cancelled";
      j.version++;
      if (j.routeId) {
        const r = find("routes", j.routeId);
        r.jobIds = r.jobIds.filter((id2) => id2 !== j.id);
        r.needsReview = true;
        j.routeId = null;
      }
      record("cancelled", { reason: txt(x.reason) });
      break;
    case "set_vehicle_availability": {
      const v = find("vehicles", x.vehicleId);
      if (typeof x.available !== "boolean") fail("Availability required", 400);
      v.available = x.available;
      break;
    }
    case "create_route": {
      const vehicle = find("vehicles", x.vehicleId), day = date(x.date), driverId = txt(x.driverId);
      if (!Array.isArray(x.jobIds) || !x.jobIds.length || x.jobIds.length > 50 || new Set(x.jobIds).size !== x.jobIds.length) fail("Choose unique jobs", 400);
      const jobs = x.jobIds.map((k) => find("jobs", k));
      if (jobs.some((j2) => j2.date !== day || !(j2.status === "unassigned" || j2.status === "assigned" && !j2.routeId && j2.driverId === driverId))) fail("Jobs must be unassigned on the route date");
      if (s.routes.some((r) => r.date === day && (r.vehicleId === vehicle.id || r.driverId === driverId))) fail("Driver or vehicle already assigned that day");
      const matrix = x.matrix || fixtureMatrix(jobs, at);
      if (Date.parse(matrix.asOf) > Date.parse(at) || Date.parse(at) - Date.parse(matrix.asOf) > 864e5 || !Number.isFinite(Date.parse(matrix.asOf))) fail("Travel matrix is stale or future dated");
      const planned = optimizeRoute(jobs, vehicle, matrix, { startMinute: number(x.startMinute, 1439), breakMinutes: number(x.breakMinutes, 180), dayLimit: number(x.dayLimit, 1440), order: x.order || null });
      if (!planned.feasible) fail(planned.errors.join("; "));
      s.routes.push({ id, driverId, vehicleId: vehicle.id, date: day, jobIds: jobs.map((j2) => j2.id), matrix, settings: { startMinute: x.startMinute, breakMinutes: x.breakMinutes, dayLimit: x.dayLimit }, plan: planned });
      jobs.forEach((j2) => {
        j2.driverId = driverId;
        j2.routeId = id;
        j2.status = "assigned";
        j2.version++;
      });
      break;
    }
    case "resequence_route": {
      const r = find("routes", x.routeId);
      if (r.jobIds.some((id2) => !["assigned", "unassigned"].includes(find("jobs", id2).status))) fail("Route already started");
      const p = planRoute(r.jobIds.map((id2) => find("jobs", id2)), find("vehicles", r.vehicleId), r.matrix, { ...r.settings, order: x.order });
      if (!p.feasible) fail(p.errors.join("; "));
      r.jobIds = [...x.order];
      r.plan = p;
      r.needsReview = false;
      break;
    }
    case "reassign_job": {
      const priorDriver = j.driverId;
      if (!["assigned", "exception"].includes(j.status)) fail("Only assigned/exception jobs may be reassigned");
      if (j.routeId) {
        const old = find("routes", j.routeId);
        old.jobIds = old.jobIds.filter((k) => k !== j.id);
        old.needsReview = true;
        j.routeId = null;
      }
      j.driverId = txt(x.driverId);
      j.status = "assigned";
      j.version++;
      record("reassigned", { driverId: j.driverId, previousDriverId: priorDriver });
      break;
    }
    case "start_job":
      if (s.jobs.some((v) => v.id !== j.id && v.driverId === actor && ["in_progress", "arrived"].includes(v.status))) fail("Complete or report an exception on the active job before starting another");
      if (j.routeId && find("routes", j.routeId).needsReview) fail("Route requires supervisor review");
      if (j.routeId && !find("vehicles", find("routes", j.routeId).vehicleId).available) fail("Assigned vehicle unavailable");
      if (j.status !== "assigned") fail("Job must be assigned");
      j.status = "in_progress";
      record("started");
      break;
    case "arrive_job":
      if (j.status !== "in_progress") fail("Start job before arrival");
      j.status = "arrived";
      record("arrived");
      break;
    case "scan_bin":
      if (j.status !== "arrived") fail("Arrive before scanning");
      {
        const barcode = txt(x.barcode).trim().toUpperCase();
        if (!/^DEMO-BIN-\d{4,10}$/.test(barcode)) fail("Fictional DEMO-BIN barcode required", 400);
        if (s.jobs.some((v) => v.bins.includes(barcode))) fail("Bin already recorded");
        if (j.bins.length >= j.containers) fail("Expected bin count exceeded");
        j.bins.push(barcode);
        record("bin_collected", { barcode });
      }
      break;
    case "complete_job":
      if (j.status !== "arrived" || j.bins.length !== j.containers) fail("All expected bins must be scanned");
      if (!/^demo-[a-z0-9-]+$/i.test(x.acknowledgment)) fail("Fictional customer acknowledgment required", 400);
      j.production = number(x.production, 1e5);
      if (!j.production) fail("Positive production required");
      j.acknowledgment = x.acknowledgment;
      j.status = "completed";
      record("completed", { bins: [...j.bins], production: j.production, acknowledgment: x.acknowledgment });
      break;
    case "job_exception":
      if (!["assigned", "in_progress", "arrived"].includes(j.status)) fail("Job cannot enter exception");
      j.status = "exception";
      j.exception = txt(x.reason);
      record("exception", { reason: j.exception });
      break;
    case "review_exception":
      if (j.status !== "exception") fail("No exception to review");
      j.review = { actor, reason: txt(x.reason), at };
      j.status = "assigned";
      j.bins = [];
      j.version++;
      record("exception_reviewed", j.review);
      break;
    case "authorize_demo_destruction":
      if (j.status !== "completed" || j.reviewRequired || j.authorization) fail("Completed unauthorized job required");
      j.authorization = { actor, at, reason: txt(x.reason) };
      record("sample_authorized", j.authorization);
      break;
    case "perform_demo_destruction":
      if (j.status !== "completed" || j.reviewRequired || !j.authorization || j.performed || j.authorization.actor === actor) fail("Separate authorization and performer required");
      j.performed = { actor, at, bins: [...j.bins] };
      record("sample_performed", j.performed);
      break;
    case "issue_certificate":
      if (j.status !== "completed" || !j.authorization || !j.performed || !await verifyFieldCustody(s.custody, hash)) fail("Completed authorized/performed job and valid custody chain required");
      if (s.certificates.some((c) => c.jobId === j.id && !c.voided)) fail("A current certificate already exists");
      s.certificates.push({ id, jobId: j.id, accountId: j.accountId, revision: s.certificates.filter((c) => c.jobId === j.id).length + 1, title: "SAMPLE / NOT PROOF OF DESTRUCTION", issuedAt: at, issuer: actor, custodyHead: s.custody.at(-1)?.hash || "genesis", bins: [...j.bins], production: j.production, voided: false });
      break;
    case "void_certificate": {
      const c = find("certificates", x.certificateId);
      if (c.voided) fail("Certificate already void");
      c.voided = true;
      c.voidReason = txt(x.reason);
      c.voidedAt = at;
      for (const b of s.batches.filter((b2) => ["draft", "failed"].includes(b2.status) && b2.certificateIds.includes(c.id))) {
        b.certificateIds = b.certificateIds.filter((id2) => id2 !== c.id);
        if (!b.certificateIds.length) b.status = "voided";
      }
      break;
    }
    case "set_delivery": {
      txt(x.accountId);
      if (!/^demo-[a-z0-9-]+$/i.test(x.recipient) || typeof x.consent !== "boolean") fail("Fictional recipient and consent required");
      txt(x.timezone);
      try {
        new Intl.DateTimeFormat("en", { timeZone: x.timezone }).format();
      } catch {
        fail("Invalid timezone", 400);
      }
      for (const b of s.batches.filter((b2) => b2.accountId === x.accountId && ["draft", "failed", "bounced"].includes(b2.status))) {
        if (b.recipient !== x.recipient || !x.consent) {
          b.status = "voided";
          b.history.push({ at, outcome: "consent_or_recipient_changed" });
        }
      }
      const setting = { accountId: x.accountId, recipient: x.recipient, timezone: x.timezone, consent: x.consent };
      s.delivery = s.delivery.filter((r) => r.accountId !== x.accountId).concat(setting);
      break;
    }
    case "batch_certificates": {
      for (const setting of s.delivery.filter((v) => v.consent)) {
        const parts = new Intl.DateTimeFormat("en", { timeZone: setting.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
        const value = (type) => parts.find((p) => p.type === type).value;
        const day = value("year") + "-" + value("month") + "-" + value("day");
        const certificates = s.certificates.filter((c) => c.accountId === setting.accountId && !c.voided && !s.batches.some((b) => b.status !== "voided" && b.certificateIds.includes(c.id)));
        const existing = s.batches.find((b) => b.accountId === setting.accountId && b.day === day && b.status !== "voided");
        if (existing) {
          if (existing.status === "draft") existing.certificateIds.push(...certificates.map((c) => c.id));
          continue;
        }
        if (certificates.length) s.batches.push({ id: id + "-" + s.batches.length, key: setting.accountId + ":" + day, day, accountId: setting.accountId, recipient: setting.recipient, certificateIds: certificates.map((c) => c.id), status: "draft", attempts: 0, nextAttemptAt: at, history: [] });
      }
      break;
    }
    case "review_batch": {
      const b = find("batches", x.batchId);
      if (b.status !== "failed" || b.attempts < 3) fail("Exhausted failed batch required");
      b.history.push({ at, outcome: "reviewed_retry", actor, reason: txt(x.reason) });
      b.attempts = 0;
      b.nextAttemptAt = at;
      break;
    }
    case "deliver_batch": {
      const b = find("batches", x.batchId);
      if (!["draft", "failed"].includes(b.status) || b.attempts >= 3 || b.nextAttemptAt > at) fail("Batch not eligible for retry");
      if (b.certificateIds.some((id2) => find("certificates", id2).voided)) fail("Batch contains a voided certificate");
      const setting = s.delivery.find((d) => d.accountId === b.accountId);
      if (!setting?.consent || setting.recipient !== b.recipient) fail("Recipient consent changed");
      if (!["success", "failure", "bounce"].includes(x.outcome)) fail("Invalid simulated delivery outcome", 400);
      b.attempts++;
      b.history.push({ at, outcome: x.outcome });
      b.status = x.outcome === "success" ? "simulated_sent" : x.outcome === "bounce" ? "bounced" : "failed";
      b.nextAttemptAt = new Date(Date.parse(at) + 6e4 * 2 ** b.attempts).toISOString();
      break;
    }
    case "telemetry": {
      const v = find("vehicles", x.vehicleId);
      const timestamp = new Date(x.timestamp).toISOString();
      if (Date.parse(timestamp) > Date.parse(at) + 3e5 || !Number.isFinite(x.latitude) || Math.abs(x.latitude) > 90 || !Number.isFinite(x.longitude) || Math.abs(x.longitude) > 180) fail("Invalid telemetry");
      const old = s.telemetry.find((t) => t.vehicleId === v.id);
      if (old && x.odometer < old.odometer) fail("Odometer cannot move backward");
      if (old && timestamp <= old.timestamp) fail("Out-of-order telemetry rejected");
      s.telemetry = s.telemetry.filter((t) => t.vehicleId !== v.id).concat({ vehicleId: v.id, synthetic: true, timestamp, latitude: x.latitude, longitude: x.longitude, odometer: number(x.odometer), diagnostic: txt(x.diagnostic), camera: "simulated unavailable", eld: "NOT AN APPROVED ELD" });
      break;
    }
    case "navigation": {
      const r = find("routes", x.routeId);
      if (r.needsReview) fail("Route requires review");
      s.navigation.push({ id, routeId: r.id, actor, at, status: "simulated_handoff", uri: null, restrictionsChecked: r.plan.feasible, notice: "No road-safe navigation provider configured" });
      break;
    }
    case "request_export": {
      s.exports.push({ id, status: "pending", offset: 0, rows: [], source: s.jobs.map((j2) => ({ id: j2.id, status: j2.status, date: j2.date, driverId: j2.driverId, production: j2.production })), asOf: at });
      break;
    }
    case "advance_export": {
      const e = find("exports", x.exportId);
      if (e.status === "complete") fail("Export complete");
      e.rows.push(...e.source.slice(e.offset, e.offset + 100));
      e.offset = e.rows.length;
      e.status = e.offset >= e.source.length ? "complete" : "processing";
      break;
    }
  }
  if (DRIVER_ACTIONS.includes(command.type)) j.version++;
  if (event) s.custody.push({ ...event, hash: await digest(event, hash) });
  s.version++;
  s.receipts.push({ clientEventId: id, actor, fingerprint });
  if (s.jobs.length > 2e3 || encodedLength(JSON.stringify(s)) > 18e5) fail("Synthetic field workspace limit reached", 413);
  return { state: s, status: "accepted" };
}
export {
  DRIVER_ACTIONS,
  MANAGER_ACTIONS,
  applyField,
  demoJobs,
  seedDriverField,
  seedField,
  verifyFieldCustody
};
