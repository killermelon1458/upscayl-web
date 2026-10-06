import { JobErrorCode, JobEvent } from "./types/runtime";

export const getBackendErrorCode = (
  message: string,
): JobErrorCode | undefined => {
  if (message.includes("Invalid GPU")) return "invalid-gpu";
  if (message.includes("write") || message.includes("read")) {
    return "read-write";
  }
  if (message.includes("tile size")) return "tile-size";
  if (message.includes("uncaughtException")) return "uncaught-exception";
  return undefined;
};

export const parseBackendOutput = (rawOutput: string): JobEvent[] => {
  const message = rawOutput.toString().trim();
  if (!message) return [];

  const errorCode = getBackendErrorCode(message);
  if (errorCode || message.includes("Error") || message.includes("failed")) {
    return [{ type: "error", message, code: errorCode }];
  }

  const events: JobEvent[] = [];
  const percentages = message.match(/\d+(?:\.\d+)?%/g) ?? [];
  const lastPercentage = percentages[percentages.length - 1];
  if (lastPercentage) {
    events.push({
      type: "progress",
      percent: Number(lastPercentage.slice(0, -1)),
      message: lastPercentage,
    });
  }
  if (message.includes("converting") || message.includes("Resizing")) {
    events.push({ type: "phase", phase: "scaling-and-converting" });
  }
  if (message.includes("Successful")) {
    events.push({ type: "phase", phase: "successful" });
  }

  return events.length ? events : [{ type: "log", message }];
};
