export function backendFailure(
  code: number | null,
  signal: NodeJS.Signals | null,
  reportedError?: string,
) {
  const status = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
  let reason = "The Upscayl backend failed";
  if (
    /out of memory|bad_alloc|allocation failed|cannot allocate|VK_ERROR_OUT_OF_(HOST|DEVICE)_MEMORY/i.test(
      reportedError || "",
    )
  ) {
    reason =
      "The backend reported a memory allocation failure. Try a lower scale, custom width, or smaller tile size";
  } else if (
    /too large|dimensions|image size|pixel limit|maximum.*(width|height)|unsupported.*size/i.test(
      reportedError || "",
    )
  ) {
    reason =
      "The backend reported an image dimension or size limitation. Try a lower scale or custom width";
  } else if (signal === "SIGKILL") {
    reason =
      "The backend was killed. Memory pressure or an external stop may be responsible; SIGKILL alone does not establish the cause";
  }
  if (signal === "SIGSEGV") {
    reason =
      "The backend crashed with a segmentation fault. Large outputs, memory pressure, or a backend bug may be involved; the signal alone does not establish the cause. Try a lower scale or custom width";
  }
  return `${reason} (${status}).${reportedError ? ` Backend: ${reportedError.slice(-1500)}` : " See Logs for job details."}`;
}
