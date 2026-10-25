// Fenêtre Electron qui affiche l'application web (web/index.html).
const { app, BrowserWindow, session, shell } = require("electron");
const path = require("path");

const INDEX = path.join(__dirname, "..", "web", "index.html");

function createWindow() {
  const win = new BrowserWindow({
    width: 760,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    title: "SpeedTest",
    backgroundColor: "#0b0d17",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  win.loadFile(INDEX);
}

// Seuls les liens https s'ouvrent, et dans le navigateur par défaut.
function openExternal(url) {
  try {
    if (new URL(url).protocol === "https:") shell.openExternal(url);
  } catch { /* URL invalide */ }
}

app.on("web-contents-created", (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  // La fenêtre ne quitte jamais la page de l'application.
  contents.on("will-navigate", (e, url) => {
    e.preventDefault();
    openExternal(url);
  });
  contents.on("will-attach-webview", (e) => e.preventDefault());
});

app.whenReady().then(() => {
  // Aucune permission (caméra, micro, localisation, notifications…) n'est nécessaire.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
