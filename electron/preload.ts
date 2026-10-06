import { ipcRenderer, contextBridge } from "electron";
import type { IpcRendererEvent } from "electron";
import {
  getAppVersion,
  getDeviceSpecs,
  getPlatform,
} from "./utils/get-device-specs";

type RendererListener = (event: IpcRendererEvent, args: any) => any;
type ChannelListeners = Map<RendererListener, RendererListener>;

const wrappedListeners = new Map<string, ChannelListeners>();

// 'ipcRenderer' will be available in index.js with the method 'window.electron'
contextBridge.exposeInMainWorld("electron", {
  send: (command: string, payload: any) => ipcRenderer.send(command, payload),
  on: (command: string, func: RendererListener) => {
    const channelListeners =
      wrappedListeners.get(command) ?? new Map<RendererListener, RendererListener>();
    const existingListener = channelListeners.get(func);
    if (existingListener) {
      ipcRenderer.removeListener(command, existingListener);
    }
    const wrappedListener: RendererListener = (event, args) => {
      func(event, args);
    };
    channelListeners.set(func, wrappedListener);
    wrappedListeners.set(command, channelListeners);
    ipcRenderer.on(command, wrappedListener);
  },
  off: (command: string, func: RendererListener) => {
    const channelListeners = wrappedListeners.get(command);
    const wrappedListener = channelListeners?.get(func);
    if (!channelListeners || !wrappedListener) return;
    ipcRenderer.removeListener(command, wrappedListener);
    channelListeners.delete(func);
    if (channelListeners.size === 0) {
      wrappedListeners.delete(command);
    }
  },
  invoke: (command: string, payload: any) =>
    ipcRenderer.invoke(command, payload),
  platform: getPlatform(),
  getSystemInfo: async () => await getDeviceSpecs(),
  getAppVersion: async () => await getAppVersion(),
});
