const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  openFileDialog: () => ipcRenderer.invoke("dialog:openFile"),
  processVideo: (payload) => ipcRenderer.invoke("pipeline:process", payload),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  onError: (callback) => {
    const handler = (_event, data) => callback(data.message);
    ipcRenderer.on("pipeline:error", handler);
    return () => ipcRenderer.removeListener("pipeline:error", handler);
  },
  onProgress: (callback) => {
    const handler = (_event, data) => callback(data.progress, data.message);
    ipcRenderer.on("pipeline:progress", handler);
    return () => ipcRenderer.removeListener("pipeline:progress", handler);
  }
});
