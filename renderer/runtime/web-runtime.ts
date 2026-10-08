import {
  ImageAsset,
  JobEvent,
  JobInfo,
  SystemInfo,
  UpscaleRequest,
  UpscaylRuntime,
  BatchInfo,
  BatchRequest,
  BatchEvent,
  ImageBatchRuntime,
} from "@common/types/runtime";
import { outputSizeWarning } from "@common/output-size";

type ApiErrorBody = { error?: { code?: string; message?: string } };

const absoluteUrl = (url: string) =>
  new URL(url, window.location.origin).toString();

const readResponse = async <T>(response: Response): Promise<T> => {
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody & T;
  if (!response.ok) {
    throw new Error(
      body.error?.message || `The web server returned HTTP ${response.status}.`,
    );
  }
  return body;
};

const withAbsoluteAssetUrls = <T extends ImageAsset & { downloadUrl?: string }>(
  asset: T,
): T => ({
  ...asset,
  previewUrl: absoluteUrl(asset.previewUrl),
  ...(asset.downloadUrl ? { downloadUrl: absoluteUrl(asset.downloadUrl) } : {}),
});

export class WebRuntime implements UpscaylRuntime {
  readonly batch: ImageBatchRuntime = this;
  private assets = new Map<string, ImageAsset>();
  readonly capabilities = {
    canSelectOutputTarget: false,
    requiresOutputTarget: false,
    canRevealResult: false,
    canDownloadResult: true,
    confirmsCancellation: true,
    hasNativeTitleBar: false,
    hasNativeUpdates: false,
    hasNativeNotifications: false,
    supportsBatch: false,
    supportsDoubleUpscale: false,
    supportsCustomModels: false,
  };

  log(...args: unknown[]) {
    console.log(...args);
  }

  selectFiles(): Promise<File[]> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept =
        ".png,.jpg,.jpeg,.jfif,.webp,image/png,image/jpeg,image/webp";
      input.style.display = "none";
      document.body.appendChild(input);
      const finish = (files: File[]) => {
        input.remove();
        resolve(files);
      };
      input.addEventListener(
        "change",
        () => finish(Array.from(input.files || [])),
        { once: true },
      );
      input.addEventListener("cancel", () => finish([]), { once: true });
      input.click();
    });
  }

  private batchUrls(batch: BatchInfo): BatchInfo {
    return {
      ...batch,
      downloadUrl: absoluteUrl(batch.downloadUrl),
      items: batch.items.map((item) => ({
        ...item,
        input: withAbsoluteAssetUrls(item.input),
        result: item.result ? withAbsoluteAssetUrls(item.result) : undefined,
      })),
    };
  }

  async startBatch(request: BatchRequest): Promise<BatchInfo> {
    const warnings = request.assetIds
      .map((id) => this.assets.get(id))
      .filter((asset): asset is ImageAsset => !!asset)
      .map((asset) =>
        outputSizeWarning(asset, {
          ...request.settings,
          input: { type: "image", assetId: asset.id },
        }),
      )
      .filter(Boolean);
    if (
      warnings.length &&
      !window.confirm(
        `${warnings.length} image(s) request very large outputs.\n${warnings[0]}\n\nContinue processing?`,
      )
    )
      throw new Error("Batch was not started: large-output warning declined.");
    return this.batchUrls(
      await readResponse<BatchInfo>(
        await fetch("/api/batches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        }),
      ),
    );
  }

  subscribeToBatch(id: string, listener: (event: BatchEvent) => void) {
    const source = new EventSource(
      `/api/batches/${encodeURIComponent(id)}/events`,
    );
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as BatchEvent;
      listener(
        event.type === "batch"
          ? { ...event, batch: this.batchUrls(event.batch) }
          : event,
      );
      if (
        event.type === "batch" &&
        ["complete", "cancelled"].includes(event.batch.status)
      )
        source.close();
    };
    return () => source.close();
  }

  async cancelBatch(id: string) {
    await readResponse(
      await fetch(`/api/batches/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
      }),
    );
  }

  async retryBatch(id: string, itemIds: string[]) {
    return this.batchUrls(
      await readResponse<BatchInfo>(
        await fetch(`/api/batches/${encodeURIComponent(id)}/retry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIds }),
        }),
      ),
    );
  }

  async getItemDiagnostics(jobId: string) {
    const job = await readResponse<{ diagnostics: string[] }>(
      await fetch(`/api/jobs/${encodeURIComponent(jobId)}`),
    );
    return job.diagnostics;
  }

  selectImage(): Promise<ImageAsset | null> {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept =
        ".png,.jpg,.jpeg,.jfif,.webp,image/png,image/jpeg,image/webp";
      input.style.display = "none";
      document.body.appendChild(input);

      const cleanup = () => input.remove();
      input.addEventListener(
        "change",
        () => {
          const file = input.files?.[0];
          if (!file) {
            cleanup();
            resolve(null);
            return;
          }
          this.importImage(file).then(resolve, reject).finally(cleanup);
        },
        { once: true },
      );
      input.addEventListener(
        "cancel",
        () => {
          cleanup();
          resolve(null);
        },
        { once: true },
      );
      input.click();
    });
  }

  async importImage(file: File): Promise<ImageAsset> {
    const response = await fetch("/api/assets", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Upscayl-Filename": encodeURIComponent(file.name || "clipboard.png"),
      },
      body: file,
    });
    const asset = await readResponse<ImageAsset>(response);
    this.assets.set(asset.id, asset);
    return withAbsoluteAssetUrls(asset);
  }

  async listModels(): Promise<string[]> {
    const response = await fetch("/api/models");
    const models = await readResponse<Array<{ id: string }>>(response);
    return models.map((model) => model.id);
  }

  async startJob(request: UpscaleRequest): Promise<JobInfo> {
    const asset = this.assets.get(request.input.assetId);
    const warning = asset && outputSizeWarning(asset, request);
    if (warning && !window.confirm(`${warning}\n\nContinue processing?`)) {
      throw new Error(
        "Processing was not started: large-output warning declined.",
      );
    }
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, outputTargetId: null }),
    });
    return readResponse<JobInfo>(response);
  }

  subscribeToJob(
    jobId: string,
    listener: (event: JobEvent) => void,
  ): () => void {
    const source = new EventSource(
      `/api/jobs/${encodeURIComponent(jobId)}/events`,
    );
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as JobEvent;
        if (event.type === "complete") {
          listener({ ...event, result: withAbsoluteAssetUrls(event.result) });
        } else {
          listener(event);
        }
      } catch {
        listener({
          type: "error",
          message: "The server sent an invalid job event.",
        });
      }
    };
    return () => source.close();
  }

  async cancelJob(jobId: string): Promise<void> {
    const response = await fetch(
      `/api/jobs/${encodeURIComponent(jobId)}/cancel`,
      { method: "POST" },
    );
    await readResponse(response);
  }

  async getSystemInfo(): Promise<SystemInfo> {
    return readResponse<SystemInfo>(await fetch("/api/system"));
  }

  async getVersion(): Promise<string> {
    const response = await readResponse<{ version: string }>(
      await fetch("/api/version"),
    );
    return response.version;
  }
}
