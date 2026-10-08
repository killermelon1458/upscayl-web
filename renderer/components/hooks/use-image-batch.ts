import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";
import { useRuntime } from "@/runtime/runtime-context";
import {
  imageBatchBusyAtom,
  imageBatchInfoAtom,
  imageBatchPendingAtom,
  imageBatchSelectionAtom,
  UploadItem,
} from "@/atoms/image-batch-atom";
import {
  selectedModelIdAtom,
  scaleAtom,
  gpuIdAtom,
  saveImageAsAtom,
  compressionAtom,
  overwriteAtom,
  noImageProcessingAtom,
  customWidthAtom,
  useCustomWidthAtom,
  tileSizeAtom,
  ttaModeAtom,
  copyMetadataAtom,
} from "@/atoms/user-settings-atom";
import { useToast } from "@/components/ui/use-toast";
import useLogger from "./use-logger";

export function useImageBatch() {
  const runtime = useRuntime();
  const [selection, setSelection] = useAtom(imageBatchSelectionAtom);
  const [batch, setBatch] = useAtom(imageBatchInfoAtom);
  const setPending = useSetAtom(imageBatchPendingAtom);
  const busy = useAtomValue(imageBatchBusyAtom);
  const { toast } = useToast();
  const model = useAtomValue(selectedModelIdAtom),
    scale = useAtomValue(scaleAtom),
    gpuId = useAtomValue(gpuIdAtom),
    saveImageAs = useAtomValue(saveImageAsAtom);
  const compression = useAtomValue(compressionAtom),
    overwrite = useAtomValue(overwriteAtom),
    noImageProcessing = useAtomValue(noImageProcessingAtom);
  const customWidth = useAtomValue(customWidthAtom),
    useCustomWidth = useAtomValue(useCustomWidthAtom),
    tileSize = useAtomValue(tileSizeAtom),
    ttaMode = useAtomValue(ttaModeAtom),
    copyMetadata = useAtomValue(copyMetadataAtom);
  const uploading = selection.some((item) => item.status === "uploading");
  const report = (error: unknown) =>
    toast({
      title: "Batch processing",
      description: error instanceof Error ? error.message : String(error),
    });

  const upload = async (item: UploadItem) => {
    setSelection((items) =>
      items.map((old) =>
        old.key === item.key
          ? { ...old, status: "uploading", error: undefined }
          : old,
      ),
    );
    try {
      const asset = await runtime.importImage(item.file);
      setSelection((items) =>
        items.map((old) =>
          old.key === item.key ? { ...old, status: "ready", asset } : old,
        ),
      );
    } catch (error) {
      setSelection((items) =>
        items.map((old) =>
          old.key === item.key
            ? {
                ...old,
                status: "upload-error",
                error: error instanceof Error ? error.message : "Upload failed",
              }
            : old,
        ),
      );
    }
  };
  const importFiles = async (files: File[]) => {
    if (busy || uploading) return;
    if (selection.length + files.length > 100) {
      report(new Error("Select at most 100 images per batch."));
      return;
    }
    const items: UploadItem[] = files.map((file) => ({
      key: `${Date.now()}-${Math.random()}`,
      name: file.name,
      file,
      status: "uploading",
    }));
    setSelection((old) => [...old, ...items]);
    // Upload sequentially too, keeping browser/server upload memory bounded.
    for (const item of items) await upload(item);
  };
  const select = async () => {
    if (!runtime.batch || busy || uploading) return;
    await importFiles(await runtime.batch.selectFiles());
  };
  const start = async () => {
    if (!runtime.batch || busy || uploading) return;
    const assetIds = selection
      .filter((item) => item.asset)
      .map((item) => item.asset!.id);
    if (!assetIds.length) {
      report(new Error("Upload at least one image first."));
      return;
    }
    setPending(true);
    try {
      setBatch(
        await runtime.batch.startBatch({
          assetIds,
          settings: {
            model,
            scale,
            gpuId,
            saveImageAs,
            compression: String(compression),
            overwrite,
            noImageProcessing,
            customWidth: customWidth > 0 ? String(customWidth) : "",
            useCustomWidth,
            tileSize,
            ttaMode,
            copyMetadata,
          },
        }),
      );
    } catch (error) {
      report(error);
    } finally {
      setPending(false);
    }
  };
  const cancel = async () => {
    if (!batch || !runtime.batch) return;
    try {
      await runtime.batch.cancelBatch(batch.id);
    } catch (error) {
      report(error);
    }
  };
  const retry = async (itemIds: string[]) => {
    if (!batch || !runtime.batch || busy) return;
    setPending(true);
    try {
      setBatch(await runtime.batch.retryBatch(batch.id, itemIds));
    } catch (error) {
      report(error);
    } finally {
      setPending(false);
    }
  };
  return {
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
  };
}

/** Mounted once by the batch panel; snapshots recover state on SSE reconnect. */
export function useBatchEvents() {
  const runtime = useRuntime();
  const batch = useAtomValue(imageBatchInfoAtom);
  const setBatch = useSetAtom(imageBatchInfoAtom);
  const logit = useLogger();
  const active = batch && ["running", "cancelling"].includes(batch.status);
  useEffect(() => {
    if (!active || !batch || !runtime.batch) return;
    return runtime.batch.subscribeToBatch(batch.id, (event) => {
      if (event.type === "batch") setBatch(event.batch);
      else if ("message" in event.event)
        logit(`Batch item ${event.itemId}:`, event.event.message);
    });
  }, [runtime, batch?.id, active]);
}
