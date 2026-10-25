// Pont minimal entre la page et l'app de bureau : la page n'a toujours aucun accès
// à Node.js, seulement à ces trois fonctions.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("speedtest", {
  icmp: () => ipcRenderer.invoke("icmp"),
  setRunning: (running) => ipcRenderer.send("test-running", running === true),
  onStartTest: (callback) => ipcRenderer.on("start-test", () => callback()),
});
