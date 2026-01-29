const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("fs");
const { checkForUpdate, openUpdateUrl, downloadAndInstall } = require("./update.cjs");
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
    const snoozed = !shouldNotifyUpdate();
    event.sender.send("update:status", { status: "checking", snoozed });
    try {
      const result = await checkForUpdate({
        owner: "NekoSuneProjects",
        repo: "ai-video-to-shorts",
        channel: getUpdateChannel()
      });
      event.sender.send("update:status", { ...result, snoozed });
      return result;
    } catch (error) {
      const message = error?.message || "Update check failed";
      event.sender.send("update:status", { status: "error", message, snoozed });
      return { status: "error", message };
    }
  });

  ipcMain.handle("update:install", async (_event, url) => {
    return openUpdateUrl(url);
  });

  ipcMain.handle("update:downloadInstall", async (_event, asset) => {
    return downloadAndInstall(asset);
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

  // no electron-updater events in custom GitHub polling flow
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
