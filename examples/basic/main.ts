/**
 * Basic example: Main process setup
 *
 * This file sets up the Electron main process with the window manager.
 */

import { app, BrowserWindow } from "electron";
import path from "path";
import { setupWindowManager } from "@loc/electron-window/main";

// Set up the window manager
const windowManager = setupWindowManager({
  defaultWindowOptions: {
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  },
});

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Set up IPC handlers for this window
  windowManager.setupForWindow(mainWindow);

  // Load your app (adjust URL for your dev server or production build)
  mainWindow.loadURL("http://localhost:5173");

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Clean up on quit
app.on("quit", () => {
  windowManager.destroy();
});
