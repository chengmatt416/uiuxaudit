const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("uaDesktop", {
  isDesktop: true,
  platform: process.platform,
  convert: (opts) => ipcRenderer.invoke("ua:convert", opts),
  verify: (opts) => ipcRenderer.invoke("ua:verify", opts),
  chromiumPath: () => ipcRenderer.invoke("ua:chromiumPath"),
});
