"use client";
import useLogger from "../hooks/use-logger";
import { useState, useMemo, useEffect } from "react";
import { ELECTRON_COMMANDS } from "@common/electron-commands";
import { useAtomValue, useAtom } from "jotai";
import {
  batchModeAtom,
  progressAtom,
  viewTypeAtom,
} from "../../atoms/user-settings-atom";
import { useToast } from "@/components/ui/use-toast";
import { ImageFormat, VALID_IMAGE_FORMATS } from "@/lib/valid-formats";
import ProgressBar from "./progress-bar";
import InstructionsCard from "./instructions-card";
import MoreOptionsDrawer from "./more-options-drawer";
import useUpscaylVersion from "../hooks/use-upscayl-version";
import MacTitlebarDragRegion from "./mac-titlebar-drag-region";
import LensViewer from "./lens-view";
import ImageViewer from "./image-viewer";
import useTranslation from "../hooks/use-translation";
import SliderView from "./slider-view";
import { ImageAsset, ResultAsset } from "@common/types/runtime";
import { useRuntime } from "@/runtime/runtime-context";
import { imageBatchModeAtom } from "@/atoms/image-batch-atom";
import { useImageBatch } from "../hooks/use-image-batch";
import ImageBatchPanel from "./image-batch-panel";

type MainContentProps = {
  inputAsset: ImageAsset | null;
  resetImagePaths: () => void;
  upscaledBatchFolderPath: string;
  setInputAsset: React.Dispatch<React.SetStateAction<ImageAsset | null>>;
  validateImageAsset: (asset: ImageAsset) => void;
  selectFolderHandler: () => void;
  selectImageHandler: () => void;
  resultAsset: ResultAsset | null;
  batchFolderPath: string;
  doubleUpscaylCounter: number;
  activeJobId?: string;
  setDimensions: React.Dispatch<
    React.SetStateAction<{
      width: number;
      height: number;
    }>
  >;
};

const MainContent = ({
  inputAsset,
  resetImagePaths,
  upscaledBatchFolderPath,
  setInputAsset,
  validateImageAsset,
  selectFolderHandler,
  selectImageHandler,
  resultAsset,
  batchFolderPath,
  doubleUpscaylCounter,
  activeJobId,
  setDimensions,
}: MainContentProps) => {
  const runtime = useRuntime();
  const [imageBatchMode, setImageBatchMode] = useAtom(imageBatchModeAtom);
  const imageBatch = useImageBatch();
  const t = useTranslation();
  const logit = useLogger();
  const { toast } = useToast();
  const version = useUpscaylVersion();

  const progress = useAtomValue(progressAtom);
  const batchMode = useAtomValue(batchModeAtom);

  const viewType = useAtomValue(viewTypeAtom);
  const [zoomAmount, setZoomAmount] = useState("100");

  const showInformationCard = useMemo(() => {
    if (!batchMode) {
      return !inputAsset && !resultAsset;
    } else {
      return (
        batchFolderPath.length === 0 && upscaledBatchFolderPath.length === 0
      );
    }
  }, [
    batchMode,
    inputAsset,
    resultAsset,
    batchFolderPath,
    upscaledBatchFolderPath,
  ]);

  // DRAG AND DROP HANDLERS
  const handleDragEnter = (e) => {
    e.preventDefault();
    console.log("drag enter");
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    console.log("drag leave");
  };
  const handleDragOver = (e) => {
    e.preventDefault();
    console.log("drag over");
  };

  const openFolderHandler = (e) => {
    const logit = useLogger();
    logit("📂 OPEN_FOLDER: ", upscaledBatchFolderPath);
    window.electron.send(
      ELECTRON_COMMANDS.OPEN_FOLDER,
      upscaledBatchFolderPath,
    );
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    if (activeJobId) return;
    if (runtime.batch && (imageBatchMode || e.dataTransfer.files.length > 1)) {
      setImageBatchMode(true);
      await imageBatch.importFiles(Array.from(e.dataTransfer.files));
      return;
    }
    if (
      e.dataTransfer.items.length === 0 ||
      e.dataTransfer.files.length === 0
    ) {
      logit("👎 No valid files dropped");
      toast({
        title: t("ERRORS.INVALID_IMAGE_ERROR.TITLE"),
        description: t("ERRORS.INVALID_IMAGE_ERROR.ADDITIONAL_DESCRIPTION"),
      });
      return;
    }
    const type = e.dataTransfer.items[0].type;
    const file = e.dataTransfer.files[0];
    const extension = file.name.split(".").at(-1)?.toLowerCase();
    logit(
      "⤵️ Dropped file: ",
      JSON.stringify({ type, name: file.name, extension }),
    );
    if (
      !type.includes("image") ||
      !extension ||
      !VALID_IMAGE_FORMATS.includes(extension as ImageFormat)
    ) {
      logit("🚫 Invalid file dropped");
      toast({
        title: t("ERRORS.INVALID_IMAGE_ERROR.TITLE"),
        description: t("ERRORS.INVALID_IMAGE_ERROR.ADDITIONAL_DESCRIPTION"),
      });
    } else {
      try {
        const asset = await runtime.importImage(file);
        resetImagePaths();
        logit("🖼 Imported image asset: ", asset.name);
        setInputAsset(asset);
        validateImageAsset(asset);
      } catch (error) {
        toast({
          title: t("ERRORS.INVALID_IMAGE_ERROR.TITLE"),
          description: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const file = e.clipboardData.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    e.preventDefault();
    if (activeJobId) return;
    if (imageBatchMode && runtime.batch) {
      await imageBatch.importFiles(Array.from(e.clipboardData.files));
      return;
    }
    try {
      const asset = await runtime.importImage(file);
      resetImagePaths();
      setInputAsset(asset);
      validateImageAsset(asset);
    } catch (error) {
      toast({
        title: t("ERRORS.NO_IMAGE_ERROR.TITLE"),
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  useEffect(() => {
    const handlePasteEvent = (e) => handlePaste(e);
    window.addEventListener("paste", handlePasteEvent);
    return () => {
      window.removeEventListener("paste", handlePasteEvent);
    };
  }, [t, runtime, imageBatchMode, imageBatch.busy, imageBatch.uploading, activeJobId]);

  if (imageBatchMode && runtime.batch) return <ImageBatchPanel />;

  return (
    <div
      className="relative flex h-screen w-full flex-col items-center justify-center"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDoubleClick={batchMode ? selectFolderHandler : selectImageHandler}
    >
      <MacTitlebarDragRegion />

      {progress.length > 0 &&
        !resultAsset &&
        upscaledBatchFolderPath.length === 0 && (
          <ProgressBar
            batchMode={batchMode}
            progress={progress}
            doubleUpscaylCounter={doubleUpscaylCounter}
            resetImagePaths={resetImagePaths}
            jobId={activeJobId}
          />
        )}

      {/* DEFAULT PANE INFO */}
      {showInformationCard && (
        <InstructionsCard version={version} batchMode={batchMode} />
      )}

      <MoreOptionsDrawer
        zoomAmount={zoomAmount}
        setZoomAmount={setZoomAmount}
        resetImagePaths={resetImagePaths}
      />

      {/* SHOW SELECTED IMAGE */}
      {!batchMode && !resultAsset && inputAsset && (
        <ImageViewer
          imageUrl={inputAsset.previewUrl}
          setDimensions={setDimensions}
        />
      )}

      {/* BATCH UPSCALE SHOW SELECTED FOLDER */}
      {batchMode &&
        upscaledBatchFolderPath.length === 0 &&
        batchFolderPath.length > 0 && (
          <p className="select-none text-base-content">
            <span className="font-bold">
              {t("APP.PROGRESS.BATCH.SELECTED_FOLDER_TITLE")}
            </span>{" "}
            {batchFolderPath}
          </p>
        )}
      {/* BATCH UPSCALE DONE INFO */}

      {batchMode && upscaledBatchFolderPath.length > 0 && (
        <div className="z-50 flex flex-col items-center">
          <p className="select-none py-4 font-bold text-base-content">
            {t("APP.PROGRESS.BATCH.DONE_TITLE")}
          </p>
          <button
            className="bg-gradient-blue btn btn-primary rounded-btn p-3 font-medium text-white/90 transition-colors"
            onClick={openFolderHandler}
          >
            {t("APP.PROGRESS.BATCH.OPEN_UPSCAYLED_FOLDER_TITLE")}
          </button>
        </div>
      )}

      {!batchMode && viewType === "lens" && resultAsset && inputAsset && (
        <LensViewer
          imageUrl={inputAsset.previewUrl}
          upscaledImageUrl={resultAsset.previewUrl}
        />
      )}

      {!batchMode &&
        resultAsset?.downloadUrl &&
        runtime.capabilities.canDownloadResult && (
          <a
            className="btn btn-primary absolute bottom-6 right-6 z-50"
            href={resultAsset.downloadUrl}
            download={resultAsset.name}
          >
            Download
          </a>
        )}

      {/* COMPARISON SLIDER */}
      {!batchMode &&
        viewType === "slider" &&
        inputAsset &&
        resultAsset && (
          <SliderView
            imageUrl={inputAsset.previewUrl}
            upscaledImageUrl={resultAsset.previewUrl}
            zoomAmount={zoomAmount}
          />
        )}
    </div>
  );
};

export default MainContent;
