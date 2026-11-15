import { seedCommercial, applyCommercial, invoiceBalance } from "../packages/commercial/workflows.js";
import { ACTIONS } from "../packages/commercial/actions.js";
import { csvCell } from "../packages/reports/report.js";
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (x) => "$" + (x / 100).toFixed(2);
function createCommercialView({ remote, storage = localStorage, onDownload } = {}) {
  let tenant = "c2", mode = "local", section = "accounts", action = "create_account", state = null, notice = "", busy = false, revision = remote.revision, pending = null;
  const key = () => "irm-commercial-" + tenant;
  function local() {
    try {
      const v = JSON.parse(storage.getItem(key()));
      if (v?.synthetic && v.customerId === tenant) return v;
    } catch {
    }
    return seedCommercial(tenant);
  }
  const label = (r) => r.name || r.title || r.reference || r.entityId || r.id;
  function field([name, title, type, value]) {
    const base = type.replace(/[?*]/g, "");
    let input;
    if (state && Array.isArray(state[base])) {
      const rows = state[base];
      input = '<select class="field" id="co-' + name + '" ' + (type.endsWith("*") ? 'multiple size="5"' : "") + ">" + (type.endsWith("?") ? '<option value="">No agreement</option>' : "") + rows.map((r) => '<option value="' + esc(r.id) + '">' + esc(label(r)) + " \xB7 " + esc(r.status || r.stage || r.date || r.id) + "</option>").join("") + "</select>";
    } else if (type === "textarea") input = '<textarea class="field" id="co-' + name + '" rows="8"></textarea>';
    else if (type === "choice") input = '<select class="field" id="co-' + name + '">' + value.split("|").map((v) => "<option>" + esc(v) + "</option>").join("") + "</select>";
    else input = '<input class="field" id="co-' + name + '" type="' + (base === "money" || base === "percent" ? "text" : base === "date" ? "date" : base === "time" ? "time" : base === "number" ? "number" : "text") + '" value="' + esc(value || "") + '">';
    return '<label><span class="label">' + esc(title) + "</span>" + input + "</label>";
  }
  function table(name, columns) {
    const rows = state?.[name] || [];
    return "<h3>" + esc(name) + '</h3><div class="table-wrap"><table><thead><tr>' + columns.map((c) => "<th>" + esc(c.replace(/([A-Z])/g, " $1").replace(/^id$/, "Reference")) + "</th>").join("") + "</tr></thead><tbody>" + rows.slice(-100).map((r) => "<tr>" + columns.map((c) => "<td>" + esc(c === "overdueDays" ? r.status === "issued" && invoiceBalance(state, r).dueCents > 0 ? Math.max(0, Math.floor((Date.parse((/* @__PURE__ */ new Date()).toISOString().slice(0, 10)) - Date.parse(r.due)) / 864e5)) : 0 : c === "balance" ? money(invoiceBalance(state, r).dueCents) : c === "total" ? money(r.totalCents ?? r.price?.totalCents ?? 0) : typeof r[c] === "object" ? JSON.stringify(r[c]) : r[c]) + "</td>").join("") + "</tr>").join("") + '</tbody></table></div><p class="muted">' + rows.length + " total; latest 100 shown. Export includes all rows.</p>";
  }
  function html() {
    if (revision !== remote.revision) {
      revision = remote.revision;
      pending = null;
      if (mode === "api") {
        state = null;
        notice = "Connection changed. Reload the workspace.";
      }
    }
    if (mode === "local" && !state) state = local();
    const spec = ACTIONS[section].find((a) => a[0] === action) || ACTIONS[section][0];
    action = spec[0];
    const groups = { accounts: [["imports", ["id", "contract", "accepted", "matched", "conflicts", "rejected"]], ["accounts", ["id", "name", "stage", "archived", "billingLocationId", "billingContactId", "lossReason"]], ["locations", ["id", "accountId", "name", "address", "timezone", "windowStart", "windowEnd"]], ["contacts", ["accountId", "name", "alias", "archived"]], ["activities", ["accountId", "note", "actor", "at"]], ["tasks", ["id", "title", "assignee", "due", "status"]]], sales: [["agreements", ["id", "accountId", "locationIds", "revision", "status", "start", "end", "renewal", "terms", "total", "revisions"]], ["estimates", ["id", "accountId", "locationId", "service", "mode", "unit", "revision", "status", "total", "revisions"]]], schedule: [["plans", ["id", "estimateId", "start", "end", "intervalDays", "exceptions"]], ["jobs", ["id", "accountId", "locationId", "date", "status", "invoiceId", "total"]]], billing: [["invoices", ["id", "accountId", "from", "to", "due", "status", "total", "balance", "overdueDays", "billTo", "lines", "credits"]], ["payments", ["id", "invoiceId", "amountCents", "refundedCents", "status"]]], integrations: [["outbox", ["id", "provider", "kind", "entityId", "status", "attempts", "nextAttemptAt", "error", "externalId", "reconciliation"]], ["events", ["action", "actor", "at"]]] };
    return '<div class="card stack"><h2>Commercial office \xB7 synthetic</h2><p>No real contacts, signatures, charges, refunds or accounting writes. Use fictional information. Simulated provider states are not proof of delivery.</p><div class="actions"><label>Workspace<select id="co-tenant">' + ["c1", "c2", "c3", "c4"].map((x) => "<option " + (x === tenant ? "selected" : "") + ">" + x + "</option>").join("") + '</select></label><label>Connection<select id="co-mode"><option value="local" ' + (mode === "local" ? "selected" : "") + '>Local demonstration</option><option value="api" ' + (mode === "api" ? "selected" : "") + '>Verified local API</option></select></label><button id="co-load">Reload workspace</button><button id="co-export">Export current section CSV</button></div><div class="actions">' + Object.keys(ACTIONS).map((k) => '<button data-co-section="' + k + '" class="' + (k === section ? "primary" : "secondary") + '">' + esc(k) + "</button>").join("") + '</div><p role="status">' + esc(notice) + '</p><label>Action<select class="field" id="co-action">' + ACTIONS[section].map((a) => '<option value="' + a[0] + '" ' + (a[0] === action ? "selected" : "") + ">" + a[1] + "</option>").join("") + "</select></label>" + spec[2].map(field).join("") + '<button id="co-save" class="primary" ' + (!state || busy ? "disabled" : "") + ">" + esc(spec[1]) + '</button><p class="muted">Services use location-local dates and time windows, including across daylight-saving changes. Price units are whole containers, pounds, hours or fixed units. Dollar inputs accept two decimals; percentages accept two decimals.</p>' + groups[section].map(([name, cols]) => table(name, cols)).join("") + "</div>";
  }
  async function run(render, work) {
    if (busy) return;
    busy = true;
    const current = remote.revision;
    try {
      await work();
      if (mode === "api" && current !== remote.revision) {
        state = null;
        notice = "Connection changed; reload.";
      }
    } catch (e) {
      if (e.status && e.status < 500 && e.status !== 429) pending = null;
      notice = e.message + (pending ? " \xB7 Retry this action unchanged to reuse the same request." : "");
    } finally {
      busy = false;
      render();
    }
  }
  function bind(root, render) {
    for (const [selector, update] of [["tenant", (v) => {
      tenant = v;
      state = null;
      pending = null;
    }], ["mode", (v) => {
      mode = v;
      state = null;
      pending = null;
    }], ["action", (v) => {
      action = v;
    }]]) root.querySelector("#co-" + selector).onchange = (e) => {
      if (busy) {
        render();
        return;
      }
      update(e.target.value);
      render();
    };
    root.querySelectorAll("[data-co-section]").forEach((b) => b.onclick = () => {
      if (busy) return;
      section = b.dataset.coSection;
      action = ACTIONS[section][0][0];
      render();
    });
    root.querySelector("#co-load").onclick = () => run(render, async () => {
      state = mode === "local" ? local() : await remote.getCommercialWorkspace(tenant);
      pending = null;
      notice = "Workspace loaded. Review recent activity before repeating an uncertain request.";
    });
    root.querySelector("#co-save").onclick = () => run(render, async () => {
      const input = {};
      for (const [name, , type] of ACTIONS[section].find((a) => a[0] === action)[2]) {
        const el = root.querySelector("#co-" + name);
        if (type.endsWith("*")) input[name] = [...el.selectedOptions].map((o) => o.value);
        else if (type === "money" || type === "percent") {
          if (!/^\d{1,8}(\.\d{1,2})?$/.test(el.value)) throw Error("Enter a nonnegative amount with up to two decimals");
          const [whole, fraction = ""] = el.value.split(".");
          input[name] = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
        } else input[name] = type === "number" ? Number(el.value) : el.value.trim();
      }
      const fingerprint = JSON.stringify({ type: action, input, tenant });
      if (pending && pending.fingerprint !== fingerprint) throw Error("Retry the pending action unchanged, or reload and review activity before entering another action");
      const command = pending?.command || { id: "demo-" + crypto.randomUUID(), type: action, input, expectedVersion: state.version };
      pending = { fingerprint, command };
      if (mode === "local") {
        const latest = local();
        const result = applyCommercial(latest, command);
        storage.setItem(key(), JSON.stringify(result.state));
        state = result.state;
      } else {
        const result = await remote.commercialCommand({ customerId: tenant, command });
        state = result.workspace;
      }
      pending = null;
      notice = "Saved in the synthetic workspace.";
    });
    root.querySelector("#co-export").onclick = () => {
      if (!state) return;
      const names = { accounts: ["imports", "accounts", "locations", "contacts", "activities", "tasks"], sales: ["agreements", "estimates"], schedule: ["plans", "jobs"], billing: ["invoices", "payments"], integrations: ["outbox", "events"] }[section];
      const lines = [["Collection", "Synthetic record (JSON)"], ...names.flatMap((name) => (state[name] || []).map((row) => [name, JSON.stringify(row)]))];
      const content = "\uFEFF" + lines.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
      if (onDownload) onDownload(content);
      else {
        const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "irm-synthetic-" + section + ".csv";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1e3);
      }
    };
  }
  return { html, bind };
}
export {
  createCommercialView
};
