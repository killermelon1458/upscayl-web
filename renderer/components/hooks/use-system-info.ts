import { useEffect, useState } from "react";
import { SystemInfo } from "@common/types/runtime";
import { useRuntime } from "@/runtime/runtime-context";

const useSystemInfo = () => {
  const runtime = useRuntime();
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    const getSystemInfo = async () => {
      try {
        const systemInfo = await runtime.getSystemInfo();
        setSystemInfo(systemInfo);
      } catch {
        setSystemInfo(null);
      }
    };
    getSystemInfo();
  }, [runtime]);
  return { systemInfo };
};

export default useSystemInfo;
