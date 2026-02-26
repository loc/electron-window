import { app, BrowserWindow, ipcMain, screen } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { setupWindowManager } from "../../../../../src/main/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

const webPreferences: Electron.WebPreferences = {
  preload: path.join(__dirname, "preload.js"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

const manager = setupWindowManager({
  defaultWindowOptions: { webPreferences },
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences,
  });

  manager.setupForWindow(mainWindow);

  // STRICT_MODE env var enables React.StrictMode in the renderer — the e2e
  // suite launches a second app instance with this set to verify the Window
  // component survives StrictMode's dev-mode effect double-invocation.
  const loadOptions = process.env.STRICT_MODE ? { hash: "strict" } : undefined;
  mainWindow.loadFile(path.join(__dirname, "index.html"), loadOptions);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Test helper IPC handlers

ipcMain.handle("test:get-window-count", () => {
  return manager.getAllWindows().length;
});

// Total BrowserWindows in the process, minus the main window. Catches orphans
// that the manager lost track of (e.g., StrictMode double-open leaking a window
// that isn't in the manager's map because its registration was overwritten).
ipcMain.handle("test:get-total-browser-window-count", () => {
  return BrowserWindow.getAllWindows().filter((w) => w !== mainWindow).length;
});

ipcMain.handle("test:get-all-windows", () => {
  return manager.getAllWindows().map((instance) => ({
    id: instance.id,
    bounds: instance.getBounds(),
    title: instance.window?.getTitle() ?? "",
  }));
});

ipcMain.handle("test:get-window-props", (_event, id: string) => {
  const instance = manager.getWindow(id);
  if (!instance || instance.destroyed) return null;
  const win = instance.window;
  if (!win) return null;

  try {
    return {
      id,
      bounds: win.getBounds(),
      title: win.getTitle(),
      isResizable: win.isResizable(),
      isMovable: win.isMovable(),
      isMinimizable: win.isMinimizable(),
      isMaximizable: win.isMaximizable(),
      isClosable: win.isClosable(),
      isFocusable: win.isFocusable(),
      isAlwaysOnTop: win.isAlwaysOnTop(),
      isFullscreen: win.isFullScreen(),
      isMaximized: win.isMaximized(),
      isMinimized: win.isMinimized(),
      isFocused: win.isFocused(),
      isVisible: win.isVisible(),
    };
  } catch (e) {
    console.error("Error getting window props:", e);
    return null;
  }
});

ipcMain.handle("test:clear-all-state", () => {
  for (const instance of manager.getAllWindows()) {
    instance.destroy();
  }
});

ipcMain.handle("test:close-child-window", (_event, id: string) => {
  const instance = manager.getWindow(id);
  if (instance && !instance.destroyed && instance.window) {
    instance.window.close();
    return true;
  }
  return false;
});

ipcMain.handle(
  "test:resize-child-window",
  (_event, id: string, width: number, height: number) => {
    const instance = manager.getWindow(id);
    if (instance && !instance.destroyed && instance.window) {
      instance.window.setSize(width, height);
      return true;
    }
    return false;
  },
);

ipcMain.handle("test:get-child-web-preferences", (_event, id: string) => {
  const instance = manager.getWindow(id);
  if (instance && !instance.destroyed && instance.window) {
    return instance.window.webContents.getWebPreferences();
  }
  return null;
});

ipcMain.handle("test:get-display-info", () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  return {
    id: primaryDisplay.id,
    bounds: primaryDisplay.bounds,
    workArea: primaryDisplay.workArea,
    scaleFactor: primaryDisplay.scaleFactor,
  };
});

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
