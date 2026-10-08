import { useState } from "react";
import { useImageBatch, useBatchEvents } from "../hooks/use-image-batch";
import { useRuntime } from "@/runtime/runtime-context";

export default function ImageBatchPanel() {
  const {
    selection,
    setSelection,
    batch,
    setBatch,
    busy,
    uploading,
    importFiles,
    select,
    start,
    cancel,
    retry,
    upload,
  } = useImageBatch();
  useBatchEvents();
  const runtime = useRuntime();
  const [diagnostics, setDiagnostics] = useState<Record<string, string>>({});
  const successes =
    batch?.items.filter((item) => item.status === "complete").length || 0;
  const failed =
    batch?.items.filter((item) =>
      ["failed", "cancelled"].includes(item.status),
    ) || [];
  const processingIndex =
    batch?.items.findIndex((item) => item.status === "processing") ?? -1;
  return (
    <main
      className="h-screen w-full overflow-y-auto bg-base-300 p-6"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void importFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <h1 className="mb-2 text-xl font-bold">Batch images</h1>
      <p className="mb-4 text-sm">
        Add images, choose shared settings in the sidebar, then start. Images
        run one at a time.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          className="btn btn-primary"
          disabled={busy || uploading}
          onClick={select}
        >
          Add images
        </button>
        <button
          className="btn btn-secondary"
          disabled={busy || uploading || !selection.some((item) => item.asset)}
          onClick={start}
        >
          Start batch
        </button>
        <button
          className="btn"
          disabled={busy || uploading}
          onClick={() => {
            setSelection([]);
            setBatch(null);
          }}
        >
          Clear selection
        </button>
        {busy && (
          <button
            className="btn btn-error"
            disabled={batch?.status !== "running"}
            onClick={cancel}
          >
            Cancel batch
          </button>
        )}
        {!busy && failed.length > 0 && (
          <button
            className="btn"
            onClick={() => retry(failed.map((item) => item.id))}
          >
            Retry failed / cancelled
          </button>
        )}
        {!busy && successes > 0 && (
          <a className="btn btn-primary" href={batch!.downloadUrl} download>
            Download All ZIP ({successes})
          </a>
        )}
      </div>
      {batch && (
        <section
          className="mb-4 rounded-box bg-base-100 p-4"
          aria-live="polite"
        >
          <p>
            {processingIndex >= 0
              ? `Processing image ${processingIndex + 1} of ${batch.items.length}`
              : batch.status === "cancelled"
                ? "Batch cancelled"
                : batch.status === "complete"
                  ? "Batch finished"
                  : "Preparing batch"}
          </p>
          <p>Overall progress: {Math.round(batch.progress)}%</p>
          <progress
            className="progress progress-primary w-full"
            max={100}
            value={batch.progress}
          />
          <p className="text-sm">
            Captured settings: {batch.settings.model},{" "}
            {batch.settings.useCustomWidth
              ? `${batch.settings.customWidth}px width`
              : `${batch.settings.scale}×`}
            , {batch.settings.saveImageAs.toUpperCase()}. Retries use these
            settings.
          </p>
          <p className="text-sm">
            {successes} successful;{" "}
            {batch.items.filter((item) => item.status === "failed").length}{" "}
            failed. ZIP contains successful results only.
          </p>
        </section>
      )}
      {selection.length === 0 && (
        <p className="rounded-box border border-dashed p-10 text-center">
          Select multiple images or drop them here.
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {selection.map((uploadItem) => {
          const item = batch?.items.find(
            (item) => item.input.id === uploadItem.asset?.id,
          );
          const status =
            uploadItem.status === "uploading"
              ? "Uploading"
              : uploadItem.status === "upload-error"
                ? "Upload failed"
                : item
                  ? {
                      queued: "Queued",
                      processing: `Processing ${Math.round(item.progress)}%`,
                      complete: "Complete",
                      failed: "Failed",
                      cancelled: "Cancelled",
                    }[item.status]
                  : "Uploaded";
          return (
            <li
              key={uploadItem.key}
              className="rounded-box bg-base-100 p-4"
              data-batch-item={uploadItem.key}
            >
              <div className="flex flex-wrap items-center gap-3">
                {uploadItem.asset && (
                  <img
                    className="h-16 w-16 rounded object-contain"
                    src={uploadItem.asset.previewUrl}
                    alt={`Input ${uploadItem.name}`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="break-all font-medium">{uploadItem.name}</p>
                  <p aria-live="polite">{status}</p>
                </div>
                {item?.result && (
                  <>
                    <a
                      href={item.result.previewUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        className="h-16 w-16 rounded object-contain"
                        src={item.result.previewUrl}
                        alt={`Result ${uploadItem.name}`}
                      />
                    </a>
                    <a
                      className="btn btn-primary btn-sm"
                      href={item.result.downloadUrl}
                      download={item.result.name}
                    >
                      Download
                    </a>
                  </>
                )}
                {!busy &&
                  item &&
                  ["failed", "cancelled"].includes(item.status) && (
                    <button
                      className="btn btn-sm"
                      onClick={() => retry([item.id])}
                    >
                      Retry image
                    </button>
                  )}
                {uploadItem.status === "upload-error" && (
                  <button
                    className="btn btn-sm"
                    disabled={busy || uploading}
                    onClick={() => upload(uploadItem)}
                  >
                    Retry upload
                  </button>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy || uploading}
                  onClick={() =>
                    setSelection((items) =>
                      items.filter((old) => old.key !== uploadItem.key),
                    )
                  }
                >
                  Remove
                </button>
              </div>
              {(uploadItem.error || item?.error) && (
                <p role="alert" className="mt-2 break-words text-error">
                  {uploadItem.error || item?.error}
                </p>
              )}
              {item?.status === "failed" && item.jobId && (
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={async () => {
                    try {
                      const lines = await runtime.batch!.getItemDiagnostics(
                        item.jobId!,
                      );
                      setDiagnostics((old) => ({
                        ...old,
                        [item.id]: lines.join("\n"),
                      }));
                    } catch {
                      setDiagnostics((old) => ({
                        ...old,
                        [item.id]: "Diagnostics could not be retrieved.",
                      }));
                    }
                  }}
                >
                  Show diagnostics
                </button>
              )}
              {item && diagnostics[item.id] && (
                <textarea
                  className="mt-2 h-32 w-full bg-base-200 p-2 text-xs"
                  aria-label={`Diagnostics ${uploadItem.name}`}
                  readOnly
                  value={diagnostics[item.id]}
                  onFocus={(event) => event.currentTarget.select()}
                />
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
