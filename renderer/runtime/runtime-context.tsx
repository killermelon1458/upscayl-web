import { UpscaylRuntime } from "@common/types/runtime";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ElectronRuntime } from "./electron-runtime";
import { WebRuntime } from "./web-runtime";

const RuntimeContext = createContext<UpscaylRuntime | null>(null);

const createRuntime = (): UpscaylRuntime => {
  if (typeof window !== "undefined" && window.electron) {
    return new ElectronRuntime();
  }
  return new WebRuntime();
};

export const RuntimeProvider = ({ children }: { children: React.ReactNode }) => {
  const [runtime, setRuntime] = useState<UpscaylRuntime | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setRuntime(createRuntime());
  }, []);

  if (!runtime) return null;

  return (
    <RuntimeContext.Provider value={runtime}>
      {children}
    </RuntimeContext.Provider>
  );
};

export const useRuntime = () => {
  const runtime = useContext(RuntimeContext);
  if (!runtime) {
    throw new Error("useRuntime must be used within RuntimeProvider");
  }
  return runtime;
};
