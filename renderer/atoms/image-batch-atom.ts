import { atom, WritableAtom } from "jotai";
import { BatchInfo, ImageAsset } from "@common/types/runtime";

export type UploadItem = {
  key: string;
  name: string;
  file: File;
  status: "uploading" | "ready" | "upload-error";
  asset?: ImageAsset;
  error?: string;
};
export const imageBatchModeAtom = atom(false);
export const imageBatchSelectionAtom = atom<UploadItem[]>([]);
export const imageBatchInfoAtom: WritableAtom<
  BatchInfo | null,
  [BatchInfo | null],
  void
> = atom<BatchInfo | null, [BatchInfo | null], void>(null, (_get, set, value) =>
  set(imageBatchInfoAtom, value),
);
export const imageBatchPendingAtom = atom(false);
export const imageBatchBusyAtom = atom(
  (get) =>
    get(imageBatchPendingAtom) ||
    ["running", "cancelling"].includes(get(imageBatchInfoAtom)?.status || ""),
);
