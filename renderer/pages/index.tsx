"use client";
import { useState, useEffect, useRef } from "react";
import { ELECTRON_COMMANDS } from "@common/electron-commands";
import { useAtomValue, useSetAtom } from "jotai";
import { customModelIdsAtom } from "../atoms/models-list-atom";
import {
  batchModeAtom,
  savedOutputPathAtom,
  progressAtom,
  rememberOutputFolderAtom,
  userStatsAtom,
} from "../atoms/user-settings-atom";
import useLogger from "../components/hooks/use-logger";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import UpscaylSVGLogo from "@/components/icons/upscayl-logo-svg";
import { translationAtom } from "@/atoms/translations-atom";
import Sidebar from "@/components/sidebar";
import MainContent from "@/components/main-content";
import { ImageFormat, VALID_IMAGE_FORMATS } from "@/lib/valid-formats";
import { initCustomModels } from "@/components/hooks/use-custom-models";
import { OnboardingDialog } from "@/components/main-content/onboarding-dialog";
import useSystemInfo from "@/components/hooks/use-system-info";
import {
  ImageAsset,
  JobErrorCode,
  JobInfo,
  ResultAsset,
} from "@common/types/runtime";
import { useRuntime } from "@/runtime/runtime-context";
import getFilenameFromPath from "@common/get-file-name";
import { sanitizePath } from "@common/sanitize-path";

const Home = () => {
  const runtime = useRuntime();
  const t = useAtomValue(translationAtom);
  const logit = useLogger();
  const { toast } = useToast();
  const { systemInfo } = useSystemInfo();

  initCustomModels();

  const [isLoading, setIsLoading] = useState(true);
  const [inputAsset, setInputAsset] = useState<ImageAsset | null>(null);
  const [resultAsset, setResultAsset] = useState<ResultAsset | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const [dimensions, setDimensions] = useState({
    width: null,
    height: null,
  });
  const setOutputPath = useSetAtom(savedOutputPathAtom);
  const rememberOutputFolder = useAtomValue(rememberOutputFolderAtom);
  const batchMode = useAtomValue(batchModeAtom);
  const [batchFolderPath, setBatchFolderPath] = useState("");
  const [upscaledBatchFolderPath, setUpscaledBatchFolderPath] = useState("");
  const setProgress = useSetAtom(progressAtom);
  const [doubleUpscaylCounter, setDoubleUpscaylCounter] = useState(0);
  const setModelIds = useSetAtom(customModelIdsAtom);
  const setUserStats = useSetAtom(userStatsAtom);

  const selectImageHandler = async () => {
    resetImagePaths();
    try {
      const asset = await runtime.selectImage();
      if (asset === null) return;
      logit("🖼 Selected Image Asset: ", asset.name);
      setInputAsset(asset);
      if (!rememberOutputFolder) {
        setOutputPath(null);
      }
      validateImageAsset(asset);
    } catch (error) {
      toast({
        title: t("ERRORS.NO_IMAGE_ERROR.TITLE"),
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const selectFolderHandler = async () => {
    resetImagePaths();
    const path = await window.electron.invoke(ELECTRON_COMMANDS.SELECT_FOLDER);
    if (path !== null) {
      logit("🖼 Selected Folder Path: ", path);
      setBatchFolderPath(path);
      if (!rememberOutputFolder) {
        setOutputPath(path);
      }
    } else {
      logit("🚫 Folder selection cancelled");
      setBatchFolderPath("");
      if (!rememberOutputFolder) {
        setOutputPath("");
      }
    }
  };

  const validateImageAsset = (asset: ImageAsset) => {
    if (asset.name.length > 0) {
      logit("🖼 imageAsset: ", asset.name);
      const extension = asset.name.split(".").pop().toLowerCase() as ImageFormat;
      logit("🔤 Extension: ", extension);
      if (!VALID_IMAGE_FORMATS.includes(extension)) {
        toast({
          title: t("ERRORS.INVALID_IMAGE_ERROR.TITLE"),
          description: t("ERRORS.INVALID_IMAGE_ERROR.DESCRIPTION"),
        });
        resetImagePaths();
      }
    } else {
      resetImagePaths();
    }
  };

  const handleErrors = (data: string, code?: JobErrorCode) => {
    const errorCode =
      code ??
      (data.includes("Invalid GPU")
        ? "invalid-gpu"
        : data.includes("write") || data.includes("read")
          ? "read-write"
          : data.includes("tile size")
            ? "tile-size"
            : data.includes("uncaughtException")
              ? "uncaught-exception"
              : undefined);

    if (errorCode === "invalid-gpu") {
      toast({
        title: t("ERRORS.GPU_ERROR.TITLE"),
        description: t("ERRORS.GPU_ERROR.DESCRIPTION", { data }),
        action: (
          <div className="flex flex-col gap-2">
            <ToastAction
              altText={t("ERRORS.COPY_ERROR.TITLE")}
              onClick={() => {
                navigator.clipboard.writeText(data);
              }}
            >
              {t("ERRORS.COPY_ERROR.TITLE")}
            </ToastAction>
            <a href="https://docs.upscayl.org/" target="_blank">
              <ToastAction altText={t("ERRORS.OPEN_DOCS_TITLE")}>
                {t("ERRORS.OPEN_DOCS_BUTTON_TITLE")}
              </ToastAction>
            </a>
          </div>
        ),
      });
    } else if (errorCode === "read-write") {
      if (batchMode) return false;
      toast({
        title: t("ERRORS.READ_WRITE_ERROR.TITLE"),
        description: t("ERRORS.READ_WRITE_ERROR.DESCRIPTION", { data }),
        action: (
          <div className="flex flex-col gap-2">
            <ToastAction
              altText="Copy Error"
              onClick={() => {
                navigator.clipboard.writeText(data);
              }}
            >
              {t("ERRORS.COPY_ERROR.TITLE")}
            </ToastAction>
            <a href="https://docs.upscayl.org/" target="_blank">
              <ToastAction altText={t("ERRORS.OPEN_DOCS_TITLE")}>
                {t("ERRORS.OPEN_DOCS_BUTTON_TITLE")}
              </ToastAction>
            </a>
          </div>
        ),
      });
    } else if (errorCode === "tile-size") {
      toast({
        title: t("ERRORS.TILE_SIZE_ERROR.TITLE"),
        description: t("ERRORS.TILE_SIZE_ERROR.DESCRIPTION", { data }),
      });
    } else if (errorCode === "uncaught-exception") {
      toast({
        title: t("ERRORS.EXCEPTION_ERROR.TITLE"),
        description: t("ERRORS.EXCEPTION_ERROR.DESCRIPTION"),
      });
    } else {
      return false;
    }

    resetImagePaths();
    return true;
  };

  // ELECTRON EVENT LISTENERS
  useEffect(() => {
    if (!runtime.capabilities.supportsBatch) return;
    // LOG
    window.electron.on(ELECTRON_COMMANDS.LOG, (_, data: string) => {
      if (activeJobIdRef.current) return;
      logit(`🎒 BACKEND REPORTED: `, data);
    });
    // SCALING AND CONVERTING
    window.electron.on(
      ELECTRON_COMMANDS.SCALING_AND_CONVERTING,
      (_, data: string) => {
        if (activeJobIdRef.current) return;
        setProgress(t("APP.PROGRESS.PROCESSING_TITLE"));
      },
    );
    // UPSCAYL WARNING
    window.electron.on(ELECTRON_COMMANDS.UPSCAYL_WARNING, (_, data: string) => {
      if (activeJobIdRef.current) return;
      toast({
        title: t("WARNING.GENERIC_WARNING.TITLE"),
        description: data,
      });
    });
    // METADATA ERROR
    window.electron.on(ELECTRON_COMMANDS.METADATA_ERROR, (_, data: string) => {
      if (activeJobIdRef.current) return;
      toast({
        title: t("ERRORS.METADATA_ERROR.TITLE"),
        description: data,
      });
    });
    // UPSCAYL ERROR
    window.electron.on(ELECTRON_COMMANDS.UPSCAYL_ERROR, (_, data: string) => {
      if (activeJobIdRef.current) return;
      toast({
        title: t("ERRORS.GENERIC_ERROR.TITLE"),
        description: data,
      });
      resetImagePaths();
    });
    // FOLDER UPSCAYL PROGRESS
    window.electron.on(
      ELECTRON_COMMANDS.FOLDER_UPSCAYL_PROGRESS,
      (_, data: string) => {
        if (data.includes("Successful")) {
          setProgress(t("APP.PROGRESS.SUCCESS_TITLE"));
        }
        if (data.length > 0 && data.length < 10) {
          setProgress(data);
        }
        handleErrors(data);
        logit(`🚧 FOLDER_UPSCAYL_PROGRESS: `, data);
      },
    );
    // DOUBLE UPSCAYL PROGRESS
    window.electron.on(
      ELECTRON_COMMANDS.DOUBLE_UPSCAYL_PROGRESS,
      (_, data: string) => {
        if (data.length > 0 && data.length < 10) {
          if (data === "0.00%") {
            setDoubleUpscaylCounter(doubleUpscaylCounter + 1);
          }
          setProgress(data);
        }
        handleErrors(data);
        logit(`🚧 DOUBLE_UPSCAYL_PROGRESS: `, data);
      },
    );
    // FOLDER UPSCAYL DONE
    window.electron.on(
      ELECTRON_COMMANDS.FOLDER_UPSCAYL_DONE,
      (_, data: string) => {
        setProgress("");
        setUpscaledBatchFolderPath(data);
        logit(`💯 FOLDER_UPSCAYL_DONE: `, data);
        setUserStats((prev) => ({
          ...prev,
          lastUpscaylDuration: new Date().getTime() - prev.lastUsedAt,
          averageUpscaylTime:
            (prev.averageUpscaylTime * prev.totalUpscayls +
              (new Date().getTime() - prev.lastUsedAt)) /
            (prev.totalUpscayls + 1),
        }));
      },
    );
    // DOUBLE UPSCAYL DONE
    window.electron.on(
      ELECTRON_COMMANDS.DOUBLE_UPSCAYL_DONE,
      (_, data: string) => {
        setProgress("");
        setTimeout(
          () =>
            setResultAsset({
              id: data,
              name: getFilenameFromPath(data),
              previewUrl: `file:///${sanitizePath(data)}`,
            }),
          500,
        );
        setDoubleUpscaylCounter(0);
        logit(`💯 DOUBLE_UPSCAYL_DONE: `, data);
        setUserStats((prev) => ({
          ...prev,
          lastUpscaylDuration: new Date().getTime() - prev.lastUsedAt,
          averageUpscaylTime:
            (prev.averageUpscaylTime * prev.totalUpscayls +
              (new Date().getTime() - prev.lastUsedAt)) /
            (prev.totalUpscayls + 1),
        }));
      },
    );
    // CUSTOM FOLDER LISTENER
    window.electron.on(
      ELECTRON_COMMANDS.CUSTOM_MODEL_FILES_LIST,
      (_, data: string[]) => {
        logit(`📜 CUSTOM_MODEL_FILES_LIST: `, data);
        console.log("🚀 => data:", data);
        setModelIds(data);
      },
    );
  }, []);

  useEffect(() => {
    if (!activeJobId) return;
    return runtime.subscribeToJob(activeJobId, (event) => {
      if (event.type === "started") {
        setProgress(t("APP.PROGRESS.WAIT_TITLE"));
      } else if (event.type === "progress") {
        setProgress(event.message);
      } else if (event.type === "phase") {
        setProgress(
          event.phase === "successful"
            ? t("APP.PROGRESS.SUCCESS_TITLE")
            : t("APP.PROGRESS.SCALING_CONVERTING_TITLE"),
        );
      } else if (event.type === "warning") {
        logit("Job warning:", event.message);
        toast({
          title:
            event.code === "metadata"
              ? t("ERRORS.METADATA_ERROR.TITLE")
              : t("WARNING.GENERIC_WARNING.TITLE"),
          description: event.message,
        });
      } else if (event.type === "error") {
        logit("Job failed:", event.message);
        const handled = handleErrors(event.message, event.code);
        if (!handled) {
          toast({
            title: t("ERRORS.GENERIC_ERROR.TITLE"),
            description: event.message,
          });
          resetImagePaths();
        }
        setActiveJobId(null);
        setTimeout(() => {
          activeJobIdRef.current = null;
        }, 0);
      } else if (
        event.type === "cancellation-requested" &&
        !runtime.capabilities.confirmsCancellation
      ) {
        // Electron's legacy STOP IPC has no process-exit acknowledgement.
        setProgress("");
        activeJobIdRef.current = null;
        setActiveJobId(null);
      } else if (event.type === "cancelled") {
        setProgress("");
        activeJobIdRef.current = null;
        setActiveJobId(null);
      } else if (event.type === "complete") {
        setProgress("");
        setResultAsset(event.result);
        setUserStats((prev) => ({
          ...prev,
          lastUpscaylDuration: new Date().getTime() - prev.lastUsedAt,
          averageUpscaylTime:
            (prev.averageUpscaylTime * prev.totalUpscayls +
              (new Date().getTime() - prev.lastUsedAt)) /
            (prev.totalUpscayls + 1),
        }));
        logit("resultAsset: ", event.result.name);
        activeJobIdRef.current = null;
        setActiveJobId(null);
      } else if (event.type === "log") {
        logit(`🎒 BACKEND REPORTED: `, event.message);
      }
    });
  }, [activeJobId, runtime]);

  // LOADING STATE
  useEffect(() => {
    setIsLoading(false);
  }, []);

  // SYSTEM INFO
  useEffect(() => {
    if (systemInfo) logit("💻 System Info:", JSON.stringify(systemInfo));
  }, [systemInfo]);

  // HANDLERS
  const resetImagePaths = () => {
    logit("🔄 Resetting image paths");
    setDimensions({
      width: null,
      height: null,
    });
    setProgress("");
    setInputAsset(null);
    setResultAsset(null);
    setBatchFolderPath("");
    setUpscaledBatchFolderPath("");
  };

  if (isLoading) {
    return (
      <UpscaylSVGLogo className="absolute left-1/2 top-1/2 w-36 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
    );
  }

  return (
    <div
      className="flex h-screen w-screen flex-row overflow-hidden bg-base-300"
      onPaste={(e) => console.log(e)}
    >
      <Sidebar
        inputAsset={inputAsset}
        dimensions={dimensions}
        setResultAsset={setResultAsset}
        batchFolderPath={batchFolderPath}
        setUpscaledBatchFolderPath={setUpscaledBatchFolderPath}
        selectImageHandler={selectImageHandler}
        selectFolderHandler={selectFolderHandler}
        onJobStarted={(job: JobInfo) => {
          activeJobIdRef.current = job.id;
          setActiveJobId(job.id);
        }}
      />
      <MainContent
        inputAsset={inputAsset}
        resetImagePaths={resetImagePaths}
        upscaledBatchFolderPath={upscaledBatchFolderPath}
        setInputAsset={setInputAsset}
        validateImageAsset={validateImageAsset}
        selectFolderHandler={selectFolderHandler}
        selectImageHandler={selectImageHandler}
        batchFolderPath={batchFolderPath}
        resultAsset={resultAsset}
        doubleUpscaylCounter={doubleUpscaylCounter}
        activeJobId={activeJobId ?? undefined}
        setDimensions={setDimensions}
      />
      <OnboardingDialog />
    </div>
  );
};

export default Home;
