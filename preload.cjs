const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bsm", {
  getInstalledMaps: () => ipcRenderer.invoke("bsm:listInstalledMaps"),
  deleteInstalledMap: (folderName) =>
    ipcRenderer.invoke("bsm:deleteInstalledMap", folderName),
  getCoverImage: (coverPath) =>
    ipcRenderer.invoke("bsm:getCoverImage", coverPath),
});
