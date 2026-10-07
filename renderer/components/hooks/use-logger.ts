import { logAtom } from "../../atoms/log-atom";
import { useSetAtom } from "jotai";
import { useRuntime } from "@/runtime/runtime-context";

const useLogger = () => {
  const setLogData = useSetAtom(logAtom);
  const runtime = useRuntime();

  const logit = (...args: any) => {
    runtime.log(...args);

    const data = [...args].join(" ");
    setLogData((prevLogData) => [...prevLogData, data]);
  };

  return logit;
};

export default useLogger;
