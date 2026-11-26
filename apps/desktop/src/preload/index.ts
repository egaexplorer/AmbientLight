import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { type AmbientApi, type AppState, CHANNELS, type FrameView, type Toast } from "../shared/api";

/** Strips Electron's "Error invoking remote method '…': Error: " prefix, so the UI shows only the message. */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
  }
}

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T): void => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

// The popup's first toast can arrive before React has subscribed, so the latest one is kept and replayed.
let lastToast: Toast | undefined;
ipcRenderer.on(CHANNELS.toast, (_event: IpcRendererEvent, toast: Toast) => {
  lastToast = toast;
});

const api: AmbientApi = {
  getState: () => invoke(CHANNELS.getState),
  discover: () => invoke(CHANNELS.discover),
  identify: (ip) => invoke(CHANNELS.identify, ip),
  setBulbs: (ips) => invoke(CHANNELS.setBulbs, ips),
  findTitle: (kind, title) => invoke(CHANNELS.findTitle, kind, title),
  setLook: (look) => invoke(CHANNELS.setLook, look),
  setBrightness: (value) => invoke(CHANNELS.setBrightness, value),
  startSync: () => invoke(CHANNELS.startSync),
  stopSync: () => invoke(CHANNELS.stopSync),
  minimizeWindow: () => invoke(CHANNELS.minimizeWindow),
  getShortcuts: () => invoke(CHANNELS.getShortcuts),
  reloadShortcuts: () => invoke(CHANNELS.reloadShortcuts),
  openShortcutsFile: () => invoke(CHANNELS.openShortcutsFile),
  onState: (listener) => subscribe<AppState>(CHANNELS.state, listener),
  onFrame: (listener) => subscribe<FrameView>(CHANNELS.frame, listener),
  onToast: (listener) => {
    if (lastToast) listener(lastToast);
    return subscribe<Toast>(CHANNELS.toast, listener);
  },
};

contextBridge.exposeInMainWorld("ambient", api);
