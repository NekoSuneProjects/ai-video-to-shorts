const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const path = require("path");
const { processVideo } = require("./processor.cjs");

const isDev = !!process.env.VITE_DEV_SERVER_URL;

async function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    backgroundColor: "#0b0f1a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    await win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
  return win;
}

app.whenReady().then(() => {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  const updateStatePath = path.join(app.getPath("userData"), "update-state.json");

  const readUpdateState = () => {
    try {
      return JSON.parse(fs.readFileSync(updateStatePath, "utf8"));
    } catch (error) {
      return {};
    }
  };

  const writeUpdateState = (state) => {
    try {
      fs.writeFileSync(updateStatePath, JSON.stringify(state, null, 2));
    } catch (error) {
      // ignore
    }
  };

  const shouldNotifyUpdate = () => {
    const state = readUpdateState();
    const remindUntil = Number(state?.remindUntil || 0);
    return !remindUntil || Date.now() > remindUntil;
  };

  const getUpdateChannel = () => {
    const state = readUpdateState();
    return state?.channel === "beta" ? "beta" : "stable";
  };

  let mainWindow = null;

  ipcMain.handle("dialog:openFile", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Videos", extensions: ["mp4", "mov", "mkv", "webm"] }]
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("pipeline:process", async (event, payload) => {
    try {
      return await processVideo(payload, (progress, message) => {
        event.sender.send("pipeline:progress", { progress, message });
      });
    } catch (error) {
      const message = error?.message || "Processing failed";
      event.sender.send("pipeline:error", { message });
      return { error: message };
    }
  });

  ipcMain.handle("shell:openExternal", async (_event, url) => {
    if (!url) return null;
    return shell.openExternal(url);
  });

  ipcMain.handle("update:setChannel", async (_event, channel) => {
    const normalized = channel === "beta" ? "beta" : "stable";
    const state = readUpdateState();
    writeUpdateState({ ...state, channel: normalized });
    return { status: "ok", channel: normalized };
  });

  ipcMain.handle("update:getChannel", async () => {
    return { channel: getUpdateChannel() };
  });

  ipcMain.handle("app:getVersion", async () => {
    return { version: app.getVersion() };
  });

  ipcMain.handle("update:check", async (event) => {
    const updateProvider = process.env.UPDATE_PROVIDER || "github";
    const snoozed = !shouldNotifyUpdate();
    try {
      event.sender.send("update:status", { status: "checking", snoozed });
      autoUpdater.allowPrerelease = getUpdateChannel() === "beta";
      if (updateProvider === "generic") {
        const updateUrl = process.env.UPDATE_URL;
        if (!updateUrl) {
          event.sender.send("update:status", { status: "disabled", snoozed });
          return { status: "disabled" };
        }
        autoUpdater.setFeedURL({ provider: "generic", url: updateUrl });
      } else {
        autoUpdater.setFeedURL({
          provider: "github",
          owner: "NekoSuneProjects",
          repo: "ai-video-to-shorts"
        });
      }
      autoUpdater.checkForUpdates();
      return { status: "checking" };
    } catch (error) {
      event.sender.send("update:status", { status: "error", message: error?.message, snoozed });
      return { status: "error" };
    }
  });

  ipcMain.handle("update:install", async () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle("update:remindLater", async () => {
    writeUpdateState({ remindUntil: Date.now() + 24 * 60 * 60 * 1000 });
    return { status: "remind" };
  });

  createWindow().then((win) => {
    mainWindow = win;
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send("update:status", { status: "available", info, snoozed: !shouldNotifyUpdate() });
  });

  autoUpdater.on("update-not-available", () => {
    mainWindow?.webContents.send("update:status", { status: "none", snoozed: !shouldNotifyUpdate() });
  });

  autoUpdater.on("update-downloaded", (info) => {
    mainWindow?.webContents.send("update:status", { status: "downloaded", info, snoozed: !shouldNotifyUpdate() });
  });

  autoUpdater.on("error", (error) => {
    mainWindow?.webContents.send("update:status", { status: "error", message: error?.message, snoozed: !shouldNotifyUpdate() });
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
