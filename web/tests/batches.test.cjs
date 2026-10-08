const assert = require("node:assert/strict");
const { test } = require("node:test");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { BatchManager } = require("../../export/web/server/batches");

const inputs = ["first", "second", "third"].map((id) => ({
  id,
  name: `${id}.png`,
  previewUrl: `/api/assets/${id}`,
}));
const settings = { model: "upscayl-lite-4x", scale: "2", saveImageAs: "png" };

function executor() {
  const calls = [],
    cancelled = [];
  const manager = new BatchManager({
    start: async (request, event) => {
      let finish;
      const finished = new Promise((resolve) => {
        finish = resolve;
      });
      const id = `job-${calls.length}`;
      calls.push({ id, request, event, finish });
      return { id, finished };
    },
    cancel: (id) => cancelled.push(id),
  });
  return { manager, calls, cancelled };
}
const result = (id) => ({ id, name: `${id}.png`, previewUrl: `/result/${id}` });

test("sequential execution snapshots settings and continues past a failed item", async () => {
  const { manager, calls } = executor();
  const visibleSettings = { ...settings };
  const created = manager.create(inputs, visibleSettings);
  const batch = manager.get(created.id);
  visibleSettings.scale = "16";
  await nextTurn();
  assert.equal(calls.length, 1);
  calls[0].event({ type: "progress", percent: 60, message: "60%" });
  assert.equal(manager.snapshot(batch).progress, 20);
  calls[0].finish({ status: "complete", result: result("first") });
  await nextTurn();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].request.scale, "2");
  calls[1].finish({ status: "error", error: "controlled failure: exit 42" });
  await nextTurn();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].request.input.assetId, "third");
  calls[2].finish({ status: "complete", result: result("third") });
  await nextTurn();
  assert.deepEqual(
    batch.items.map((item) => item.status),
    ["complete", "failed", "complete"],
  );
  assert.equal(manager.runningId, undefined);
  assert.equal(manager.snapshot(batch).progress, 100);
  const firstJob = batch.items[0].jobId;
  manager.retry(batch, [batch.items[1].id]);
  await nextTurn();
  assert.equal(calls.length, 4);
  assert.equal(calls[3].request.input.assetId, "second");
  assert.equal(calls[3].request.scale, "2");
  calls[3].finish({ status: "complete", result: result("second") });
  await nextTurn();
  assert.equal(batch.items[0].jobId, firstJob);
  assert.ok(batch.items.every((item) => item.status === "complete"));
});

test("cancellation waits for process exit, stops queued items and retains completed results", async () => {
  const { manager, calls, cancelled } = executor();
  const created = manager.create(inputs, settings);
  const batch = manager.get(created.id);
  await nextTurn();
  calls[0].finish({ status: "complete", result: result("first") });
  await nextTurn();
  manager.cancel(batch);
  assert.equal(batch.status, "cancelling");
  assert.equal(manager.runningId, created.id);
  assert.deepEqual(cancelled, [calls[1].id]);
  assert.equal(batch.items[1].status, "processing");
  calls[1].finish({ status: "cancelled" });
  await nextTurn();
  assert.deepEqual(
    batch.items.map((item) => item.status),
    ["complete", "cancelled", "cancelled"],
  );
  assert.equal(batch.items[0].result.id, "first");
  assert.equal(calls.length, 2);
  assert.equal(batch.status, "cancelled");
  assert.equal(manager.runningId, undefined);
});

test("cancellation during asynchronous job creation signals the newly owned job", async () => {
  let ready, finish;
  const cancelled = [];
  const manager = new BatchManager({
    start: () =>
      new Promise((resolve) => {
        ready = () =>
          resolve({
            id: "new-job",
            finished: new Promise((r) => {
              finish = r;
            }),
          });
      }),
    cancel: (id) => cancelled.push(id),
  });
  const created = manager.create(inputs, settings);
  const batch = manager.get(created.id);
  manager.cancel(batch);
  ready();
  await nextTurn();
  assert.deepEqual(cancelled, ["new-job"]);
  finish({ status: "cancelled" });
  await nextTurn();
  assert.equal(batch.status, "cancelled");
  assert.ok(batch.items.every((item) => item.status === "cancelled"));
});
