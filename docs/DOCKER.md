# Upscayl Web in Docker

The image runs the same production static renderer and Node HTTP/SSE server as the bare-metal web runtime. It bundles the repository's Linux `upscayl-bin` and built-in models; a host Upscayl/Flatpak installation and source bind mount are not needed. The bundled backend requires **Linux x86-64 (amd64)**. This is deployment packaging of the existing prototype, not production hardening of its API.

## Prerequisites and GPU access

- Docker Engine with Docker Compose v2 on Linux amd64.
- A Vulkan-capable NVIDIA GPU and working host NVIDIA driver.
- NVIDIA Container Toolkit already installed and configured for Docker. Follow its official installation instructions; this project does not configure your host.

Compose requests NVIDIA GPUs through Docker device reservations, not privileged mode. `NVIDIA_DRIVER_CAPABILITIES=graphics,utility,compute` includes **graphics**, which is required for Vulkan driver injection. The image supplies `libvulkan1`, the NVIDIA driver's X11/EGL library dependencies (no display server is needed), a Vulkan 1.3 ICD descriptor pointing to `libGLX_nvidia.so.0`, and an EGL vendor descriptor. These descriptors do not bundle a NVIDIA driver. The matching NVIDIA userspace driver is supplied by the host toolkit. A healthy HTTP server does **not** demonstrate GPU access or successful inference. Check job diagnostics for the actual GPU name: software Vulkan/llvmpipe is not GPU validation.

References: [Compose GPU reservations](https://docs.docker.com/compose/how-tos/gpu-support/), [NVIDIA driver capabilities](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/docker-specialized.html).

AMD/Intel Docker inference is not validated. These typically need appropriate Mesa Vulkan drivers inside the image, `/dev/dri` devices and matching render-group permissions instead of NVIDIA reservations. Those drivers and mappings are not provided by this NVIDIA example. ARM hosts cannot use the bundled x86-64 backend. Do not enable privileged mode or mount the Docker socket to work around driver access.

## Build and start

From a clone of this repository:

```sh
docker compose -f compose.web.yaml build
docker compose -f compose.web.yaml up -d
```

If Docker lacks the buildx plugin and Compose cannot build, the existing classic builder can be used with `DOCKER_BUILDKIT=0 docker compose -f compose.web.yaml build`. Both the standalone Docker build and this Compose fallback were exercised; no host Docker reconfiguration is required.

Open `http://localhost:3000`. The default **host** binding is loopback; port 3000 must be unused. Choose another host port and deliberately allow LAN access with:

```sh
UPSCAYL_WEB_BIND_ADDRESS=0.0.0.0 UPSCAYL_WEB_HOST_PORT=3004 \
  docker compose -f compose.web.yaml up -d
```

Open `http://<server-LAN-IP>:3004` from another device. Keep these same variables for subsequent Compose operations (or use a private local `.env`, which must not be committed). Inside the container the application binds `0.0.0.0:3000`. Docker exposes only that application port; HTTPS is an external reverse-proxy responsibility.

There is **no built-in authentication**. Anyone who can reach the service can use its GPU and access known resources. Use a trusted network/VPN or authentication-aware reverse proxy before Internet exposure. Upload limits are not quotas, and retained files can fill the data volume.

For an explicit standalone image build:

```sh
docker build --platform linux/amd64 -f Dockerfile.web \
  --build-arg VCS_REF="$(git rev-parse HEAD)" -t upscayl-web:local .
```

## Configuration and storage

All existing web configuration variables remain supported:

| Variable | Image default |
| --- | --- |
| `UPSCAYL_WEB_HOST` | `0.0.0.0` |
| `UPSCAYL_WEB_PORT` | `3000` |
| `UPSCAYL_WEB_PROJECT_ROOT` | `/app` |
| `UPSCAYL_WEB_DATA_DIR` | `/data` |
| `UPSCAYL_WEB_BACKEND` | `/app/resources/linux/bin/upscayl-bin` |
| `UPSCAYL_WEB_MODELS_DIR` | `/app/resources/models` |
| `UPSCAYL_WEB_STATIC_DIR` | `/app/renderer/out` |
| `UPSCAYL_WEB_UPLOAD_LIMIT_MB` | `50` (MiB per image) |

Compose additionally accepts `UPSCAYL_WEB_BIND_ADDRESS`, `UPSCAYL_WEB_HOST_PORT`, and the upload-limit variable for substitution. Other app overrides must be added to the service's `environment`; changing internal port also requires changing port mapping. Model/backend overrides refer to container paths, never browser-supplied paths.

The named `upscayl-data` volume stores opaque-ID uploads under `assets/` and output files under `jobs/`. Application files are root-owned; the app runs as the image's `node` user (UID/GID 1000). A new named volume inherits `/data` ownership. If replacing it with a bind mount, prepare that directory to be writable by UID 1000; do not mount unrelated host directories.

Files survive container restart/recreation, but **asset/job/batch metadata is in memory**. Restart makes old files inaccessible through the API; it does not resume batches or re-index results. No automatic expiry/retention is implemented. Account for orphaned data and disk use when operating long-term. Do not delete live job data.

`GET /api/health` returns `{ "status": "ok" }` while the HTTP server responds. The image health check tests only this endpoint, not drivers/models/inference. Compose drops Linux capabilities, enables no-new-privileges, and uses an init process. There are no arbitrary host mounts, privileged mode, or Docker socket access. GPU device/driver injection is handled by the NVIDIA toolkit.

## Operation

```sh
docker compose -f compose.web.yaml ps
docker compose -f compose.web.yaml logs -f --tail=100
docker compose -f compose.web.yaml restart
docker compose -f compose.web.yaml stop
docker compose -f compose.web.yaml down
```

`down` removes this project's containers/network but keeps the data volume. Do not use `down -v` unless intentionally deleting all application data. Stop/cancel active jobs before restart; in-memory results will no longer be retrievable afterward.

To update, review/pull your intended source revision, then rebuild and recreate:

```sh
docker compose -f compose.web.yaml build --pull
docker compose -f compose.web.yaml up -d
```

Changes to this local image do not publish anything to a registry. Base/package dependencies are installed inside build stages; no host npm installation is needed. Only Archiver and ExifTool runtime dependency trees, compiled server/shared modules, static renderer, backend/models, and notices are copied into the final image. Electron and build tools are not runtime dependencies.

## Resource notices and redistribution

The image retains `LICENSE` (Upscayl AGPL-3.0), `Real-ESRGAN_LICENSE.txt` (BSD-3-Clause, Xintao Wang), and upstream `README.md` with model/author credits under `/app`. This document is included at `/app/notices/DOCKER.md`. Dependency license files remain with their packages; Debian package notices remain in the runtime image. Upstream identifies [upscayl-ncnn](https://github.com/upscayl/upscayl-ncnn) as AGPLv3. Preserve these notices and provide the corresponding source for any distributed/modified image; the source OCI label identifies this fork, and `VCS_REF` can identify its revision.

Poppins is under the SIL Open Font License 1.1. Its [upstream notice](https://github.com/google/fonts/blob/main/ofl/poppins/OFL.txt) is retained in `docs/licenses/Poppins-OFL.txt` and `/app/notices/licenses/Poppins-OFL.txt`.

Upstream credits Helaman (High Fidelity/HFA2k), Foolhardy (Remacri), and Kim2091 (UltraSharp/UltraMix). The checkout does **not** provide separate per-model license files alongside the weights or separate branding permissions. This packaging retains existing credits; it does not establish missing redistribution rights. Verify model weights, icons and backend corresponding-source provenance before publishing images broadly. Branding/trademark permission is separate from source licensing. No registry publication is part of this implementation.

## Validate a deployment

Upload a small image, use Upscayl Lite at 2×, observe progress, download and open the result. Inspect job diagnostics for your real GPU. Then process 2–3 small images, verify sequential progress, individual downloads and Download All ZIP. Restart only after saving results, check health, verify a new upload/job works, and expect old API IDs to return not found. See [the runtime guide](WEB_RUNTIME.md) for batch/retry/cancellation semantics and current limitations.

### Validated checkpoint

This deployment was tested with Linux amd64, Docker Engine 29.1.3, Compose 2.29.2, NVIDIA driver 580.159.03 and a **GeForce RTX 2070 SUPER**. Backend diagnostics named that GPU (device 0), not software Vulkan. The final non-root container passed single 32×24 → 64×48 inference, SSE progress, metadata copying, sequential three-image batches, individual downloads and streamed ZIP downloads. ZIP entries were checked for unique meaningful names/no paths and every PNG was decoded at the expected dimensions. A restart preserved data-file hashes, discarded in-memory API metadata as documented, and allowed new GPU single/batch jobs.

Initial headless checks exercised DOM presence, file selection, image decoding and processing, but did **not** assert computed styles or layout. Manual QA subsequently exposed a broken container stylesheet despite successful HTML/CSS/JS responses. Those original checks were insufficient to establish visual correctness.

### Production styling regression and checks

The Docker build originally omitted root `postcss.config.js` and `tailwind.config.js`. Next exported syntactically valid CSS (7,301 bytes), but it retained unprocessed `@tailwind`/`@apply` directives and lacked generated layout/theme rules. Both configurations are now copied before building the shared renderer; no separate UI build or static-server rewrite is used. A clean no-cache rebuild produced 159,614 bytes of CSS, identical in SHA-256 to the fresh bare-metal production build. `components.json` is component-generator metadata, not a renderer build input.

The image build now runs a production-export check that rejects unprocessed directives, missing generated flex/position/button/theme selectors, suspiciously small stylesheets and missing referenced assets. Run the same check against an **actual running container URL**:

```sh
node web/tests/check-production-assets.cjs http://127.0.0.1:3000
```

It fetches exported HTML, all referenced Next CSS/JS and stylesheet font/media URLs, checking status, CSS/JS MIME types and actual generated rules—not merely that CSS exists. This check rejected the original broken image.

For browser layout regression, launch a disposable Chromium profile (choose unused ports and stop that browser afterward):

```sh
chromium --headless --disable-gpu --remote-debugging-port=9228 \
  --user-data-dir=/tmp/upscayl-browser-qa about:blank
# In another terminal, with Node 22+:
node web/tests/check-production-layout.mjs http://127.0.0.1:3000 http://127.0.0.1:9228
```

The browser check uses the production container, not a development server. It tests 1920×1080 desktop, 390×844 phone portrait and 844×390 phone landscape. Assertions cover the opaque dark body background, flex application shell, 350px sidebar, bounded 56px logo, main/drop-region geometry, styled batch panel, failed asset requests and JavaScript exceptions. Phone checks operate the existing sidebar-collapse button to expose full-width single/batch content; a 350px open sidebar still consumes most of a portrait viewport, as in the existing renderer. No mobile layout redesign is included.

These viewport checks passed against the corrected image, as did a browser file-picker upload, real 2× GPU inference, input/result previews and a decoded browser download. Small three-image GPU batches, individual downloads and ZIP decoding also passed via the container API. All 12 HTML-referenced JS assets, the stylesheet and six font/media assets returned successfully. Physical drag/drop/touch, lens behavior inside Docker, AMD/Intel deployment and Electron GUI startup remain untested in this correction. Existing TypeScript checks, four HTTP/SSE/batch tests and production builds passed. The tests' controlled backend is CPU-only; separate inference checks establish GPU operation.
