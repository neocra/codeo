import { contextBridge, ipcRenderer } from 'electron';
import type { CodeoBridge } from '../shared/bridge-types';
import { IPC } from '../shared/bridge-types';

/**
 * Minimal, typed bridge. The renderer never sees Node, Electron or the runtime socket:
 * every call is a structured IPC message validated again in the main process.
 */
const bridge: CodeoBridge = {
  platform: process.platform,
  appVersion: process.argv.find((a) => a.startsWith('--codeo-app-version='))?.slice('--codeo-app-version='.length) ?? '0.0.0',
  invoke: (command, params) => ipcRenderer.invoke(IPC.invoke, command, params),
  onEvent: (listener) => {
    const handler = (_: unknown, payload: Parameters<typeof listener>[0]) => listener(payload);
    ipcRenderer.on(IPC.event, handler);
    return () => ipcRenderer.removeListener(IPC.event, handler);
  },
  onRuntimeStatus: (listener) => {
    const handler = (_: unknown, status: Parameters<typeof listener>[0]) => listener(status);
    ipcRenderer.on(IPC.runtimeStatus, handler);
    return () => ipcRenderer.removeListener(IPC.runtimeStatus, handler);
  },
  getRuntimeStatus: () => ipcRenderer.invoke(IPC.getRuntimeStatus),
  pickDirectory: (options) => ipcRenderer.invoke(IPC.pickDirectory, options ?? {}),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  getPreference: (key, fallback) => ipcRenderer.invoke(IPC.getPreference, key, fallback),
  setPreference: (key, value) => ipcRenderer.invoke(IPC.setPreference, key, value),
  userName: () => ipcRenderer.invoke(IPC.userName),
  checkForUpdates: () => ipcRenderer.invoke(IPC.updateCheck),
  installUpdate: () => ipcRenderer.invoke(IPC.updateInstall),
  getUpdateStatus: () => ipcRenderer.invoke(IPC.getUpdateStatus),
  onUpdateStatus: (listener) => {
    const handler = (_: unknown, status: Parameters<typeof listener>[0]) => listener(status);
    ipcRenderer.on(IPC.updateStatus, handler);
    return () => ipcRenderer.removeListener(IPC.updateStatus, handler);
  },
  openReleasePage: () => ipcRenderer.invoke(IPC.openReleasePage),
};

contextBridge.exposeInMainWorld('codeo', bridge);
