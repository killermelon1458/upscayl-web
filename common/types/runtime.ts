import { ImageFormat } from "../image-formats";

export type ImageAsset = {
  id: string;
  name: string;
  previewUrl: string;
};

export type ResultAsset = ImageAsset & {
  downloadUrl?: string;
};

export type JobInput = {
  type: "image";
  assetId: string;
};

export type UpscaleRequest = {
  input: JobInput;
  outputTargetId?: string | null;
  model: string;
  scale: string;
  gpuId: string;
  saveImageAs: ImageFormat;
  overwrite: boolean;
  compression: string;
  noImageProcessing: boolean;
  customWidth: string;
  useCustomWidth: boolean;
  tileSize: number | null;
  ttaMode: boolean;
  copyMetadata: boolean;
};

export type JobInfo = {
  id: string;
  status: "started" | "cancelled" | "complete" | "error";
};

export type JobErrorCode =
  | "invalid-gpu"
  | "read-write"
  | "tile-size"
  | "uncaught-exception";

export type JobEvent =
  | { type: "started" }
  | { type: "progress"; percent: number; message: string }
  | { type: "phase"; phase: "scaling-and-converting" | "successful" }
  | { type: "warning"; message: string; code?: "metadata" }
  | { type: "log"; message: string }
  | { type: "error"; message: string; code?: JobErrorCode }
  | { type: "cancellation-requested" }
  | { type: "cancelled" }
  | { type: "complete"; result: ResultAsset };

export type RuntimeCapabilities = {
  canSelectOutputTarget: boolean;
  requiresOutputTarget: boolean;
  canRevealResult: boolean;
  canDownloadResult: boolean;
  confirmsCancellation: boolean;
  hasNativeTitleBar: boolean;
  hasNativeUpdates: boolean;
  hasNativeNotifications: boolean;
  supportsBatch: boolean;
  supportsDoubleUpscale: boolean;
  supportsCustomModels: boolean;
};

export type SystemInfo = {
  platform?: string;
  release: string;
  arch?: string;
  model: string;
  cpuCount: number;
  gpu?: Record<string, any>;
};

export interface UpscaylRuntime {
  readonly capabilities: RuntimeCapabilities;

  selectImage(): Promise<ImageAsset | null>;
  importImage(file: File): Promise<ImageAsset>;
  listModels(): Promise<string[]>;
  startJob(request: UpscaleRequest): Promise<JobInfo>;
  subscribeToJob(
    jobId: string,
    listener: (event: JobEvent) => void,
  ): () => void;
  cancelJob(jobId: string): Promise<void>;
  getSystemInfo(): Promise<SystemInfo>;
  getVersion(): Promise<string>;
}
