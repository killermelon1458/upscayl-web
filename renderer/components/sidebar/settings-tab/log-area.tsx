import { translationAtom } from "@/atoms/translations-atom";
import { useAtomValue } from "jotai";
import React, { useEffect } from "react";

type LogAreaProps = {
  copyOnClickHandler: () => void;
  isCopied: boolean;
  copyFailed?: boolean;
  logData: string[];
};

export function LogArea({
  copyOnClickHandler,
  isCopied,
  copyFailed,
  logData,
}: LogAreaProps) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const t = useAtomValue(translationAtom);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [logData]);

  return (
    <div className="relative flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">LOGS</p>
        <button className="btn btn-primary btn-xs" onClick={copyOnClickHandler}>
          {isCopied ? (
            <span>{t("SETTINGS.LOG_AREA.ON_COPY")}</span>
          ) : (
            <span>{t("SETTINGS.LOG_AREA.BUTTON_TITLE")}</span>
          )}
        </button>
      </div>
      {copyFailed && (
        <p role="status" className="text-sm">
          Automatic copying failed. Select the logs below and copy them
          manually.
        </p>
      )}
      <textarea
        aria-label="Logs"
        readOnly
        value={logData.join("\n")}
        placeholder={t("SETTINGS.LOG_AREA.NO_LOGS")}
        onFocus={(event) => event.currentTarget.select()}
        className="relative h-52 max-h-52 w-full overflow-y-auto rounded-btn rounded-r-none bg-base-200 p-4 text-xs"
        ref={ref}
      />
    </div>
  );
}
