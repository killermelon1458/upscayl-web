# Upscayl Web prototype

Upscayl Web is an early self-hosted runtime that serves the existing Upscayl renderer in a browser and runs single-image jobs on the server's local Upscayl backend. It currently supports image upload, built-in models, normal single-image upscaling, live progress over Server-Sent Events, cancellation, result preview/comparison, and browser download.

Batch jobs, custom models, authentication, containers, retention policies, and production hardening are not implemented yet. Put an authentication-aware reverse proxy or private network in front of the server before exposing it beyond a trusted network.

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

## Prototype limitations

- Jobs and asset metadata are held in memory, so a server restart makes existing stored files inaccessible through the API.
- Only one GPU job may run at a time; additional job creation returns a busy error.
- Uploaded assets and results are not expired automatically.
- There is no authentication or authorization.
- The web runtime supports only normal single-image jobs. Desktop batch, double-upscale, native folder, updater, notification, and custom-model controls remain Electron-only.
- Cancellation sends `SIGTERM` to the job-owned process and escalates to `SIGKILL` after five seconds; cancellation is reported complete only after process exit.
