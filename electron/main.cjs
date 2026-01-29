const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
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
}

app.whenReady().then(() => {
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

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
