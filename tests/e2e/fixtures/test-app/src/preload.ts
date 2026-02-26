// Set up the library's IPC bridge — exposes electron_window.WindowManager via contextBridge
import "../../../../../src/preload/index.js";

import { contextBridge, ipcRenderer } from "electron";

const testAPI = {
  ping: () => "pong",
  getWindowCount: () => ipcRenderer.invoke("test:get-window-count"),
  getTotalBrowserWindowCount: () =>
    ipcRenderer.invoke("test:get-total-browser-window-count"),
  getAllWindows: () => ipcRenderer.invoke("test:get-all-windows"),
  getWindowProps: (id: string) =>
    ipcRenderer.invoke("test:get-window-props", id),
  clearAllState: () => ipcRenderer.invoke("test:clear-all-state"),
  getDisplayInfo: () => ipcRenderer.invoke("test:get-display-info"),
  closeChildWindow: (id: string) =>
    ipcRenderer.invoke("test:close-child-window", id),
  resizeChildWindow: (id: string, width: number, height: number) =>
    ipcRenderer.invoke("test:resize-child-window", id, width, height),
  getChildWebPreferences: (id: string) =>
    ipcRenderer.invoke("test:get-child-web-preferences", id),
};

contextBridge.exposeInMainWorld("testAPI", testAPI);

declare global {
  interface Window {
    testAPI: typeof testAPI;
  }
}
