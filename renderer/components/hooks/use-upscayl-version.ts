import { useState, useEffect } from "react";
import { useRuntime } from "@/runtime/runtime-context";

const useUpscaylVersion = () => {
  const runtime = useRuntime();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    runtime.getVersion().then(setVersion).catch(() => setVersion(null));
  }, [runtime]);

  return version;
};

export default useUpscaylVersion;
