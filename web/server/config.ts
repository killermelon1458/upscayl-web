import { existsSync } from "fs";
import path from "path";

export type WebServerConfig = {
  host: string;
  port: number;
  dataRoot: string;
  backendPath: string;
  modelsPath: string;
  staticPath: string;
  uploadLimitBytes: number;
  projectRoot: string;
};

const positiveInteger = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}".`);
  }
  return parsed;
};

const findProjectRoot = () => {
  const configured = process.env.UPSCAYL_WEB_PROJECT_ROOT;
  if (configured) return path.resolve(configured);

  const fromCompiledServer = path.resolve(__dirname, "../../..");
  if (existsSync(path.join(fromCompiledServer, "package.json"))) {
    return fromCompiledServer;
  }
  return process.cwd();
};

export const getWebServerConfig = (): WebServerConfig => {
  const projectRoot = findProjectRoot();
  const platformDirectory =
    process.platform === "win32"
      ? "win"
      : process.platform === "darwin"
        ? "mac"
        : "linux";
  const executable =
    process.platform === "win32" ? "upscayl-bin.exe" : "upscayl-bin";

  return {
    host: process.env.UPSCAYL_WEB_HOST || "127.0.0.1",
    port: positiveInteger(process.env.UPSCAYL_WEB_PORT, 3000),
    dataRoot: path.resolve(
      process.env.UPSCAYL_WEB_DATA_DIR ||
        path.join(projectRoot, ".upscayl-web-data"),
    ),
    backendPath: path.resolve(
      process.env.UPSCAYL_WEB_BACKEND ||
        path.join(
          projectRoot,
          "resources",
          platformDirectory,
          "bin",
          executable,
        ),
    ),
    modelsPath: path.resolve(
      process.env.UPSCAYL_WEB_MODELS_DIR ||
        path.join(projectRoot, "resources", "models"),
    ),
    staticPath: path.resolve(
      process.env.UPSCAYL_WEB_STATIC_DIR ||
        path.join(projectRoot, "renderer", "out"),
    ),
    uploadLimitBytes:
      positiveInteger(process.env.UPSCAYL_WEB_UPLOAD_LIMIT_MB, 50) *
      1024 *
      1024,
    projectRoot,
  };
};
