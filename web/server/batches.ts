import { randomUUID } from "crypto";
import { ServerResponse } from "http";
import {
  BatchEvent,
  BatchInfo,
  BatchRequest,
  ImageAsset,
  JobEvent,
  ResultAsset,
  UpscaleRequest,
} from "../../common/types/runtime";

type JobOutcome = { status: string; result?: ResultAsset; error?: string };
type BatchHost = {
  start(
    request: UpscaleRequest,
    onEvent: (event: JobEvent) => void,
  ): Promise<{ id: string; finished: Promise<JobOutcome> }>;
  cancel(jobId: string): void;
};
type StoredBatch = BatchInfo & {
  subscribers: Set<ServerResponse>;
  nextEventId: number;
};

/** One reserved sequential run, using the host's existing single-image executor. */
export class BatchManager {
  private batches = new Map<string, StoredBatch>();
  runningId?: string;
  constructor(private host: BatchHost) {}

  get(id: string) {
    return this.batches.get(id);
  }
  snapshot(batch: StoredBatch): BatchInfo {
    const { id, status, settings, items, downloadUrl } = batch;
    const progress =
      items.reduce(
        (sum, item) =>
          sum +
          (["complete", "failed", "cancelled"].includes(item.status)
            ? 100
            : item.progress),
        0,
      ) / items.length;
    return {
      id,
      status,
      settings: { ...settings },
      items: items.map((item) => ({ ...item })),
      progress,
      downloadUrl,
    };
  }
  create(inputs: ImageAsset[], settings: BatchRequest["settings"]) {
    const id = randomUUID();
    const batch: StoredBatch = {
      id,
      status: "running",
      settings: { ...settings },
      items: inputs.map((input) => ({
        id: randomUUID(),
        input,
        status: "queued",
        progress: 0,
      })),
      progress: 0,
      downloadUrl: `/api/batches/${id}/download`,
      subscribers: new Set(),
      nextEventId: 1,
    };
    this.batches.set(id, batch);
    this.launch(batch);
    return this.snapshot(batch);
  }
  retry(batch: StoredBatch, itemIds: string[]) {
    for (const item of batch.items) {
      if (itemIds.includes(item.id)) {
        item.status = "queued";
        item.progress = 0;
        item.error = undefined;
        item.jobId = undefined;
      }
    }
    batch.status = "running";
    this.launch(batch);
    return this.snapshot(batch);
  }
  cancel(batch: StoredBatch) {
    if (batch.status !== "running") return;
    batch.status = "cancelling";
    for (const item of batch.items) {
      if (item.status === "queued") item.status = "cancelled";
    }
    const active = batch.items.find((item) => item.status === "processing");
    if (active?.jobId) this.host.cancel(active.jobId);
    this.update(batch);
  }
  subscribe(batch: StoredBatch, response: ServerResponse) {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    this.write(batch, response, { type: "batch", batch: this.snapshot(batch) });
    if (["complete", "cancelled"].includes(batch.status)) {
      response.end();
      return;
    }
    batch.subscribers.add(response);
    const timer = setInterval(() => response.write(": keep-alive\n\n"), 15000);
    response.on("close", () => {
      clearInterval(timer);
      batch.subscribers.delete(response);
    });
  }
  private launch(batch: StoredBatch) {
    this.runningId = batch.id;
    void this.run(batch).finally(() => {
      if (this.runningId === batch.id) this.runningId = undefined;
      this.update(batch);
      batch.subscribers.forEach((response) => response.end());
      batch.subscribers.clear();
    });
  }
  private async run(batch: StoredBatch) {
    for (const item of batch.items) {
      if (batch.status === "cancelling") break;
      if (item.status !== "queued") continue;
      item.status = "processing";
      this.update(batch);
      try {
        const job = await this.host.start(
          {
            ...batch.settings,
            input: { type: "image", assetId: item.input.id },
          },
          (event) => {
            if (event.type === "progress")
              item.progress = Math.min(100, Math.max(0, event.percent));
            this.broadcast(batch, {
              type: "item-event",
              itemId: item.id,
              event,
            });
            if (event.type === "progress") this.update(batch);
          },
        );
        item.jobId = job.id;
        this.update(batch);
        // Cancellation may arrive while the executor is creating the job directory.
        if (this.isCancelling(batch)) this.host.cancel(job.id);
        const outcome = await job.finished;
        item.status =
          outcome.status === "complete"
            ? "complete"
            : outcome.status === "cancelled"
              ? "cancelled"
              : "failed";
        item.result = outcome.result;
        item.error = outcome.error;
        item.progress = 100;
      } catch {
        item.status = "failed";
        item.error =
          "This image could not be processed. Check the backend and model configuration.";
      }
      this.update(batch);
    }
    batch.status = batch.status === "cancelling" ? "cancelled" : "complete";
  }
  private update(batch: StoredBatch) {
    this.broadcast(batch, { type: "batch", batch: this.snapshot(batch) });
  }
  private isCancelling(batch: StoredBatch) {
    return batch.status === "cancelling";
  }
  private broadcast(batch: StoredBatch, event: BatchEvent) {
    batch.subscribers.forEach((response) => this.write(batch, response, event));
  }
  private write(
    batch: StoredBatch,
    response: ServerResponse,
    event: BatchEvent,
  ) {
    response.write(
      `id: ${batch.nextEventId++}\ndata: ${JSON.stringify(event)}\n\n`,
    );
  }
}
