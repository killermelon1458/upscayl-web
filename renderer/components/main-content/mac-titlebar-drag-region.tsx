import { useRuntime } from "@/runtime/runtime-context";

const MacTitlebarDragRegion = () => {
  const runtime = useRuntime();
  return runtime.capabilities.hasNativeTitleBar ? (
    <div className="mac-titlebar absolute top-0 h-8 w-full"></div>
  ) : null;
};

export default MacTitlebarDragRegion;
