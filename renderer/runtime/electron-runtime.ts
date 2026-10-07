import { ELECTRON_COMMANDS } from "@common/electron-commands";
import { FEATURE_FLAGS } from "@common/feature-flags";
import getDirectoryFromPath from "@common/get-directory-from-path";
import getFilenameFromPath from "@common/get-file-name";
import { sanitizePath } from "@common/sanitize-path";
import {
  ImageAsset,
  JobEvent,
  JobInfo,
  ResultAsset,
  SystemInfo,
  UpscaleRequest,
  UpscaylRuntime,
} from "@common/types/runtime";
import { ImageUpscaylPayload } from "@common/types/types";
import log from "electron-log/renderer";
import {
  getBackendErrorCode,
  parseBackendOutput,
} from "@common/backend-output";

type ElectronFile = File & { path?: string };

const createAsset = (filePath: string): ImageAsset => ({
  id: filePath,
  name: getFilenameFromPath(filePath),
  previewUrl: `file:///${sanitizePath(filePath)}`,
});

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });

export class ElectronRuntime implements UpscaylRuntime {
  readonly capabilities = {
    canSelectOutputTarget: true,
    requiresOutputTarget: FEATURE_FLAGS.APP_STORE_BUILD,
    canRevealResult: true,
    canDownloadResult: false,
    confirmsCancellation: false,
    hasNativeTitleBar: window.electron.platform === "mac",
    hasNativeUpdates: !FEATURE_FLAGS.APP_STORE_BUILD,
    hasNativeNotifications: true,
    supportsBatch: true,
    supportsDoubleUpscale: true,
    supportsCustomModels: true,
  };

  private activeJobId: string | null = null;
  private defaultOutputPath: string | null = null;
  private jobCounter = 0;
  private listeners = new Map<string, Set<(event: JobEvent) => void>>();
  private pendingEvents = new Map<string, JobEvent[]>();

  constructor() {
    this.registerJobEventAdapters();
  }

  log(...args: unknown[]) {
    log.log(...args);
  }

  async selectImage(): Promise<ImageAsset | null> {
    const filePath = await window.electron.invoke(ELECTRON_COMMANDS.SELECT_FILE);
    if (filePath) this.defaultOutputPath = getDirectoryFromPath(filePath);
    return filePath ? createAsset(filePath) : null;
  }

  async importImage(file: ElectronFile): Promise<ImageAsset> {
    if (file.path) {
      this.defaultOutputPath = getDirectoryFromPath(file.path);
      return createAsset(file.path);
    }

    const outputPath = this.readStoredOutputPath() || this.defaultOutputPath;
    if (!outputPath) {
      throw new Error("Select an output folder before pasting an image.");
    }

    const now = new Date();
    const currentTime = `${now.getHours()}-${now.getMinutes()}-${now.getSeconds()}`;
    const name = `.temp-${currentTime}-${file.name || "image"}`;
    const extension = name.split(".").pop()?.toLowerCase();
    const encodedBuffer = (await readAsDataUrl(file)).split(",")[1];

    return new Promise<ImageAsset>((resolve, reject) => {
      const onSuccess = (_event: unknown, imageFilePath: string) => {
        cleanup();
        resolve(createAsset(imageFilePath));
      };
      const onError = (_event: unknown, message: string) => {
        cleanup();
        reject(new Error(message));
      };
      const cleanup = () => {
        window.electron.off(
          ELECTRON_COMMANDS.PASTE_IMAGE_SAVE_SUCCESS,
          onSuccess,
        );
        window.electron.off(ELECTRON_COMMANDS.PASTE_IMAGE_SAVE_ERROR, onError);
      };

      window.electron.on(ELECTRON_COMMANDS.PASTE_IMAGE_SAVE_SUCCESS, onSuccess);
      window.electron.on(ELECTRON_COMMANDS.PASTE_IMAGE_SAVE_ERROR, onError);
      window.electron.send(ELECTRON_COMMANDS.PASTE_IMAGE, {
        name,
        path: outputPath,
        extension,
        size: file.size,
        type: file.type.split("/")[0],
        encodedBuffer,
      });
    });
  }

  async listModels(): Promise<string[]> {
    const storedValue = localStorage.getItem("customModelsPath");
    const customModelsPath = storedValue ? JSON.parse(storedValue) : null;
    if (!customModelsPath) return [];

    return new Promise<string[]>((resolve) => {
      const onModels = (_event: unknown, models: string[] | null) => {
        window.electron.off(ELECTRON_COMMANDS.CUSTOM_MODEL_FILES_LIST, onModels);
        resolve(models ?? []);
      };
      window.electron.on(ELECTRON_COMMANDS.CUSTOM_MODEL_FILES_LIST, onModels);
      window.electron.send(ELECTRON_COMMANDS.GET_MODELS_LIST, customModelsPath);
    });
  }

  async startJob(request: UpscaleRequest): Promise<JobInfo> {
    if (request.input.type !== "image") {
      throw new Error("ElectronRuntime only supports image jobs here.");
    }

    const id = `electron-${Date.now()}-${++this.jobCounter}`;
    this.activeJobId = id;

    const outputPath =
      request.outputTargetId || getDirectoryFromPath(request.input.assetId);

    const payload: ImageUpscaylPayload = {
      imagePath: request.input.assetId,
      outputPath,
      model: request.model,
      gpuId: request.gpuId,
      saveImageAs: request.saveImageAs,
      scale: request.scale,
      overwrite: request.overwrite,
      noImageProcessing: request.noImageProcessing,
      compression: request.compression,
      customWidth: request.customWidth,
      useCustomWidth: request.useCustomWidth,
      tileSize: request.tileSize ?? 0,
      ttaMode: request.ttaMode,
      copyMetadata: request.copyMetadata,
    };

    window.electron.send(ELECTRON_COMMANDS.UPSCAYL, payload);
    return { id, status: "started" };
  }

  subscribeToJob(
    jobId: string,
    listener: (event: JobEvent) => void,
  ): () => void {
    const listeners = this.listeners.get(jobId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(jobId, listeners);
    listener({ type: "started" });
    this.pendingEvents.get(jobId)?.forEach(listener);
    this.pendingEvents.delete(jobId);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(jobId);
    };
  }

  async cancelJob(jobId: string): Promise<void> {
    if (jobId !== this.activeJobId) return;
    window.electron.send(ELECTRON_COMMANDS.STOP);
    this.emit({ type: "cancellation-requested" });
    this.activeJobId = null;
  }

  getSystemInfo(): Promise<SystemInfo> {
    return window.electron.getSystemInfo();
  }

  getVersion(): Promise<string> {
    return window.electron.getAppVersion();
  }

  private registerJobEventAdapters() {
    window.electron.on(ELECTRON_COMMANDS.LOG, (_event, message: string) => {
      this.emit({ type: "log", message });
    });
    window.electron.on(
      ELECTRON_COMMANDS.SCALING_AND_CONVERTING,
      () => {
        this.emit({ type: "phase", phase: "scaling-and-converting" });
      },
    );
    window.electron.on(
      ELECTRON_COMMANDS.UPSCAYL_WARNING,
      (_event, message: string) => {
        this.emit({ type: "warning", message });
      },
    );
    window.electron.on(
      ELECTRON_COMMANDS.METADATA_ERROR,
      (_event, message: string) => {
        this.emit({ type: "warning", message, code: "metadata" });
      },
    );
    window.electron.on(
      ELECTRON_COMMANDS.UPSCAYL_ERROR,
      (_event, message: string) => {
        this.emit({
          type: "error",
          message,
          code: getBackendErrorCode(message),
        });
        this.activeJobId = null;
      },
    );
    window.electron.on(
      ELECTRON_COMMANDS.UPSCAYL_PROGRESS,
      (_event, rawProgress: string) => {
        this.emitProgress(rawProgress);
      },
    );
    window.electron.on(
      ELECTRON_COMMANDS.UPSCAYL_DONE,
      (_event, outputPath: string) => {
        const result: ResultAsset = {
          ...createAsset(outputPath),
          downloadUrl: `file:///${sanitizePath(outputPath)}`,
        };
        this.emit({ type: "complete", result });
        this.activeJobId = null;
      },
    );
  }

  private emitProgress(rawProgress: string) {
    const events = parseBackendOutput(rawProgress);
    events.forEach((event) => this.emit(event));
    if (events.some((event) => event.type === "error")) {
      this.activeJobId = null;
    }
  }

  private emit(event: JobEvent) {
    if (!this.activeJobId) return;
    const jobId = this.activeJobId;
    const listeners = this.listeners.get(jobId);
    if (listeners?.size) {
      listeners.forEach((listener) => listener(event));
    } else {
      const pendingEvents = this.pendingEvents.get(jobId) ?? [];
      pendingEvents.push(event);
      this.pendingEvents.set(jobId, pendingEvents);
    }
  }

  private readStoredOutputPath(): string | null {
    const storedValue = localStorage.getItem("savedOutputPath");
    if (!storedValue) return null;
    try {
      return JSON.parse(storedValue);
    } catch {
      return storedValue;
    }
  }
}
