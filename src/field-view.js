import { seedField, applyField, DRIVER_ACTIONS } from "../packages/field/workflows.js";
import { FIELD_ACTIONS } from "../packages/field/actions.js";
import { fieldDashboard, exportCsv, unicodeReport, officeDashboard } from "../packages/field/reports.js";
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function createFieldView({ remote, storage = localStorage, onDownload } = {}) {
  let tenant = "c2", mode = "local", state = null, action = "demo_jobs", busy = false, notice = "", revision = remote.revision, pending = null, office = null, drivers = [{ id: "local-demo-driver", name: "Demo driver" }];
  const key = () => "irm-field-" + tenant;
  function local() {
    try {
      return JSON.parse(storage.getItem(key())) || seedField(tenant);
    } catch {
      return seedField(tenant);
    }
  }
  const allowed = () => mode === "api" && remote.user?.role === "warehouse" ? FIELD_ACTIONS.filter((a) => DRIVER_ACTIONS.includes(a[0])) : FIELD_ACTIONS;
  function field([name, label, type, value]) {
    const base = type.replace("*", ""), rows = base === "drivers" ? drivers : state?.[base];
    let el;
    if (Array.isArray(rows)) el = '<select class="field" id="fi-' + name + '" ' + (type.endsWith("*") ? 'multiple size="5"' : "") + ">" + rows.map((v) => '<option value="' + esc(v.id) + '">' + esc(v.name || v.jobId || v.id) + " \xB7 " + esc(v.status || v.date || v.id) + "</option>").join("") + "</select>";
    else if (type === "boolean" || type === "choice") {
      const options = type === "boolean" ? ["true", "false"] : value.split("|");
      el = '<select id="fi-' + name + '">' + options.map((v) => "<option value=\""+v+"\">" + (type === "boolean"?(v==="true"?"Yes":"No"):v) + "</option>").join("") + "</select>";
    } else el = '<input class="field" id="fi-' + name + '" type="' + (type === "number" ? "number" : type === "date" ? "date" : type === "time" ? "time" : "text") + '" value="' + esc(value || (name === "timestamp" ? (/* @__PURE__ */ new Date()).toISOString() : "")) + '">';
    return '<label><span class="label">' + esc(label) + "</span>" + el + "</label>";
  }
  const cards = (name, render) => "<h3>" + name + "</h3>" + (state?.[name] || []).slice(-100).map(render).join("");
  function html() {
    if (revision !== remote.revision) {
      revision = remote.revision;
      pending = null;
      office = null;
      if (mode === "api") {
        state = null;
        drivers = [];
        notice = "Connection changed; reload.";
      }
    }
    if (mode === "local" && !state) state = local();
    if (!allowed().some((a) => a[0] === action)) action = allowed()[0][0];
    if (mode === "local") {
      try {
        office = officeDashboard(JSON.parse(storage.getItem("irm-commercial-" + tenant) || "null"));
      } catch {
        office = null;
      }
    }
    const spec = allowed().find((a) => a[0] === action), d = state ? fieldDashboard(state) : null;
    return '<div class="card stack"><h2>Dispatch & driver operations \xB7 SYNTHETIC</h2><p>Fictional matrix; not road-safe truck navigation. Fleet telemetry, camera streaming, ELD and deliveries are simulations. Certificates are SAMPLE / NOT PROOF OF DESTRUCTION.</p><label>Workspace<select id="fi-tenant">' + ["c1", "c2", "c3", "c4"].map((c) => "<option " + (c === tenant ? "selected" : "") + ">" + c + "</option>").join("") + '</select></label><label>Connection<select id="fi-mode"><option value="local" ' + (mode === "local" ? "selected" : "") + '>Local demonstration</option><option value="api" ' + (mode === "api" ? "selected" : "") + '>Verified local API</option></select></label><button id="fi-load">Reload workspace</button><button id="fi-report">Unicode printable report</button><p role="status">' + esc(notice) + "</p>" + (d ? "<p>Jobs " + d.jobs + " \xB7 Production " + d.production + " \xB7 Exceptions " + d.exceptions.length + " \xB7 Estimated overtime " + d.overtimeMinutes + " min</p>" + d.telemetry.map((t) => "<p>" + esc(t.vehicleId) + " \xB7 " + esc(t.status) + "</p>").join("") : "") + (office ? "<p>Commercial: " + office.customers + " customers \xB7 " + office.prospects + " prospects \xB7 Estimates accepted " + office.acceptedEstimates + "/" + office.estimates + " \xB7 Receivables USD " + (office.receivableCents / 100).toFixed(2) + " \xB7 Overdue USD " + (office.overdueCents / 100).toFixed(2) + " \xB7 Provider failures " + office.providerFailures + " \xB7 Reconciliation conflicts " + office.reconciliationConflicts + "</p>" : "") + '<label>Action<select class="field" id="fi-action">' + allowed().map((a) => '<option value="' + a[0] + '" ' + (a[0] === action ? "selected" : "") + ">" + esc(a[1]) + "</option>").join("") + "</select></label>" + spec[2].map(field).join("") + '<button id="fi-save" class="primary" ' + (!state || busy ? "disabled" : "") + ">" + esc(spec[1]) + "</button>" + cards("jobs", (j) => "<p><strong>" + esc(j.name) + "</strong> \xB7 " + esc(j.address) + " \xB7 " + esc(j.timezone) + " \xB7 " + esc(j.date) + " \xB7 " + esc(j.status) + " \xB7 Driver " + esc(j.driverId || "Unassigned") + " \xB7 Bins " + j.bins.length + "/" + j.containers + " \xB7 Production " + j.production + "<br>Reference " + esc(j.id) + "</p>") + cards("vehicles", (v) => "<p>" + esc(v.name) + " \xB7 " + (v.available ? "Available" : "Unavailable") + " \xB7 Capacity " + v.capacity + " \xB7 Reference " + esc(v.id) + "</p>") + cards("routes", (r) => "<p>" + esc(r.date) + " \xB7 " + esc(r.driverId) + " \xB7 Travel " + r.plan.travelMinutes + " / service " + r.plan.serviceMinutes + " / waiting " + r.plan.waitingMinutes + " / break " + r.plan.breakMinutes + " min \xB7 Overtime " + r.plan.overtimeMinutes + " \xB7 " + (r.needsReview ? "REVIEW REQUIRED" : "Synthetic plan") + " \xB7 Matrix " + esc(r.plan.matrixAsOf) + "<br>Stops " + r.plan.stops.map((j) => esc(j.jobId)).join(" \u2192 ") + "</p>") + cards("certificates", (c) => "<p>" + esc(c.title) + " \xB7 Revision " + c.revision + " \xB7 " + (c.voided ? "VOID" : "Sample current") + ' <button data-fi-certificate="' + esc(c.id) + '">Download sample</button></p>') + cards("batches", (b) => "<p>" + esc(b.day) + " \xB7 " + esc(b.recipient) + " \xB7 " + esc(b.status) + " \xB7 Attempts " + b.attempts + " \xB7 Retry " + esc(b.nextAttemptAt) + "</p>") + cards("telemetry", (t) => "<p>" + esc(t.vehicleId) + " \xB7 " + esc(t.timestamp) + " \xB7 Synthetic GPS " + esc(t.latitude) + ", " + esc(t.longitude) + " \xB7 Odometer " + t.odometer + " \xB7 " + esc(t.diagnostic) + " \xB7 Fleet camera " + esc(t.camera) + " \xB7 " + esc(t.eld) + "</p>") + cards("exports", (e) => "<p>" + esc(e.id) + " \xB7 " + esc(e.status) + " \xB7 " + e.offset + " rows " + (e.status === "complete" ? '<button data-fi-export="' + esc(e.id) + '">Download CSV</button>' : "") + "</p>") + "</div>";
  }
  function download(content, name, type) {
    if (onDownload) {
      onDownload(content, name);
      return;
    }
    const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
  async function run(render, work) {
    if (busy) return;
    busy = true;
    const current = remote.revision;
    try {
      await work();
    } catch (e) {
      if (e.status === 401 || e.status === 403) office = null;
      if (e.status && e.status < 500 && e.status !== 429) pending = null;
      notice = e.message;
    } finally {
      busy = false;
      if (mode === "api" && current !== remote.revision) {
        state = null;
        pending = null;
        notice = "Connection changed; reload.";
      }
      render();
    }
  }
  function bind(root, render) {
    for (const [id, update] of [["tenant", (v) => {
      tenant = v;
      drivers = mode === "local" ? [{ id: "local-demo-driver", name: "Demo driver" }] : [];
      state = null;
      pending = null;
      office = null;
    }], ["mode", (v) => {
      mode = v;
      office = null;
      state = null;
      pending = null;
      drivers = v === "local" ? [{ id: "local-demo-driver", name: "Demo driver" }] : [];
    }], ["action", (v) => action = v]]) root.querySelector("#fi-" + id).onchange = (e) => {
      if (busy) {
        render();
        return;
      }
      update(e.target.value);
      render();
    };
    root.querySelector("#fi-load").onclick = () => run(render, async () => {
      office = null;
      state = mode === "local" ? local() : await remote.getFieldWorkspace(tenant);
      if (mode === "api" && remote.user?.role !== "warehouse") drivers = (await remote.getFieldDrivers(tenant)).items;
      office = null;
      if (mode === "api" && ["manager", "admin"].includes(remote.user?.role)) {
        try {
          office = officeDashboard(await remote.getCommercialWorkspace(tenant));
        } catch {
          office = null;
        }
      }
      pending = null;
      notice = "Loaded; review before repeating uncertain requests.";
    });
    root.querySelector("#fi-report").onclick = () => {
      if (state) download(unicodeReport(state), "SAMPLE-field-report.html", "text/html;charset=utf-8");
    };
    root.querySelectorAll("[data-fi-certificate]").forEach((b) => b.onclick = () => download(unicodeReport(state, b.dataset.fiCertificate), "SAMPLE-certificate.html", "text/html;charset=utf-8"));
    root.querySelectorAll("[data-fi-export]").forEach((b) => b.onclick = () => download(exportCsv(state.exports.find((e) => e.id === b.dataset.fiExport)), "synthetic-field.csv", "text/csv;charset=utf-8"));
    root.querySelector("#fi-save").onclick = () => run(render, async () => {
      const x = {};
      for (const [name, , type] of FIELD_ACTIONS.find((a) => a[0] === action)[2]) {
        const el = root.querySelector("#fi-" + name);
        x[name] = type.endsWith("*") ? [...el.selectedOptions].map((o) => o.value) : type === "time" ? Number(el.value.split(":")[0])*60+Number(el.value.split(":")[1]) : type === "number" || type === "decimal" ? Number(el.value) : type === "boolean" ? el.value === "true" : type === "list" ? el.value.split(",").map((v) => v.trim()) : el.value.trim();
      }
      const j = state.jobs.find((j2) => j2.id === x.jobId), fingerprint = JSON.stringify({ action, x, tenant });
      if (pending && pending.fingerprint !== fingerprint) throw Error("Retry unchanged or reload and review activity");
      const command = pending?.command || { clientEventId: "demo-" + crypto.randomUUID(), type: action, input: x, expectedVersion: state.version, ...DRIVER_ACTIONS.includes(action) ? { expectedJobVersion: j?.version } : {} };
      pending = { fingerprint, command };
      if (mode === "api") {
        if (action === "handoff_billing") await remote.fieldBilling({ customerId: tenant, command });
        else state = (await remote.fieldCommand({ customerId: tenant, command })).workspace;
      } else {
        if (action === "handoff_billing") throw Error("Billing handoff requires verified local API");
        if (action === "import_jobs") {
          const c = JSON.parse(storage.getItem("irm-commercial-" + tenant) || "null");
          command.input = { jobs: (c?.jobs || []).filter((j2) => j2.status === "scheduled").map((j2) => {
            const l = c.locations.find((l2) => l2.id === j2.locationId);
            return { ...j2, name: l.name, address: l.address, timezone: l.timezone, containers: c.estimates.find((e) => e.id === j2.estimateId)?.unit === "container" ? j2.price.quantity : 2, windowStart: l.windowStart, windowEnd: l.windowEnd };
          }) };
        }
        const r = await applyField(local(), command, DRIVER_ACTIONS.includes(action) ? j?.driverId : "local-demo-manager");
        state = r.state;
        storage.setItem(key(), JSON.stringify(state));
      }
      pending = null;
      notice = "Saved synthetic event.";
    });
  }
  return { html, bind };
}
export {
  createFieldView
};
