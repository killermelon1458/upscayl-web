export interface IElectronAPI {
  on: (command, func?) => void;
  off: (command, func?) => void;
  send: <T>(command, func?: T) => void;
  invoke: (command, func?) => any;
  platform: "mac" | "win" | "linux";
  getSystemInfo: () => Promise<{
    platform: string | undefined;
    release: string;
    arch: string | undefined;
    model: string;
    cpuCount: number;
    gpu: Record<string, any>;
  }>;
  getAppVersion: () => Promise<string>;
}

declare global {
  interface Window {
    electron: IElectronAPI;
  }
}
