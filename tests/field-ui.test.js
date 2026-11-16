import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createFieldView } from "../src/field-view.js";
import { seedField, demoJobs } from "../packages/field/workflows.js";
function harness(remote = { revision: 1 }) {
  const map = /* @__PURE__ */ new Map(), storage = { getItem: (k) => map.get(k) || null, setItem: (k, v) => map.set(k, v) }, view = createFieldView({ remote, storage }), root = new JSDOM("<main></main>").window.document.querySelector("main");
  function render() {
    root.innerHTML = view.html();
    view.bind(root, render);
  }
  render();
  return { root, storage, render };
}
test("dispatch screen persists route and driver execution and escapes printable output", async () => {
  const { root, storage } = harness();
  await root.querySelector("#fi-save").onclick();
  function action(type) {
    root.querySelector("#fi-action").onchange({ target: { value: type } });
  }
  action("add_vehicle");
  root.querySelector("#fi-name").value = "Demo truck";
  await root.querySelector("#fi-save").onclick();
  action("create_route");
  for (const o of root.querySelector("#fi-jobIds").options) o.selected = true;
  await root.querySelector("#fi-save").onclick();
  assert.equal(JSON.parse(storage.getItem("irm-field-c2")).routes.length, 1);
  action("start_job");
  await root.querySelector("#fi-save").onclick();
  assert.match(root.textContent, /in_progress/);
  const s = JSON.parse(storage.getItem("irm-field-c2"));
  s.jobs[0].name = "Demo \u65E5\u672C\u8A9E <script>";
  storage.setItem("irm-field-c2", JSON.stringify(s));
  await root.querySelector("#fi-load").onclick();
  assert.equal(root.querySelector("script"), null);
  assert.match(root.textContent, /日本語 <script>/);
  root.querySelector("#fi-tenant").onchange({ target: { value: "c3" } });
  assert.doesNotMatch(root.textContent, /日本語/);
});
test("dispatch screen loads linked jobs, routes, certificates and batches for complete local testing",async()=>{
 const {root,storage}=harness();await root.querySelector("#fi-fill-sample").onclick();
 const field=JSON.parse(storage.getItem("irm-field-c2")),commercial=JSON.parse(storage.getItem("irm-commercial-c2"));
 assert.equal(field.jobs.length,4);assert.equal(field.vehicles.length,2);assert.equal(field.routes.length,1);assert.equal(field.certificates.length,1);assert.equal(field.batches.length,1);
 assert.equal(commercial.accounts.length,5);assert.equal(commercial.invoices.length,4);assert.equal(JSON.parse(storage.getItem("irm-warehouse-c2")).records.length,17);
 assert.match(root.textContent,/1 sample certificate, 1 delivery batch and 17 warehouse records/);
 assert.match(root.textContent,/SAMPLE \/ NOT PROOF OF DESTRUCTION/);assert.match(root.textContent,/simulated_sent|draft/);
});
test("dispatch sample loader repairs a prior install missing warehouse data without replacing edits",async()=>{
 const {root,storage}=harness();storage.setItem("irm-sample-loaded-irm-full-sample-v3-c2","loaded");const existing=seedField("c2");existing.jobs=[{...demoJobs("c2")[0],id:"kept",name:"Kept job"}];storage.setItem("irm-field-c2",JSON.stringify(existing));
 await root.querySelector("#fi-fill-sample").onclick();assert.equal(JSON.parse(storage.getItem("irm-field-c2")).jobs[0].name,"Kept job");assert.equal(JSON.parse(storage.getItem("irm-warehouse-c2")).records.length,17);assert.match(root.textContent,/existing Commercial and Dispatch data was preserved/);
});
test("verified manager can install the linked sample from dispatch and sees the persisted field workspace",async()=>{
 const calls=[],sample={...seedField("c2"),jobs:demoJobs("c2")},remote={revision:1,connected:true,user:{id:"manager",role:"manager"},installOperationsSample:async input=>calls.push(input),getFieldWorkspace:async()=>sample,getFieldDrivers:async()=>({items:[]})};
 const {root}=harness(remote);root.querySelector("#fi-mode").onchange({target:{value:"api"}});await root.querySelector("#fi-fill-sample").onclick();
 assert.equal(calls.length,1);assert.deepEqual(calls[0],{customerId:"c2",datasetVersion:"irm-full-sample-v3"});assert.match(root.textContent,/Demo stop/);
});
test("driver scope and session change clear cached field details and hide manager actions", async () => {
  const s = seedField("c2");
  s.jobs = demoJobs("c2");
  const remote = { revision: 1, user: { role: "warehouse" }, getFieldWorkspace: async () => s };
  const { root, render } = harness(remote);
  root.querySelector("#fi-mode").onchange({ target: { value: "api" } });
  assert.equal(root.querySelector("#fi-save").disabled, true);
  await root.querySelector("#fi-load").onclick();
  assert.match(root.textContent, /Demo stop/);
  assert.equal([...root.querySelector("#fi-action").options].some((o) => o.value === "issue_certificate"), false);
  remote.revision++;
  render();
  assert.doesNotMatch(root.textContent, /Demo stop/);
  assert.equal(root.querySelector("#fi-save").disabled, true);
});
