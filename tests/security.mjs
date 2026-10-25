// Tests de sécurité : lance l'app Electron et tente des attaques classiques.
// Usage : npm run test:security  (après `npm install`)
// Avec APP=<chemin du binaire empaqueté>, vérifie aussi les fusibles de l'app compilée.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";

const require = createRequire(import.meta.url);
const electron = require("electron");
const PORT = 9333;
let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Connexion au moteur de rendu via le protocole DevTools ---
async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === "page" && t.url.endsWith("index.html"));
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
        let id = 0;
        const pending = new Map();
        ws.onmessage = (m) => {
          const msg = JSON.parse(m.data);
          if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
        };
        const evaluate = (expression) => new Promise((resolve) => {
          pending.set(++id, (msg) => resolve(msg.result?.result?.value));
          ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
        });
        return { ws, evaluate };
      }
    } catch { /* pas encore prêt */ }
    await sleep(250);
  }
  throw new Error("Impossible de se connecter à la fenêtre de l'app");
}

async function rendererTests() {
  const app = spawn(electron, [".", `--remote-debugging-port=${PORT}`], { stdio: "ignore" });
  try {
    const { ws, evaluate } = await connect();
    await sleep(500);

    check("Pas d'accès à Node.js (require)", (await evaluate("typeof require")) === "undefined");
    check("Pas d'accès à Node.js (process)", (await evaluate("typeof process")) === "undefined");

    const csp = await evaluate(`fetch("https://example.com").then(() => "ok", () => "bloqué")`);
    check("CSP : requêtes vers d'autres sites bloquées", csp === "bloqué");

    const allowed = await evaluate(`fetch("https://speed.cloudflare.com/__down?bytes=0").then(() => "ok", () => "bloqué")`);
    check("CSP : serveur de mesure autorisé", allowed === "ok");

    await evaluate(`window.__pwned = false;
      const d = document.createElement("div");
      d.innerHTML = '<img src="x" onerror="window.__pwned = true">';
      document.body.append(d);
      const s = document.createElement("script");
      s.textContent = "window.__pwned = true";
      document.body.append(s); true`);
    await sleep(300);
    check("CSP : scripts injectés non exécutés", (await evaluate("window.__pwned")) === false);

    await evaluate(`localStorage.setItem("history", JSON.stringify([
      { date: Date.now(), ping: "<img src=x onerror=window.__pwned2=true>", down: 1, up: 1 },
      { date: Date.now(), ping: 10, down: "<b>x</b>", up: 1 },
      { date: Date.now(), ping: 12, down: 100, up: 50 }
    ])); location.reload(); true`);
    await sleep(1500);
    const { evaluate: evaluate2, ws: ws2 } = await connect();
    const rows = await evaluate2(`document.querySelectorAll("#history li").length`);
    check("Historique falsifié : entrées invalides ignorées", rows === 1, `${rows} ligne(s) affichée(s)`);
    check("Historique falsifié : pas d'injection HTML", (await evaluate2("window.__pwned2 === undefined && !document.querySelector('#history img, #history b')")) === true);
    await evaluate2(`localStorage.removeItem("history"); true`);

    const popup = await evaluate2(`String(window.open("http://example.com"))`);
    check("Fenêtres pop-up refusées", popup === "null");

    await evaluate2(`location.href = "http://example.com"; true`);
    await sleep(1000);
    const url = await evaluate2("location.href");
    check("Navigation hors de l'app bloquée", typeof url === "string" && url.startsWith("file:"), url);

    const geo = await evaluate2(`new Promise((r) => navigator.geolocation.getCurrentPosition(() => r("accordé"), () => r("refusé"), { timeout: 3000 }))`);
    check("Permissions (localisation) refusées", geo === "refusé");

    ws.close();
    ws2.close();
  } finally {
    app.kill();
  }
}

// --- Fusibles de l'app compilée ---
function portOpen(port) {
  return new Promise((r) => {
    const s = net.connect(port, "127.0.0.1", () => { s.destroy(); r(true); });
    s.on("error", () => r(false));
  });
}

async function packagedTests(bin) {
  const run = spawnSync(bin, ["-e", "console.log('PWNED')"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 8000, encoding: "utf8",
  });
  check("ELECTRON_RUN_AS_NODE ignoré", !String(run.stdout).includes("PWNED"));

  const app = spawn(bin, ["--inspect=9339"], { stdio: "ignore" });
  await sleep(4000);
  check("Débogueur --inspect désactivé", !(await portOpen(9339)));
  app.kill();
}

await rendererTests();
if (process.env.APP) await packagedTests(process.env.APP);
console.log(failures ? `\n${failures} test(s) en échec` : "\nTous les tests de sécurité passent");
process.exit(failures ? 1 : 0);
