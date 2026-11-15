import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOfflineFieldStore as createOfflineWarehouseStore } from "../packages/field/offline-store.js";
import { seedDriverField } from "../packages/field/workflows.js";
import { createSyncCoordinator } from "../packages/api-client/sync.js";
function factory(file, handles) {
  return createOfflineWarehouseStore({ openDatabase: async () => {
    const db = new DatabaseSync(file);
    handles.push(db);
    const adapter = { execAsync: async (sql) => db.exec(sql), getFirstAsync: async (sql, ...args) => db.prepare(sql).get(...args), getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args), runAsync: async (sql, ...args) => {
      const result = db.prepare(sql).run(...args);
      return { changes: Number(result.changes) };
    }, async withExclusiveTransactionAsync(callback) {
      db.exec("BEGIN IMMEDIATE");
      try {
        await callback(adapter);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } };
    return adapter;
  } });
}
test("driver SQLite queue survives restart, recovers interrupted sends and keeps each owner isolated", async () => {
  const folder = mkdtempSync(join(tmpdir(), "irm-offline-field-")), handles = [], file = join(folder, "queue.db");
  try {
    let store = factory(file, handles);
    const actor = "local-demo-driver", jobId = "demo-field-job-1";
    await store.stageCommand(actor, "c2", { type: "start_job", clientEventId: "demo-start", input: { jobId }, expectedJobVersion: 0 });
    await store.stageCommand(actor, "c2", { type: "arrive_job", clientEventId: "demo-arrive", input: { jobId }, expectedJobVersion: 1 });
    let queue = await store.workflowRepository(actor, "c2").read();
    queue[0].status = "sending";
    await store.workflowRepository(actor, "c2").write(queue);
    assert.equal((await store.workflowRepository("other", "c2").read()).length, 0);
    for (const d of handles.splice(0)) d.close();
    store = factory(file, handles);
    assert.equal((await store.loadWorkspace(actor, "c2")).jobs[0].status, "arrived");
    await createSyncCoordinator({ repository: store.workflowRepository(actor, "c2"), api: store.syntheticWorkflowReceiver() }).synchronize();
    assert.ok((await store.workflowRepository(actor, "c2").read()).every((e) => e.status === "confirmed"));
    assert.equal((await createSyncCoordinator({ repository: store.workflowRepository(actor, "c2"), api: store.syntheticWorkflowReceiver() }).synchronize()).processed, 0);
  } finally {
    for (const d of handles) d.close();
    assert.ok(folder.startsWith(join(tmpdir(), "irm-offline-field-")));
    rmSync(folder, { recursive: true, force: true });
  }
});
test("driver conflict review preserves original evidence and atomic replacement while pending work blocks refresh", async () => {
  const handles = [], store = factory(":memory:", handles), actor = "local-demo-driver", jobId = "demo-field-job-1";
  try {
    await store.stageCommand(actor, "c2", { type: "start_job", clientEventId: "demo-original", input: { jobId }, expectedJobVersion: 0 });
    await assert.rejects(store.cacheWorkspace(actor, "c2", seedDriverField("c2")), /pending/);
    const repo = store.workflowRepository(actor, "c2");
    const rows = await repo.read();
    rows[0].status = "conflict";
    await repo.write(rows);
    const fresh = seedDriverField("c2");
    fresh.jobs[0].status = "in_progress";
    fresh.jobs[0].version = 1;
    await store.cacheWorkspace(actor, "c2", fresh);
    await store.stageCommand(actor, "c2", { type: "arrive_job", clientEventId: "demo-replacement", input: { jobId, reviewNote: "demo-review" }, expectedJobVersion: 1 }, "demo-original");
    const after = await repo.read();
    assert.equal(after[0].supersededBy, "demo-replacement");
    assert.equal(after[1].replaces, "demo-original");
    assert.equal(after[0].status, "conflict");
    await assert.rejects(store.stageCommand(actor, "c2", { type: "complete_job", clientEventId: "demo-invalid", input: { jobId }, expectedJobVersion: 2 }), /bins/);
    assert.equal((await repo.read()).length, 2);
  } finally {
    for (const d of handles) d.close();
  }
});
test("revoked driver authorization preserves pending work and stops synchronization", async () => {
  const { ApiError } = await import("../packages/api-client/index.js"), handles = [], store = factory(":memory:", handles), actor = "local-demo-driver";
  try {
    await store.stageCommand(actor, "c2", { type: "start_job", clientEventId: "demo-auth-recovery", input: { jobId: "demo-field-job-1" }, expectedJobVersion: 0 });
    const repo = store.workflowRepository(actor, "c2"), result = await createSyncCoordinator({ repository: repo, api: { submitScan: async () => {
      throw new ApiError("Session revoked", 401);
    } } }).synchronize();
    assert.equal(result.status, "auth-required");
    assert.equal((await repo.read())[0].status, "pending");
    assert.equal((await repo.read())[0].lastStatus, 401);
  } finally {
    for (const db of handles) db.close();
  }
});
