import { ImageAsset, UpscaleRequest } from "./types/runtime";

export function outputSizeWarning(input: ImageAsset, request: UpscaleRequest) {
  if (!input.width || !input.height) return undefined;
  const width = request.useCustomWidth
    ? Number(request.customWidth)
    : input.width * Number(request.scale);
  const height = request.useCustomWidth
    ? Math.round((input.height * width) / input.width)
    : input.height * Number(request.scale);
  const bytes = width * height * 4;
  // Advisory only: one RGBA buffer exceeding 1 GiB is already substantial.
  if (bytes < 1024 ** 3) return undefined;
  return `Requested output: ${width.toLocaleString("en-US")} × ${height.toLocaleString("en-US")} pixels. One uncompressed RGBA buffer alone would require ${(bytes / 1024 ** 3).toFixed(1)} GiB; processing can require considerably more memory. This may exceed host memory or image encoder limits. Consider a lower scale or custom width.`;
}
