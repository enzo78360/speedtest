// Tests de sécurité : lance l'app Electron et tente des attaques classiques.
// Usage : npm run test:security  (après `npm install`)
// Avec APP=<chemin du binaire empaqueté>, tous les tests visent l'app compilée (fusibles compris).
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
        // Le premier lancement d'une app fraîchement compilée peut être lent : on attend la page complète.
        await evaluate(`new Promise((r) => document.readyState === "complete" ? r(true) : addEventListener("load", () => r(true)))`);
        return { ws, evaluate };
      }
    } catch { /* pas encore prêt */ }
    await sleep(250);
  }
  throw new Error("Impossible de se connecter à la fenêtre de l'app");
}

async function rendererTests() {
  const [bin, args] = process.env.APP ? [process.env.APP, []] : [electron, ["."]];
  const app = spawn(bin, [...args, `--remote-debugging-port=${PORT}`], { stdio: "ignore" });
  try {
    const { ws, evaluate } = await connect();
    await sleep(500);

    check("L'interface s'affiche", (await evaluate(`!!document.getElementById("startBtn") && document.body.innerText.includes("SpeedTest")`)) === true);

    check("Pas d'accès à Node.js (require)", (await evaluate("typeof require")) === "undefined");
    check("Pas d'accès à Node.js (process)", (await evaluate("typeof process")) === "undefined");
    check("Pont vers l'app limité à 3 fonctions", (await evaluate("Object.keys(window.speedtest).sort().join()")) === "icmp,onStartTest,setRunning");

    // Le réseau de la CI peut filtrer l'ICMP : on vérifie la forme du résultat, pas la connexion.
    const icmp = await evaluate("window.speedtest.icmp()");
    check("Mesure ICMP (perte de paquets) valide",
      icmp && icmp.sent > 0 && icmp.received >= 0 && icmp.received <= icmp.sent && icmp.rtts.length === icmp.received,
      icmp ? `${icmp.received}/${icmp.sent} paquets reçus` : "aucun résultat");

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
    // Serveur qui refuse (429) : arrêt immédiat, sans boucle de requêtes.
    const refusal = await evaluate2(`(async () => {
      const orig = window.fetch;
      let calls = 0;
      window.fetch = async () => { calls++; return new Response("", { status: 429 }); };
      const t0 = performance.now();
      let status = null;
      try { await measureThroughput(downloadWorker, ["#000000", "#000000"]); } catch (e) { status = e.status; }
      window.fetch = orig;
      return { status, calls, ms: performance.now() - t0 };
    })()`);
    check("Serveur saturé : arrêt immédiat sans boucle", refusal?.status === 429 && refusal.calls <= 8 && refusal.ms < 2000,
      refusal ? `${refusal.calls} requêtes, ${Math.round(refusal.ms)} ms` : "");

    // Serveur qui répond normalement (simulé, pour ne pas dépendre de Cloudflare) : mesure > 0 sur toute la phase.
    const okRun = await evaluate2(`(async () => {
      const orig = window.fetch;
      // Petite pause comme un vrai réseau (sinon la boucle ne rend jamais la main au navigateur).
      window.fetch = async () => { await new Promise((r) => setTimeout(r, 20)); return new Response(new Uint8Array(2e6)); };
      const t0 = performance.now();
      let speed = null, error = null;
      try { speed = await measureThroughput(downloadWorker, ["#000000", "#000000"]); } catch (e) { error = String(e); }
      window.fetch = orig;
      return { speed, error, ms: performance.now() - t0 };
    })()`);
    check("Téléchargement réussi : débit mesuré sur toute la phase", okRun?.speed > 1 && okRun.ms >= 9500,
      okRun ? (okRun.error || `${Math.round(okRun.speed)} Mbit/s simulés en ${Math.round(okRun.ms)} ms`) : "");

    // Même refus vu par un navigateur (sans en-tête CORS) : simple erreur réseau.
    const netFail = await evaluate2(`(async () => {
      const orig = window.fetch;
      let calls = 0;
      window.fetch = async () => { calls++; throw new TypeError("Failed to fetch"); };
      const t0 = performance.now();
      let status = null;
      try { await measureThroughput(downloadWorker, ["#000000", "#000000"]); } catch (e) { status = e.status; }
      window.fetch = orig;
      return { status, calls, ms: performance.now() - t0 };
    })()`);
    check("Erreurs réseau répétées : abandon sans boucle", netFail?.status === 0 && netFail.calls <= 12 && netFail.ms < 3000,
      netFail ? `${netFail.calls} requêtes, ${Math.round(netFail.ms)} ms` : "");

    // --- Vie privée (RGPD) : état d'une première ouverture ---
    await evaluate2(`localStorage.clear(); location.reload(); true`);
    await sleep(1500);
    const { evaluate: evaluate3, ws: ws3 } = await connect();
    check("RGPD : aucun cookie", (await evaluate3("document.cookie")) === "");
    check("RGPD : rien enregistré sur l'appareil par défaut", (await evaluate3("localStorage.length")) === 0);
    check("RGPD : historique désactivé par défaut", (await evaluate3(`document.getElementById("historyToggle").checked`)) === false);
    const thirdParty = await evaluate3(`performance.getEntriesByType("resource").map((r) => r.name).filter((u) => !u.startsWith("file:"))`);
    check("RGPD : aucune requête vers un tiers avant GO", Array.isArray(thirdParty) && thirdParty.length === 0, thirdParty?.join(", "));
    await evaluate3(`document.getElementById("historyToggle").click(); true`);
    check("RGPD : activer l'historique l'enregistre", (await evaluate3(`localStorage.getItem("history")`)) === "[]");
    await evaluate3(`document.getElementById("historyToggle").click(); true`);
    check("RGPD : désactiver l'historique l'efface", (await evaluate3("localStorage.length")) === 0);
    await evaluate3(`document.querySelector('a[href="confidentialite.html"]').click(); true`);
    await sleep(1000);
    const privacyUrl = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    check("Page Confidentialité accessible", privacyUrl.some((t) => t.type === "page" && t.url.endsWith("confidentialite.html")));
    ws3.close();

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
