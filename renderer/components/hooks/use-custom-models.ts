import { useEffect } from "react";
import useLogger from "./use-logger";
import { useSetAtom } from "jotai";
import { customModelIdsAtom } from "@/atoms/models-list-atom";
import { useRuntime } from "@/runtime/runtime-context";

export const initCustomModels = () => {
  const logit = useLogger();
  const runtime = useRuntime();
  const setModelIds = useSetAtom(customModelIdsAtom);

  useEffect(() => {
    if (!runtime.capabilities.supportsCustomModels) return;
    runtime
      .listModels()
      .then((models) => {
        setModelIds(models);
        logit("🎯 GET_MODELS_LIST: ", models);
      })
      .catch((error) => logit("🚫 GET_MODELS_LIST: ", error));
  }, [runtime, setModelIds]);
};
