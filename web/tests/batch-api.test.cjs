const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, writeFile, readFile, rm } = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { once } = require("node:events");
const { inflateRawSync } = require("node:zlib");
const { UpscaylWebServer } = require("../../export/web/server/server");
const { getWebServerConfig } = require("../../export/web/server/config");

// Decode small test archives using their central-directory offsets. No test-only ZIP dependency.
function zipEntries(zip) {
  const entries = [];
  for (let offset = 0; offset + 46 < zip.length; offset++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) continue;
    const length = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 46, offset + 46 + length).toString();
    const local = zip.readUInt32LE(offset + 42);
    const start =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + zip.readUInt32LE(offset + 20));
    entries.push({
      name,
      data: zip.readUInt16LE(offset + 10) === 8 ? inflateRawSync(data) : data,
    });
    offset +=
      45 +
      length +
      zip.readUInt16LE(offset + 30) +
      zip.readUInt16LE(offset + 32);
  }
  return entries;
}

test("HTTP/SSE batch busy reservation, partial failure, retry, ZIP, and cancellation", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "upscayl-batch-api-"));
  const backend = path.join(temp, "backend.cjs");
  const planPath = path.join(temp, "plan.json");
  // CPU-only fixture deliberately copies inputs: GPU inference is tested separately in Chromium.
  await writeFile(
    backend,
    `#!/usr/bin/env node
const fs = require('fs');
const p = ${JSON.stringify(temp)};
const plan = JSON.parse(fs.readFileSync(p+'/plan.json'));
const call = fs.existsSync(p+'/count') ? Number(fs.readFileSync(p+'/count'))+1 : 1;
fs.writeFileSync(p+'/count',String(call));
process.stderr.write('50%\\n');
setTimeout(()=>{
 if(plan.fail===call){console.error('failed: controlled test failure');process.exit(42);}
 const args=process.argv;fs.copyFileSync(args[args.indexOf('-i')+1],args[args.indexOf('-o')+1]);
 console.error('100%');
},plan.delay||100);
`,
    { mode: 0o700 },
  );
  await writeFile(planPath, JSON.stringify({ fail: 2, delay: 250 }));
  const application = new UpscaylWebServer({
    ...getWebServerConfig(),
    backendPath: backend,
    dataRoot: temp,
  });
  await application.initialize();
  const server = application.createHttpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) =>
    fetch(base + url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const snapshot = (id) =>
    fetch(`${base}/api/batches/${id}`).then((r) => r.json());
  const events = (id) =>
    fetch(`${base}/api/batches/${id}/events`)
      .then((r) => r.text())
      .then((text) =>
        text
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => JSON.parse(line.slice(6))),
      );
  const settings = {
    model: "upscayl-lite-4x",
    scale: "2",
    saveImageAs: "png",
    gpuId: "",
    compression: "0",
    overwrite: false,
    noImageProcessing: false,
    customWidth: "",
    useCustomWidth: false,
    tileSize: null,
    ttaMode: false,
    copyMetadata: false,
  };
  try {
    const image = await readFile(
      path.join(__dirname, "../../resources/icons/128x128.png"),
    );
    const assets = [];
    for (let i = 0; i < 3; i++) {
      const response = await fetch(base + "/api/assets", {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "X-Upscayl-Filename": encodeURIComponent("same.png"),
        },
        body: image,
      });
      assert.equal(response.status, 201);
      assets.push(await response.json());
    }
    assert.equal(new Set(assets.map((a) => a.id)).size, 3);
    assert.equal((await post("/api/batches", null)).status, 400);
    assert.equal(
      (
        await post("/api/batches", {
          assetIds: [assets[0].id, assets[0].id],
          settings,
        })
      ).status,
      400,
    );
    const response = await post("/api/batches", {
      assetIds: assets.map((a) => a.id),
      settings,
    });
    assert.equal(response.status, 201);
    const batch = await response.json();
    const pendingEvents = events(batch.id);
    assert.equal(
      (
        await post("/api/jobs", {
          ...settings,
          input: { type: "image", assetId: assets[0].id },
        })
      ).status,
      409,
    );
    assert.equal(
      (await post("/api/batches", { assetIds: [assets[0].id], settings }))
        .status,
      409,
    );
    const stream = await pendingEvents;
    assert.ok(
      stream.some(
        (e) => e.type === "item-event" && e.event.type === "progress",
      ),
    );
    const partial = await snapshot(batch.id);
    assert.deepEqual(
      partial.items.map((item) => item.status),
      ["complete", "failed", "complete"],
    );
    const failed = await fetch(
      `${base}/api/jobs/${partial.items[1].jobId}`,
    ).then((r) => r.json());
    assert.equal(failed.exitCode, 42);
    assert.ok(
      failed.diagnostics.some((line) =>
        line.includes("controlled test failure"),
      ),
    );
    let entries = zipEntries(
      Buffer.from(
        await (await fetch(base + partial.downloadUrl)).arrayBuffer(),
      ),
    );
    assert.equal(entries.length, 2);
    assert.equal(new Set(entries.map((e) => e.name)).size, 2);
    entries.forEach((entry) => {
      assert.ok(!entry.name.includes("/"));
      assert.deepEqual(entry.data, image);
    });
    await writeFile(planPath, JSON.stringify({ delay: 100 }));
    assert.equal(
      (
        await post(`/api/batches/${batch.id}/retry`, {
          itemIds: [partial.items[1].id],
        })
      ).status,
      202,
    );
    await events(batch.id);
    const retried = await snapshot(batch.id);
    assert.ok(retried.items.every((item) => item.status === "complete"));
    assert.equal(retried.items[1].input.id, assets[1].id);
    assert.equal(retried.items[0].jobId, partial.items[0].jobId);
    entries = zipEntries(
      Buffer.from(
        await (await fetch(base + retried.downloadUrl)).arrayBuffer(),
      ),
    );
    assert.equal(entries.length, 3);
    await writeFile(planPath, JSON.stringify({ delay: 2000 }));
    const cancelled = await (
      await post("/api/batches", {
        assetIds: assets.map((a) => a.id),
        settings,
      })
    ).json();
    const cancellationEvents = events(cancelled.id);
    assert.equal(
      (await post(`/api/batches/${cancelled.id}/cancel`)).status,
      202,
    );
    await cancellationEvents;
    const stopped = await snapshot(cancelled.id);
    assert.equal(stopped.status, "cancelled");
    assert.ok(stopped.items.every((item) => item.status === "cancelled"));
    // Busy reservation must be released only after cancellation completes.
    await writeFile(planPath, JSON.stringify({ delay: 100 }));
    const single = await (
      await post("/api/jobs", {
        ...settings,
        input: { type: "image", assetId: assets[0].id },
      })
    ).json();
    const singleEvents = await fetch(
      `${base}/api/jobs/${single.id}/events`,
    ).then((r) => r.text());
    assert.ok(singleEvents.includes('"type":"complete"'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    // Only the directory created by this test is removed.
    await rm(temp, { recursive: true, force: true });
  }
});
