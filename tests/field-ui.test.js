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
