import { ChildProcess, spawn } from "child_process";
import { createReadStream } from "fs";
import { access, mkdir, readFile, stat, unlink, writeFile } from "fs/promises";
import { createServer, IncomingMessage, ServerResponse } from "http";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { createInterface } from "readline";
import { imageDimensions } from "./image-dimensions";
import { outputSizeWarning } from "../../common/output-size";
import { backendFailure } from "./job-diagnostics";
import { MODELS } from "../../common/models-list";
import { imageFormats, ImageFormat } from "../../common/image-formats";
import { buildSingleImageArguments } from "../../common/upscayl-arguments";
import { parseBackendOutput } from "../../common/backend-output";
import {
  ImageAsset,
  JobEvent,
  JobInfo,
  ResultAsset,
  SystemInfo,
  UpscaleRequest,
} from "../../common/types/runtime";
import { copyMetadata } from "../../electron/utils/copy-metadata";
import { WebServerConfig } from "./config";

type StoredAsset = ImageAsset & {
  path: string;
  extension: InputExtension;
  mimeType: string;
};

type JobStatus = "started" | "cancelling" | "cancelled" | "complete" | "error";

type StoredJob = {
  id: string;
  status: JobStatus;
  input: StoredAsset;
  request: UpscaleRequest;
  result?: ResultAsset & { path: string; mimeType: string };
  error?: string;
  process?: ChildProcess;
  cancellationTimer?: NodeJS.Timeout;
  events: Array<{ id: number; event: JobEvent }>;
  subscribers: Set<ServerResponse>;
  nextEventId: number;
  diagnostics: string[];
  reportedError?: string;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | null;
};

type InputExtension = "png" | "jpg" | "jpeg" | "jfif" | "webp";

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const inputTypes: Record<InputExtension, string[]> = {
  png: ["image/png"],
  jpg: ["image/jpeg", "image/jpg"],
  jpeg: ["image/jpeg", "image/jpg"],
  jfif: ["image/jpeg", "image/jpg"],
  webp: ["image/webp"],
};

const outputMimeTypes: Record<ImageFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const staticMimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
};

const decodeFilename = (request: IncomingMessage) => {
  const raw = request.headers["x-upscayl-filename"];
  if (typeof raw !== "string") {
    throw new HttpError(
      400,
      "missing-filename",
      "The upload filename is required.",
    );
  }
  try {
    return decodeURIComponent(raw)
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .slice(0, 255);
  } catch {
    throw new HttpError(
      400,
      "invalid-filename",
      "The upload filename is invalid.",
    );
  }
};

const extensionFor = (filename: string): InputExtension => {
  const extension = path
    .extname(filename)
    .slice(1)
    .toLowerCase() as InputExtension;
  if (!(extension in inputTypes)) {
    throw new HttpError(
      415,
      "unsupported-image",
      "Only PNG, JPEG, JFIF, and WebP images are supported.",
    );
  }
  return extension;
};

const hasValidSignature = (data: Buffer, extension: InputExtension) => {
  if (extension === "png") {
    return data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (extension === "webp") {
    return (
      data.subarray(0, 4).toString() === "RIFF" &&
      data.subarray(8, 12).toString() === "WEBP"
    );
  }
  return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
};

const readBody = (request: IncomingMessage, limit: number) =>
  new Promise<Buffer>((resolve, reject) => {
    const declaredLength = Number(request.headers["content-length"] || 0);
    if (declaredLength > limit) {
      request.resume();
      reject(
        new HttpError(
          413,
          "upload-too-large",
          "The uploaded image exceeds the configured size limit.",
        ),
      );
      return;
    }

    const chunks: Buffer[] = [];
    let length = 0;
    let exceeded = false;
    request.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > limit) {
        exceeded = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (exceeded) {
        reject(
          new HttpError(
            413,
            "upload-too-large",
            "The uploaded image exceeds the configured size limit.",
          ),
        );
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    request.on("error", reject);
  });

const readJson = async (request: IncomingMessage) => {
  const data = await readBody(request, 64 * 1024);
  try {
    return JSON.parse(data.toString("utf8"));
  } catch {
    throw new HttpError(
      400,
      "invalid-json",
      "The request body is not valid JSON.",
    );
  }
};

const safeName = (name: string) =>
  path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, "_");

export class UpscaylWebServer {
  private readonly assets = new Map<string, StoredAsset>();
  private readonly jobs = new Map<string, StoredJob>();
  private activeJobId: string | null = null;
  private creatingJob = false;
  private packageVersion = "unknown";

  constructor(private readonly config: WebServerConfig) {}

  async initialize() {
    await mkdir(path.join(this.config.dataRoot, "assets"), { recursive: true });
    await mkdir(path.join(this.config.dataRoot, "jobs"), { recursive: true });
    try {
      const packageData = JSON.parse(
        await readFile(
          path.join(this.config.projectRoot, "package.json"),
          "utf8",
        ),
      );
      this.packageVersion = packageData.version || "unknown";
    } catch {
      // Version reporting is optional; server startup must not depend on package metadata.
    }
  }

  createHttpServer() {
    return createServer((request, response) => {
      this.route(request, response).catch((error) =>
        this.handleError(response, error),
      );
    });
  }

  private async route(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(
      request.url || "/",
      `http://${request.headers.host || "localhost"}`,
    );
    const pathname = decodeURIComponent(url.pathname);

    if (request.method === "POST" && pathname === "/api/assets") {
      return this.uploadAsset(request, response);
    }
    if (request.method === "GET" && pathname === "/api/models") {
      return json(response, 200, Object.values(MODELS));
    }
    if (request.method === "GET" && pathname === "/api/system") {
      const system: SystemInfo = {
        platform: process.platform,
        release: os.release(),
        arch: os.arch(),
        model: os.cpus()[0]?.model || "Unknown CPU",
        cpuCount: os.cpus().length,
      };
      return json(response, 200, system);
    }
    if (request.method === "GET" && pathname === "/api/version") {
      return json(response, 200, { version: this.packageVersion });
    }
    if (request.method === "POST" && pathname === "/api/jobs") {
      return this.createJob(request, response);
    }

    const assetMatch = pathname.match(/^\/api\/assets\/([0-9a-f-]+)$/);
    if (request.method === "GET" && assetMatch) {
      const asset = this.assets.get(assetMatch[1]);
      if (!asset)
        throw new HttpError(
          404,
          "missing-asset",
          "The image asset was not found or has expired.",
        );
      return this.sendFile(
        response,
        asset.path,
        asset.mimeType,
        asset.name,
        false,
      );
    }

    const jobMatch = pathname.match(/^\/api\/jobs\/([0-9a-f-]+)$/);
    if (request.method === "GET" && jobMatch) {
      const job = this.requireJob(jobMatch[1]);
      return json(response, 200, this.publicJob(job));
    }

    const eventMatch = pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/events$/);
    if (request.method === "GET" && eventMatch) {
      return this.subscribeToJob(
        request,
        response,
        this.requireJob(eventMatch[1]),
      );
    }

    const cancelMatch = pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/cancel$/);
    if (request.method === "POST" && cancelMatch) {
      return this.cancelJob(response, this.requireJob(cancelMatch[1]));
    }

    const resultMatch = pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/result$/);
    if (request.method === "GET" && resultMatch) {
      const job = this.requireJob(resultMatch[1]);
      if (!job.result)
        throw new HttpError(
          404,
          "missing-result",
          "This job does not have a result.",
        );
      const download = url.searchParams.get("download") === "1";
      return this.sendFile(
        response,
        job.result.path,
        job.result.mimeType,
        job.result.name,
        download,
      );
    }

    if (request.method === "GET" || request.method === "HEAD") {
      return this.serveStatic(response, pathname, request.method === "HEAD");
    }
    throw new HttpError(
      404,
      "not-found",
      "The requested endpoint does not exist.",
    );
  }

  private async uploadAsset(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    const name = decodeFilename(request);
    const extension = extensionFor(name);
    const mimeType = (request.headers["content-type"] || "")
      .split(";")[0]
      .toLowerCase();
    if (!inputTypes[extension].includes(mimeType)) {
      throw new HttpError(
        415,
        "unsupported-image",
        "The image MIME type does not match its filename.",
      );
    }
    const data = await readBody(request, this.config.uploadLimitBytes);
    if (!hasValidSignature(data, extension)) {
      throw new HttpError(
        415,
        "unsupported-image",
        "The uploaded file is not a supported image.",
      );
    }

    const id = randomUUID();
    const assetPath = path.join(
      this.config.dataRoot,
      "assets",
      `${id}.${extension}`,
    );
    // Header metadata only; do not decode/allocate the full pixel image.
    const dimensions = imageDimensions(data, extension);
    await writeFile(assetPath, data, { flag: "wx" });
    const asset: StoredAsset = {
      id,
      name: safeName(name) || `image.${extension}`,
      previewUrl: `/api/assets/${id}`,
      path: assetPath,
      extension,
      mimeType,
      width: dimensions?.width,
      height: dimensions?.height,
    };
    this.assets.set(id, asset);
    return json(response, 201, this.publicAsset(asset));
  }

  private async createJob(request: IncomingMessage, response: ServerResponse) {
    if (this.activeJobId || this.creatingJob) {
      throw new HttpError(
        409,
        "server-busy",
        "The GPU is already processing another job.",
      );
    }
    this.creatingJob = true;
    try {
      const body = (await readJson(request)) as UpscaleRequest;
      const validated = this.validateRequest(body);
      const input = this.assets.get(validated.input.assetId);
      if (!input)
        throw new HttpError(
          404,
          "missing-asset",
          "The input image was not found or has expired.",
        );

      await this.validateResources(validated.model);
      const id = randomUUID();
      const jobDirectory = path.join(this.config.dataRoot, "jobs", id);
      await mkdir(jobDirectory, { recursive: false });
      const resultName = this.resultName(input.name, validated);
      const resultPath = path.join(
        jobDirectory,
        `result.${validated.saveImageAs}`,
      );
      const job: StoredJob = {
        id,
        status: "started",
        input,
        request: validated,
        events: [],
        subscribers: new Set(),
        nextEventId: 1,
        diagnostics: [],
      };
      this.jobs.set(id, job);
      this.activeJobId = id;
      const context = `Job ${id}: model=${validated.model}, scale=${validated.scale}x, input=${input.width && input.height ? `${input.width}x${input.height}` : "dimensions unavailable"}, format=${validated.saveImageAs}${validated.useCustomWidth ? `, custom width=${validated.customWidth}` : ""}.`;
      this.recordDiagnostic(job, context);
      const warning = outputSizeWarning(input, validated);
      if (warning) this.emit(job, { type: "warning", message: warning });

      const args = buildSingleImageArguments({
        inputPath: input.path,
        outputPath: resultPath,
        modelsPath: this.config.modelsPath,
        model: validated.model,
        scale: validated.scale,
        gpuId: validated.gpuId,
        saveImageAs: validated.saveImageAs,
        customWidth: validated.useCustomWidth ? validated.customWidth : "",
        tileSize: validated.tileSize || 0,
        compression: validated.compression,
        ttaMode: validated.ttaMode,
      });

      const child = spawn(this.config.backendPath, args, {
        shell: false,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      job.process = child;
      this.emit(job, { type: "started" });

      createInterface({ input: child.stderr }).on("line", (line) => {
        this.recordDiagnostic(
          job,
          `stderr: ${this.redact(line, input.path, resultPath)}`,
        );
        const events = parseBackendOutput(line).map((event) =>
          this.redactEvent(event, input.path, resultPath),
        );
        events.forEach((event) => {
          if (event.type === "error") {
            job.reportedError = event.message;
            // Wait for close to deliver a single final error with exit status.
          } else if (event.type !== "log") this.emit(job, event);
        });
      });
      createInterface({ input: child.stdout }).on("line", (line) => {
        const message = this.redact(line.trim(), input.path, resultPath);
        if (message) {
          this.recordDiagnostic(job, `stdout: ${message}`);
          if (/error|failed|out of memory|bad_alloc/i.test(message))
            job.reportedError = message;
        }
      });
      child.on("error", (error) => {
        if (job.status === "error") return;
        job.status = "error";
        job.error =
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "The Upscayl backend executable was not found."
            : "The Upscayl backend could not be started.";
        this.emit(job, { type: "error", message: job.error });
        // close follows error; retain process ownership until then.
      });
      child.on("close", (code, signal) => {
        void this.finishProcess(job, resultPath, resultName, code, signal);
      });

      const info: JobInfo = { id, status: "started" };
      return json(response, 201, info);
    } finally {
      this.creatingJob = false;
    }
  }

  private validateRequest(value: UpscaleRequest): UpscaleRequest {
    if (
      !value ||
      value.input?.type !== "image" ||
      typeof value.input.assetId !== "string"
    ) {
      throw new HttpError(
        400,
        "invalid-request",
        "A valid image asset is required.",
      );
    }
    if (value.outputTargetId) {
      throw new HttpError(
        400,
        "invalid-output-target",
        "Web jobs use server-controlled result storage.",
      );
    }
    if (!(value.model in MODELS)) {
      throw new HttpError(
        400,
        "invalid-model",
        "The selected model is not available.",
      );
    }
    const scale = Number(value.scale);
    if (!Number.isInteger(scale) || scale < 1 || scale > 16) {
      throw new HttpError(
        400,
        "invalid-scale",
        "Scale must be an integer between 1 and 16.",
      );
    }
    if (!(imageFormats as readonly string[]).includes(value.saveImageAs)) {
      throw new HttpError(
        400,
        "invalid-format",
        "The selected output format is not supported.",
      );
    }
    if (!/^$|^-?\d+(?:,\d+)*$/.test(value.gpuId)) {
      throw new HttpError(400, "invalid-gpu", "The GPU identifier is invalid.");
    }
    const compression = Number(value.compression);
    if (
      !Number.isInteger(compression) ||
      compression < 0 ||
      compression > 100
    ) {
      throw new HttpError(
        400,
        "invalid-compression",
        "Compression must be between 0 and 100.",
      );
    }
    const customWidth = Number(value.customWidth);
    if (
      value.useCustomWidth &&
      (!Number.isInteger(customWidth) ||
        customWidth < 1 ||
        customWidth > 100000)
    ) {
      throw new HttpError(
        400,
        "invalid-width",
        "Custom width must be a positive integer.",
      );
    }
    if (
      value.tileSize !== null &&
      (!Number.isInteger(value.tileSize) ||
        value.tileSize < 0 ||
        value.tileSize > 100000)
    ) {
      throw new HttpError(
        400,
        "invalid-tile-size",
        "Tile size must be a non-negative integer.",
      );
    }
    return {
      ...value,
      outputTargetId: null,
      gpuId: value.gpuId,
      compression: String(compression),
      customWidth: value.useCustomWidth ? String(customWidth) : "",
      overwrite: Boolean(value.overwrite),
      noImageProcessing: Boolean(value.noImageProcessing),
      useCustomWidth: Boolean(value.useCustomWidth),
      ttaMode: Boolean(value.ttaMode),
      copyMetadata: Boolean(value.copyMetadata),
    };
  }

  private async validateResources(model: string) {
    try {
      await access(this.config.backendPath);
    } catch {
      throw new HttpError(
        503,
        "backend-missing",
        "The Upscayl backend executable is unavailable. Check UPSCAYL_WEB_BACKEND.",
      );
    }
    try {
      await Promise.all([
        access(path.join(this.config.modelsPath, `${model}.bin`)),
        access(path.join(this.config.modelsPath, `${model}.param`)),
      ]);
    } catch {
      throw new HttpError(
        503,
        "models-missing",
        "The selected model files are unavailable. Check UPSCAYL_WEB_MODELS_DIR.",
      );
    }
  }

  private async finishProcess(
    job: StoredJob,
    resultPath: string,
    resultName: string,
    code: number | null,
    signal: NodeJS.Signals | null,
  ) {
    if (job.cancellationTimer) clearTimeout(job.cancellationTimer);
    job.exitCode = code;
    job.exitSignal = signal;
    this.recordDiagnostic(
      job,
      `Backend exit: code=${code ?? "none"}, signal=${signal ?? "none"}.`,
    );
    if (job.status === "cancelling") {
      job.status = "cancelled";
      this.emit(job, { type: "cancelled" });
      this.finishJob(job);
      return;
    }
    if (job.status === "error") {
      this.finishJob(job);
      return;
    }
    if (code !== 0 || job.reportedError) {
      job.status = "error";
      job.error = backendFailure(
        code,
        signal,
        job.reportedError || job.diagnostics.slice(-5).join("\n"),
      );
      this.emit(job, { type: "error", message: job.error });
      this.finishJob(job);
      return;
    }
    try {
      await access(resultPath);
      if (job.request.copyMetadata) {
        try {
          await copyMetadata(job.input.path, resultPath);
        } catch {
          this.emit(job, {
            type: "warning",
            code: "metadata",
            message:
              "The image was upscaled, but its metadata could not be copied.",
          });
        }
      }
      const result: StoredJob["result"] = {
        id: job.id,
        name: resultName,
        previewUrl: `/api/jobs/${job.id}/result`,
        downloadUrl: `/api/jobs/${job.id}/result?download=1`,
        path: resultPath,
        mimeType: outputMimeTypes[job.request.saveImageAs],
      };
      job.result = result;
      job.status = "complete";
      this.emit(job, { type: "complete", result: this.publicResult(result) });
    } catch {
      job.status = "error";
      job.error = "The backend exited without producing a result image.";
      this.emit(job, { type: "error", message: job.error });
    }
    this.finishJob(job);
  }

  private cancelJob(response: ServerResponse, job: StoredJob) {
    if (job.status !== "started" || !job.process) {
      throw new HttpError(
        409,
        "job-not-running",
        "The requested job is not running.",
      );
    }
    job.status = "cancelling";
    this.emit(job, { type: "cancellation-requested" });
    const signalled = job.process.kill("SIGTERM");
    if (!signalled) {
      job.status = "error";
      job.error = "The running backend could not be signalled.";
      this.emit(job, { type: "error", message: job.error });
      this.finishJob(job);
      throw new HttpError(500, "cancel-failed", job.error);
    }
    job.cancellationTimer = setTimeout(() => {
      if (job.status === "cancelling") job.process?.kill("SIGKILL");
    }, 5000);
    return json(response, 202, { id: job.id, status: "cancelling" });
  }

  private subscribeToJob(
    request: IncomingMessage,
    response: ServerResponse,
    job: StoredJob,
  ) {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(": connected\n\n");
    const lastEventId = Number(request.headers["last-event-id"] || 0);
    job.events
      .filter((entry) => entry.id > lastEventId)
      .forEach((entry) => this.writeEvent(response, entry));
    if (["cancelled", "complete", "error"].includes(job.status)) {
      response.end();
      return;
    }
    job.subscribers.add(response);
    const keepAlive = setInterval(
      () => response.write(": keep-alive\n\n"),
      15000,
    );
    request.on("close", () => {
      clearInterval(keepAlive);
      job.subscribers.delete(response);
    });
  }

  private emit(job: StoredJob, event: JobEvent) {
    const entry = { id: job.nextEventId++, event };
    job.events.push(entry);
    // Bound replay as well as diagnostics; active SSE subscribers still receive all events.
    if (job.events.length > 256) job.events.shift();
    job.subscribers.forEach((subscriber) => this.writeEvent(subscriber, entry));
  }

  private writeEvent(
    response: ServerResponse,
    entry: { id: number; event: JobEvent },
  ) {
    response.write(`id: ${entry.id}\ndata: ${JSON.stringify(entry.event)}\n\n`);
  }

  private finishJob(job: StoredJob) {
    if (this.activeJobId === job.id) this.activeJobId = null;
    job.process = undefined;
    job.subscribers.forEach((subscriber) => subscriber.end());
    job.subscribers.clear();
  }

  private requireJob(id: string) {
    const job = this.jobs.get(id);
    if (!job)
      throw new HttpError(
        404,
        "missing-job",
        "The requested job was not found or has expired.",
      );
    return job;
  }

  private publicJob(job: StoredJob) {
    return {
      id: job.id,
      status: job.status,
      result: job.result ? this.publicResult(job.result) : undefined,
      error: job.error,
      exitCode: job.exitCode,
      exitSignal: job.exitSignal,
      diagnostics: job.diagnostics,
    };
  }

  private publicAsset(asset: StoredAsset): ImageAsset {
    return {
      id: asset.id,
      name: asset.name,
      previewUrl: asset.previewUrl,
      width: asset.width,
      height: asset.height,
    };
  }

  private publicResult(result: NonNullable<StoredJob["result"]>): ResultAsset {
    return {
      id: result.id,
      name: result.name,
      previewUrl: result.previewUrl,
      downloadUrl: result.downloadUrl,
    };
  }

  private resultName(inputName: string, request: UpscaleRequest) {
    const base = path.parse(inputName).name;
    const size = request.useCustomWidth
      ? `${request.customWidth}px`
      : `${request.scale}x`;
    return safeName(
      `${base}_upscayl_${size}_${request.model}.${request.saveImageAs}`,
    );
  }

  private redact(value: string, inputPath: string, outputPath: string) {
    return value
      .split(inputPath)
      .join("[input image]")
      .split(outputPath)
      .join("[result image]")
      .split(this.config.modelsPath)
      .join("[models]")
      .split(this.config.backendPath)
      .join("[backend]")
      .split(this.config.dataRoot)
      .join("[storage]")
      .replace(/(?:\/[^\s"'<>:]+){2,}/g, "[server path]");
  }

  private recordDiagnostic(job: StoredJob, message: string) {
    const bounded = message.slice(0, 2000);
    job.diagnostics.push(bounded);
    // At most 64 KiB per job, apart from existing SSE replay history.
    while (Buffer.byteLength(job.diagnostics.join("\n"), "utf8") > 65536)
      job.diagnostics.shift();
    this.emit(job, { type: "log", message: bounded });
  }

  private redactEvent(
    event: JobEvent,
    inputPath: string,
    outputPath: string,
  ): JobEvent {
    if (!("message" in event)) return event;
    return {
      ...event,
      message: this.redact(event.message, inputPath, outputPath),
    } as JobEvent;
  }

  private async sendFile(
    response: ServerResponse,
    filePath: string,
    mimeType: string,
    name: string,
    download: boolean,
  ) {
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile())
      throw new HttpError(
        404,
        "missing-file",
        "The requested file is unavailable.",
      );
    response.writeHead(200, {
      "Content-Type": mimeType,
      "Content-Length": fileStat.size,
      "Cache-Control": "private, no-store",
      ...(download
        ? {
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          }
        : {}),
    });
    createReadStream(filePath).pipe(response);
  }

  private async serveStatic(
    response: ServerResponse,
    pathname: string,
    headOnly: boolean,
  ) {
    const relative =
      pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const normalized = path.normalize(relative);
    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
      throw new HttpError(
        404,
        "not-found",
        "The requested file does not exist.",
      );
    }
    let filePath = path.join(this.config.staticPath, normalized);
    let fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile() && !path.extname(normalized)) {
      filePath = path.join(this.config.staticPath, "index.html");
      fileStat = await stat(filePath).catch(() => null);
    }
    if (!fileStat?.isFile())
      throw new HttpError(
        404,
        "not-found",
        "The requested file does not exist.",
      );
    response.writeHead(200, {
      "Content-Type":
        staticMimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Content-Length": fileStat.size,
      "Cache-Control":
        path.basename(filePath) === "index.html"
          ? "no-cache"
          : "public, max-age=3600",
    });
    if (headOnly) return response.end();
    createReadStream(filePath).pipe(response);
  }

  private handleError(response: ServerResponse, error: unknown) {
    if (response.headersSent) {
      response.end();
      return;
    }
    if (error instanceof HttpError) {
      json(response, error.status, {
        error: { code: error.code, message: error.message },
      });
      return;
    }
    console.error(error);
    json(response, 500, {
      error: {
        code: "internal-error",
        message: "The server could not complete the request.",
      },
    });
  }
}
