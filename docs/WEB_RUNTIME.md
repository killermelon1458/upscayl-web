# Upscayl Web prototype

Upscayl Web is an early self-hosted runtime that serves the existing Upscayl renderer in a browser and runs jobs on the server's local Upscayl backend. It supports image upload, built-in models, normal single-image upscaling, sequential browser batches, live progress over Server-Sent Events, cancellation, result previews, individual downloads, and batch ZIP downloads. Single-image results retain the existing comparison/lens views.

Custom models, authentication, retention policies, and production hardening are not implemented yet. [Docker deployment](DOCKER.md) packages this same runtime with the bundled Linux backend and models. Put an authentication-aware reverse proxy or private network in front of the server before exposing it beyond a trusted network.

## Prerequisites

- Node.js and npm compatible with the repository lockfile
- A Linux/Vulkan host supported by `upscayl-bin`
- The Upscayl backend executable and built-in model files

The repository includes the Linux backend and models under `resources/`. They are used by default when running from a source checkout.

## Run from source

```sh
npm ci
npm run web
```

The combined server listens on `127.0.0.1:3000` by default and serves both the static renderer and `/api` routes. To make it reachable from another device, explicitly set `UPSCAYL_WEB_HOST` to an appropriate interface, such as `0.0.0.0`, and provide network access controls suitable for the deployment.

For separate build/start steps:

```sh
npm run web:build
npm run web:start
```

## Configuration

| Variable                      | Default                                            | Purpose                                                        |
| ----------------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `UPSCAYL_WEB_HOST`            | `127.0.0.1`                                        | Listen address. Public binding is opt-in.                      |
| `UPSCAYL_WEB_PORT`            | `3000`                                             | HTTP listen port.                                              |
| `UPSCAYL_WEB_DATA_DIR`        | `.upscayl-web-data` in the project root            | Server-managed uploads and job results.                        |
| `UPSCAYL_WEB_BACKEND`         | Platform backend under `resources/<platform>/bin/` | Absolute or relative path to the backend executable.           |
| `UPSCAYL_WEB_MODELS_DIR`      | `resources/models`                                 | Directory containing built-in `.bin` and `.param` model pairs. |
| `UPSCAYL_WEB_UPLOAD_LIMIT_MB` | `50`                                               | Maximum uploaded image size in MiB.                            |
| `UPSCAYL_WEB_STATIC_DIR`      | `renderer/out`                                     | Built static renderer directory.                               |
| `UPSCAYL_WEB_PROJECT_ROOT`    | Detected source checkout root                      | Override the root used for default resource paths.             |

Relative configured paths are resolved against the process working directory. Uploaded filenames are retained only as display/download metadata; storage paths use server-generated IDs.

## Logs and large outputs

Settings → Copy Logs uses the Clipboard API when available, then attempts a browser copy fallback (including on LAN HTTP). If neither works, the logs remain in a selectable read-only text area with a failure message. Success is displayed only after a copy operation succeeds.

Web jobs record the model, scale, input dimensions when header metadata is available, output format/custom width, stdout/stderr, and backend exit code or signal. A redacted diagnostic tail (up to 64 KiB, with individual entries capped at 2,000 characters) is available in the existing job-status endpoint and streamed to the renderer logs. SSE replay is limited to the latest 256 events. These records remain in memory and disappear on restart; they are not persistent job history.

The browser asks for confirmation before starting an output estimated to need at least 1 GiB for one uncompressed RGBA buffer. This is an advisory threshold, not a resolution limit or a prediction of total host/GPU memory requirements. For example, 4000 × 3000 at 16× requests 64,000 × 48,000 pixels and about 11.4 GiB for one such buffer. Backend processing may need substantially more memory, and individual image encoders may have their own limits. Lower scale or custom width can reduce final-output memory; a smaller tile size primarily helps inference memory.

An exit signal does not by itself identify the cause. `SIGSEGV` means a backend crash, while `SIGKILL` can indicate memory pressure or an external termination. Explicit backend memory/dimension messages are retained where provided; neither signal is reported as proof of an out-of-memory failure.

## Browser batches and failure recovery

Enable **Batch images** in the Upscayl sidebar, then **Add images** using the multiple-file picker. Dropping multiple files into the single-image view switches to the batch view; dropping files into the batch view adds them. Clipboard image import also uses the batch upload path when batch mode is selected.

The list shows each filename, uploaded input thumbnail, upload status, and a Remove action. Add more images, remove individual images, or explicitly Clear selection before processing. At most 100 images may be selected in one batch. Uploads are performed sequentially, using the existing per-image size/type checks. One failed upload does not discard the successful uploads; it has its own error and Retry upload action. Processing includes successfully uploaded entries only. Selecting the same filename twice creates distinct uploaded assets rather than overwriting an earlier input.

Choose the model, scale/custom width, format, compression, GPU ID, tile size, TTA, and metadata options using the existing sidebar controls, then **Start batch**. The server captures one validated settings snapshot for the entire batch. Controls can still be edited while processing, but those changes do not alter queued items or retries of that batch. The captured model/scale/format are displayed above the list.

Only one backend job runs at a time, in selection order. The batch reserves the execution slot until it stops: competing single-job or batch creation returns HTTP 409. Each item displays Queued, Processing with percentage, Complete, Failed, or Cancelled. Overall progress averages item progress, counting terminal items (including failed/cancelled) as handled; 100% means traversal has finished, not that every image succeeded.

An individual processing failure preserves its input and diagnostics, retains successful results, and allows the remaining queued images to run. **Show diagnostics** retrieves the existing redacted per-job diagnostic log. **Retry image** or **Retry failed / cancelled** reuses the original uploaded assets and the original captured batch settings, without touching successful results. Starting a new batch uses current sidebar settings instead.

**Cancel batch** signals only its active job, prevents further queued items from starting, and leaves completed results and uploaded inputs available. The batch remains cancelling until the active process exits; it does not claim cancellation is complete on request receipt. Cancellation during job creation is also handled. Cancelled items can subsequently be retried.

Each complete item has a thumbnail linking to its result preview and an individual **Download**. Once the batch stops, **Download All ZIP** includes successful results only (including after partial failure or cancellation). Filenames retain the output extension and use sanitized meaningful names; duplicates receive numbered suffixes. ZIP entries contain no server paths. Archiver streams lazy file inputs directly to the response with store-level compression; there is no temporary ZIP artifact and outputs are not all buffered in server memory. Disconnecting the download destroys the archive stream.

A failed single-image job now preserves its selected input, dimensions, and settings while clearing result/progress state. Change settings and retry without uploading again. Cancelling a file picker or attempting an unsupported replacement does not discard the previously valid input. Web errors do not direct users to a desktop output folder they cannot select.

## API

Existing upload/single-job/result routes remain available.

`GET /api/health` is a lightweight HTTP liveness endpoint returning `{ "status": "ok" }`; it does not check GPU inference or resources.

Batch routes are:

| Method | Route                       | Behavior                                                                                                                                                                                                 |
| ------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/batches`              | Create a sequential run: `{ assetIds: string[], settings: Omit<UpscaleRequest, "input"> }`. Requires 1–100 distinct existing asset IDs and validated shared settings. Returns 201 with a batch snapshot. |
| GET    | `/api/batches/:id`          | Current snapshot, including captured settings, ordered items, progress, per-item job IDs/errors/results, and ZIP URL.                                                                                    |
| GET    | `/api/batches/:id/events`   | SSE: current snapshot on connect, structured item job events and updated snapshots. Closes when the run completes/cancels. Reconnects recover the latest state, not complete event history.              |
| POST   | `/api/batches/:id/cancel`   | Request cancellation; returns 202 with the current snapshot. Already stopped/cancelling batches are unchanged.                                                                                           |
| POST   | `/api/batches/:id/retry`    | `{ itemIds: string[] }` identifying failed/cancelled items; returns 202. Reuses uploaded inputs and original settings; requires the execution slot to be idle.                                           |
| GET    | `/api/batches/:id/download` | Stream successful outputs as a ZIP after the run stops. Returns 409 while running/cancelling, or 404 if there are no successful outputs.                                                                 |

Individual results use `/api/jobs/:jobId/result?download=1`; diagnostics remain available through `GET /api/jobs/:jobId`. A batch is orchestration over the existing single-image executor, not a second GPU processing engine. Item events wrap the existing semantic `JobEvent` with an item ID. Paths are resolved only on the server; no arbitrary filesystem/model/executable paths are accepted from clients.

## Validation and manual QA

```sh
npm run tsc
npx tsc --project renderer/tsconfig.json --noEmit --pretty false
npm run web:test
npm run web:build
```

`web:test` covers settings capture, sequential execution, partial failure/retry, cancellation (including during job creation), HTTP busy reservation, SSE completion, and ZIP contents/names. Its controlled backend copies a small input on the CPU; these regression tests do **not** verify GPU inference.

During development on a Linux/Vulkan host, headless Chromium was exercised against the production renderer using 32×32, 40×36, and 48×40 PNGs with Upscayl Lite. Real 2× batches, a single 3× retry, individual downloads, decoded ZIP contents, controlled middle-item failure/exit 42, diagnostics, retry without reupload, cancellation, and recovery were checked. Multi-file picker selection, add/remove, duplicate filenames, synthetic multi-file drop, independent unsupported-upload handling, progress/SSE lifecycle, edits to scale/output format during execution, and single-image slider/lens pointer interaction were checked. No JavaScript exceptions or terminal reconnect loops were observed; the intentionally unsupported upload produced HTTP 415. Controlled failure/delay injection used a test-only configured backend wrapper, not a product API. A separate API test cancelled real inference after progress on a 512×512 image at 2× with 32-pixel tiles/TTA; the preceding result remained complete, the queued item never started, and a subsequent single GPU job succeeded. No resource-exhaustion workload was run.

For LAN manual QA, choose an unused port, for example:

```sh
UPSCAYL_WEB_HOST=0.0.0.0 UPSCAYL_WEB_PORT=3004 npm run web:start
```

Open `http://<host-LAN-IP>:3004`. Test three small images, add/remove, change settings during processing, individual downloads and ZIP, then cancel a longer batch and retry cancelled items. Check physical/native file chooser interactions, real clipboard paste, touch/mobile layouts, keyboard navigation, and behavior during network interruptions. Automated DOM drops are not a substitute for physical OS drag/drop. Electron GUI processing must be tested separately on a graphical desktop.

## Prototype limitations

- Jobs and asset metadata are held in memory, so a server restart makes existing stored files inaccessible through the API.
- Only one GPU job/run may run at a time; a batch reserves this slot across its sequential item jobs. Competing job/batch creation returns a busy error, rather than entering a multi-user scheduler.
- Uploaded assets and results are not expired automatically.
- There is no authentication or authorization.
- Web batches support normal single-image processing with shared settings, not per-image settings, folders, ZIP uploads, or parallel inference. Batch results have thumbnails/full-image links, not an embedded per-item comparison editor. Desktop folder batch, double-upscale, native folder, updater, notification, and custom-model controls remain Electron-only.
- Selection/batch state lives in browser memory and is lost on page reload. There is no persistent batch manifest or resume-across-restart feature. Retrying uses the captured settings; changing settings requires starting a new batch.
- Cancellation sends `SIGTERM` to the job-owned process and escalates to `SIGKILL` after five seconds; cancellation is reported complete only after process exit.
