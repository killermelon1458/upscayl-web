import getModelScale from "./check-model-scale";
import { ImageFormat } from "./image-formats";

export type SingleImageArguments = {
  inputPath: string;
  outputPath: string;
  modelsPath: string;
  model: string;
  scale: string;
  gpuId: string;
  saveImageAs: ImageFormat;
  customWidth: string;
  tileSize: number;
  compression: string;
  ttaMode: boolean;
};

export const buildSingleImageArguments = ({
  inputPath,
  outputPath,
  modelsPath,
  model,
  scale,
  gpuId,
  saveImageAs,
  customWidth,
  tileSize,
  compression,
  ttaMode,
}: SingleImageArguments) => {
  const includeScale = getModelScale(model) !== scale && !customWidth;

  return [
    "-i",
    inputPath,
    "-o",
    outputPath,
    includeScale ? "-s" : "",
    includeScale ? scale : "",
    "-m",
    modelsPath,
    "-n",
    model,
    gpuId ? "-g" : "",
    gpuId || "",
    "-f",
    saveImageAs,
    customWidth ? "-w" : "",
    customWidth || "",
    "-c",
    compression,
    tileSize ? "-t" : "",
    tileSize ? tileSize.toString() : "",
    ttaMode ? "-x" : "",
  ].filter(Boolean);
};
