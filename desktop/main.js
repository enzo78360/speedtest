// Fenêtre Electron qui affiche l'application web (web/index.html).
const { app, BrowserWindow, session, shell } = require("electron");
const path = require("path");

// L'app ne garde aucun secret (ni cookie ni mot de passe) : on évite que Chromium
// demande l'accès au trousseau macOS (« SpeedTest Safe Storage ») au lancement.
app.commandLine.appendSwitch("use-mock-keychain");

const WEB_DIR = path.join(__dirname, "..", "web");
const INDEX = path.join(WEB_DIR, "index.html");

// Seules les pages de l'application (dossier web/) peuvent être affichées dans la fenêtre.
function isAppPage(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "file:") return false;
    const file = path.normalize(decodeURIComponent(u.pathname.replace(/^\/([A-Za-z]:)/, "$1")));
    return file.startsWith(WEB_DIR + path.sep) && file.endsWith(".html");
  } catch {
    return false;
  }
}

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
      // Le correcteur peut télécharger des dictionnaires depuis des serveurs tiers : inutile ici.
      spellcheck: false,
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
  // La fenêtre ne quitte jamais les pages de l'application.
  contents.on("will-navigate", (e, url) => {
    if (isAppPage(url)) return;
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
