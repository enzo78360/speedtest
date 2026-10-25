// Fenêtre Electron qui affiche l'application web (web/index.html).
const { app, BrowserWindow, Menu, ipcMain, powerSaveBlocker, screen, session, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { icmpProbe } = require("./icmp");

// L'app ne garde aucun secret (ni cookie ni mot de passe) : on évite que Chromium
// demande l'accès au trousseau macOS (« SpeedTest Safe Storage ») au lancement.
app.commandLine.appendSwitch("use-mock-keychain");

const WEB_DIR = path.join(__dirname, "..", "web");
const INDEX = path.join(WEB_DIR, "index.html");
const isMac = process.platform === "darwin";

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

// --- Taille et position de la fenêtre, retrouvées au lancement suivant ---
const stateFile = () => path.join(app.getPath("userData"), "window.json");
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    const area = screen.getDisplayMatching(b).workArea;
    const visible = b.x >= area.x - 50 && b.y >= area.y - 50 && b.x < area.x + area.width && b.y < area.y + area.height;
    return visible ? b : {};
  } catch {
    return {};
  }
}
function saveBounds(win) {
  try { fs.writeFileSync(stateFile(), JSON.stringify(win.getNormalBounds())); } catch { /* sans importance */ }
}

let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 760,
    height: 820,
    ...loadBounds(),
    minWidth: 380,
    minHeight: 600,
    title: "SpeedTest",
    show: false,
    backgroundColor: "#0b0d17",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Le correcteur peut télécharger des dictionnaires depuis des serveurs tiers : inutile ici.
      spellcheck: false,
      // Les mesures restent justes même si la fenêtre passe en arrière-plan.
      backgroundThrottling: false,
      devTools: !app.isPackaged,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.on("close", () => saveBounds(win));
  win.on("closed", () => { if (mainWindow === win) mainWindow = null; });
  win.loadFile(INDEX);
  mainWindow = win;
}

// Seuls les liens https s'ouvrent, et dans le navigateur par défaut.
function openExternal(url) {
  try {
    if (new URL(url).protocol === "https:") shell.openExternal(url);
  } catch { /* URL invalide */ }
}

function showWindow() {
  if (!mainWindow) createWindow();
  else mainWindow.show();
  return mainWindow;
}

function buildMenu() {
  const sep = { type: "separator" };
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: "about", label: "À propos de SpeedTest" },
        sep,
        { role: "hide", label: "Masquer SpeedTest" },
        { role: "hideOthers", label: "Masquer les autres" },
        { role: "unhide", label: "Tout afficher" },
        sep,
        { role: "quit", label: "Quitter SpeedTest" },
      ],
    }] : [{ label: "Fichier", submenu: [{ role: "quit", label: "Quitter" }] }]),
    {
      label: "Test",
      submenu: [{
        label: "Lancer le test",
        accelerator: "CmdOrCtrl+R",
        click: () => showWindow().webContents.send("start-test"),
      }],
    },
    {
      label: "Édition",
      submenu: [{ role: "copy", label: "Copier" }, { role: "selectAll", label: "Tout sélectionner" }],
    },
    {
      label: "Fenêtre",
      submenu: [
        { role: "minimize", label: "Réduire" },
        { role: "zoom", label: "Zoom" },
        ...(isMac ? [sep, { role: "front", label: "Tout ramener au premier plan" }] : []),
        sep,
        { role: "close", label: "Fermer la fenêtre" },
      ],
    },
    {
      label: "Aide",
      role: "help",
      submenu: [
        { label: "Confidentialité et mentions légales", click: () => showWindow().loadFile(path.join(WEB_DIR, "confidentialite.html")) },
        { label: "Code source sur GitHub", click: () => openExternal("https://github.com/enzo78360/speedtest") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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

// --- Fonctions offertes à la page (voir preload.js) ---
const fromApp = (event) => isAppPage(event.senderFrame?.url || "");

ipcMain.handle("icmp", (event) => (fromApp(event) ? icmpProbe() : null));

// Pendant un test, macOS ne doit pas mettre l'app en veille (App Nap) : ça fausserait la mesure.
let blocker = null;
ipcMain.on("test-running", (event, running) => {
  if (!fromApp(event)) return;
  if (running && blocker === null) blocker = powerSaveBlocker.start("prevent-app-suspension");
  if (!running && blocker !== null) {
    powerSaveBlocker.stop(blocker);
    blocker = null;
  }
});

app.whenReady().then(() => {
  // Aucune permission (caméra, micro, localisation, notifications…) n'est nécessaire.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  app.setAboutPanelOptions({
    applicationName: "SpeedTest",
    applicationVersion: app.getVersion(),
    version: "",
    copyright: "© 2026 enzo78360 — Licence MIT",
  });
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
