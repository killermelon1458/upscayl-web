import {
  ImageAsset,
  JobEvent,
  JobInfo,
  SystemInfo,
  UpscaleRequest,
  UpscaylRuntime,
} from "@common/types/runtime";

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
    return withAbsoluteAssetUrls(asset);
  }

  async listModels(): Promise<string[]> {
    const response = await fetch("/api/models");
    const models = await readResponse<Array<{ id: string }>>(response);
    return models.map((model) => model.id);
  }

  async startJob(request: UpscaleRequest): Promise<JobInfo> {
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
