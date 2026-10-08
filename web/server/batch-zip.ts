import { ServerResponse } from "http";
import { Readable } from "stream";
import path from "path";

// archiver is a direct dependency; this small type covers only the streaming API used here.
const archiver = require("archiver") as (
  format: string,
  options: object,
) => Readable & {
  file(path: string, options: { name: string }): void;
  finalize(): Promise<void>;
  abort(): void;
};

export function streamBatchZip(
  response: ServerResponse,
  results: Array<{ path: string; name: string }>,
  batchId: string,
) {
  const archive = archiver("zip", { zlib: { level: 0 }, forceZip64: true });
  const names = new Set<string>();
  response.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="upscayl-batch-${batchId}.zip"`,
    "Cache-Control": "no-store",
  });
  archive.on("error", () => response.destroy());
  archive.on("warning", () => response.destroy());
  response.on("close", () => {
    archive.abort();
    archive.destroy();
  });
  archive.pipe(response);
  for (const result of results) {
    const base = path.basename(result.name).replace(/[^a-zA-Z0-9._ -]/g, "_");
    const parsed = path.parse(base);
    let name = base;
    let suffix = 2;
    while (names.has(name.toLowerCase()))
      name = `${parsed.name} (${suffix++})${parsed.ext}`;
    names.add(name.toLowerCase());
    // Lazy file streams: never read all outputs into memory, and no temporary ZIP file.
    archive.file(result.path, { name });
  }
  void archive.finalize().catch(() => response.destroy());
}
