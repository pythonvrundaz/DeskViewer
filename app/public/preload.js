const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  openViewerWindow: () => ipcRenderer.send("open-viewer-window"),

  sendMouseMove: (data) => ipcRenderer.send("mousemove", data),
  sendMouseDown: (data) => ipcRenderer.send("mousedown", data),
  sendScroll: (data) => ipcRenderer.send("scroll", data),
  sendKeyDown: (data) => ipcRenderer.send("keydown", data),
});
