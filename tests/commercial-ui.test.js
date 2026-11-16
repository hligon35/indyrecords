import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCommercialView } from "../src/commercial-view.js";
import { seedCommercial } from "../packages/commercial/workflows.js";
function ui(remote = { revision: 1 }) {
  const memory = /* @__PURE__ */ new Map();
  const storage = { getItem: (k) => memory.get(k) || null, setItem: (k, v) => memory.set(k, v) };
  const view = createCommercialView({ remote, storage });
  const root = new JSDOM("<main></main>").window.document.querySelector("main");
  function render() {
    root.innerHTML = view.html();
    view.bind(root, render);
  }
  render();
  return { root, render, storage };
}
test("commercial UI persists prospects, converts them and preserves tenant isolation after reload", async () => {
  const { root, storage } = ui();
  root.querySelector("#co-name").value = "<Demo Legal>";
  await root.querySelector("#co-save").onclick();
  assert.equal(root.querySelector("Demo"), null);
  assert.match(root.textContent, /<Demo Legal>/);
  root.querySelector("#co-action").onchange({ target: { value: "convert_account" } });
  await root.querySelector("#co-save").onclick();
  const state = JSON.parse(storage.getItem("irm-commercial-c2"));
  assert.equal(state.accounts[0].stage, "customer");
  await root.querySelector("#co-load").onclick();
  root.querySelector("#co-tenant").onchange({ target: { value: "c3" } });
  assert.doesNotMatch(root.textContent, /<Demo Legal>/);
});
test("commercial screen loads the complete linked feature sample into both local workspaces without replacing data",async()=>{
 const {root,storage}=ui();await root.querySelector("#co-fill-sample").onclick();
 const commercial=JSON.parse(storage.getItem("irm-commercial-c2")),field=JSON.parse(storage.getItem("irm-field-c2"));
 assert.equal(commercial.accounts.length,5);assert.equal(commercial.jobs.length,8);assert.equal(commercial.invoices.length,4);
 assert.equal(field.jobs.length,4);assert.equal(field.certificates.length,1);assert.equal(field.batches.length,1);
 assert.match(root.textContent,/Loaded 5 customer accounts, 8 service jobs, 4 invoices, 4 driver jobs/);
 await root.querySelector("#co-fill-sample").onclick();assert.equal(JSON.parse(storage.getItem("irm-commercial-c2")).accounts.length,5);
});
test("API commercial screen clears financial state after session change and never submits with no workspace", async () => {
  const remote = { revision: 1, getCommercialWorkspace: async () => ({ ...seedCommercial("c2"), accounts: [{ id: "demo-sensitive", name: "Demo Secret", stage: "customer" }] }) };
  const { root, render } = ui(remote);
  root.querySelector("#co-mode").onchange({ target: { value: "api" } });
  assert.equal(root.querySelector("#co-save").disabled, true);
  await root.querySelector("#co-load").onclick();
  assert.match(root.textContent, /Demo Secret/);
  remote.revision++;
  render();
  assert.doesNotMatch(root.textContent, /Demo Secret/);
  assert.equal(root.querySelector("#co-save").disabled, true);
});
test("commercial UI retains the same idempotency key after an uncertain delivery", async () => {
  const calls = [];
  const remote = { revision: 1, getCommercialWorkspace: async () => seedCommercial("c2"), commercialCommand: async (x) => {
    calls.push(x.command);
    if (calls.length === 1) throw Error("Connection lost");
    return { workspace: { ...seedCommercial("c2"), version: 1 } };
  } };
  const { root } = ui(remote);
  root.querySelector("#co-mode").onchange({ target: { value: "api" } });
  await root.querySelector("#co-load").onclick();
  root.querySelector("#co-name").value = "Demo retry";
  await root.querySelector("#co-save").onclick();
  root.querySelector("#co-name").value = "Demo retry";
  await root.querySelector("#co-save").onclick();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
});
