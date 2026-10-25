// Speed test basé sur les points d'accès publics de Cloudflare (CORS ouvert).
const BASE = "https://speed.cloudflare.com";
const PING_COUNT = 12;
const PHASE_MS = 10000;      // durée de chaque phase débit
const STREAMS = 4;           // connexions parallèles
const DL_CHUNK = 25e6;       // octets par requête de téléchargement
const UL_CHUNK = 8e6;        // octets par requête d'envoi
const SCALE = [0, 5, 10, 50, 100, 250, 500, 1000]; // graduations de la jauge (Mbit/s)

const $ = (id) => document.getElementById(id);
const gauge = document.querySelector(".gauge");
const fill = $("gaugeFill");
const spark = $("spark");

if (navigator.userAgent.includes("Electron")) document.body.classList.add("desktop");

// --- Jauge : arc de 270°, de 135° (bas gauche) à 405° (bas droite) ---
const C = 150, R = 120;
const polar = (deg, r = R) => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
};
const arc = `M ${polar(135)} A ${R} ${R} 0 1 1 ${polar(45)}`;
$("gaugeTrack").setAttribute("d", arc);
fill.setAttribute("d", arc);
$("ticks").replaceChildren(...SCALE.map((v, i) => {
  const [x, y] = polar(135 + (270 * i) / (SCALE.length - 1), R - 32);
  const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
  t.setAttribute("x", x);
  t.setAttribute("y", y);
  t.textContent = v;
  return t;
}));

// Position (0..1) d'une vitesse sur l'échelle : chaque intervalle a la même longueur.
function scaleRatio(v) {
  const seg = 1 / (SCALE.length - 1);
  for (let i = 1; i < SCALE.length; i++) {
    if (v <= SCALE[i]) return seg * (i - 1 + (v - SCALE[i - 1]) / (SCALE[i] - SCALE[i - 1]));
  }
  return 1;
}

function setGauge(v) {
  const ratio = scaleRatio(Math.max(v, 0));
  fill.style.strokeDashoffset = 100 * (1 - ratio);
  // En dessous de ~0,1 Mbit/s, l'arc serait réduit à ses deux extrémités arrondies : on le masque.
  fill.style.opacity = ratio > 0.003 ? 1 : 0;
  $("liveValue").textContent = fmt(v);
}
const fmt = (n) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));
const mbps = (bytes, ms) => (bytes * 8) / (ms / 1000) / 1e6;

// --- Courbe de la phase en cours ---
let points = [];
function drawSpark(colors) {
  const dpr = window.devicePixelRatio || 1;
  const w = spark.clientWidth, h = spark.clientHeight;
  spark.width = w * dpr;
  spark.height = h * dpr;
  const ctx = spark.getContext("2d");
  ctx.scale(dpr, dpr);
  if (points.length < 2) return;
  const max = Math.max(...points.map((p) => p[1])) * 1.15 || 1;
  const x = (t) => (t / PHASE_MS) * w;
  const y = (v) => h - 4 - (v / max) * (h - 8);
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(1, colors[1]);
  ctx.beginPath();
  points.forEach(([t, v], i) => (i ? ctx.lineTo(x(t), y(v)) : ctx.moveTo(x(t), y(v))));
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.lineTo(x(points[points.length - 1][0]), h);
  ctx.lineTo(x(points[0][0]), h);
  ctx.closePath();
  const area = ctx.createLinearGradient(0, 0, 0, h);
  area.addColorStop(0, colors[0] + "55");
  area.addColorStop(1, colors[0] + "00");
  ctx.fillStyle = area;
  ctx.fill();
}

// --- Mesures ---
// Durée d'un aller-retour réseau : temps entre l'envoi de la requête et le premier octet
// de réponse, moins le temps de traitement annoncé par le serveur (en-tête Server-Timing).
// Sans cette soustraction, le ping inclut ~30 ms de calcul côté Cloudflare.
async function pingOnce() {
  const url = `${BASE}/__down?bytes=0&r=${Math.random()}`;
  const t0 = performance.now();
  const res = await fetch(url, { cache: "no-store" });
  await res.arrayBuffer();
  const fallback = performance.now() - t0;
  const serverMs = [...(res.headers.get("server-timing") || "").matchAll(/dur=([\d.]+)/g)]
    .reduce((sum, m) => sum + Number(m[1]), 0);
  const entry = performance.getEntriesByName(url).pop();
  const rtt = entry && entry.responseStart > 0 ? entry.responseStart - entry.requestStart : fallback;
  performance.clearResourceTimings();
  return Math.max(rtt - serverMs, 0.1);
}

// Ping = médiane ; gigue = écart moyen entre mesures successives, dans l'ordre où elles ont été prises.
function latencyStats(samples) {
  let jitter = 0;
  for (let i = 1; i < samples.length; i++) jitter += Math.abs(samples[i] - samples[i - 1]);
  const sorted = [...samples].sort((a, b) => a - b);
  return { ping: sorted[Math.floor(sorted.length / 2)], jitter: samples.length > 1 ? jitter / (samples.length - 1) : 0 };
}

async function measurePing() {
  const samples = [];
  for (let i = 0; i < PING_COUNT; i++) {
    const ms = await pingOnce();
    if (i > 0) samples.push(ms); // la 1re requête inclut l'ouverture TLS
    $("liveValue").textContent = ms.toFixed(0);
  }
  return latencyStats(samples);
}

// Dans l'app de bureau, un vrai ping ICMP donne la latence réseau pure et la perte de paquets.
// Sur le web (ou si l'ICMP est bloqué par le réseau), on se rabat sur la mesure HTTP, sans perte.
const desktop = window.speedtest;
async function measureLatency() {
  if (desktop) {
    $("liveValue").textContent = "…";
    const icmp = await desktop.icmp().catch(() => null);
    // Aucune réponse = ICMP filtré par le réseau, pas 100 % de perte.
    if (icmp && icmp.received > 0) {
      return { ...latencyStats(icmp.rtts), loss: (100 * (icmp.sent - icmp.received)) / icmp.sent };
    }
  }
  return { ...(await measurePing()), loss: null };
}

function showLoss(loss) {
  $("loss").textContent = loss === null ? "–" : loss < 10 && loss % 1 ? loss.toFixed(1) : loss.toFixed(0);
  $("lossUnit").textContent = loss !== null ? "%" : desktop ? "ICMP bloqué par le réseau" : "dans l'app Mac / Windows";
}

// Lance une mesure de débit : `worker(onBytes, signal)` est relancé en boucle sur STREAMS connexions.
async function measureThroughput(worker, colors) {
  const ctrl = new AbortController();
  const start = performance.now();
  let total = 0;
  const recent = []; // [temps, octets cumulés] pour la vitesse instantanée
  points = [];
  const onBytes = (n) => {
    total += n;
    recent.push([performance.now(), total]);
  };
  const timer = setInterval(() => {
    const now = performance.now();
    while (recent.length > 2 && now - recent[0][0] > 2000) recent.shift();
    if (recent.length > 1) {
      const [t0, b0] = recent[0];
      const v = mbps(total - b0, now - t0);
      setGauge(v);
      points.push([now - start, v]);
      drawSpark(colors);
    }
  }, 150);

  // Si le serveur refuse (ex. 429 « trop de requêtes »), on arrête aussitôt : relancer en
  // boucle ne ferait qu'aggraver le blocage et la mesure serait fausse.
  let refused = null;
  let phaseDone;
  const phase = new Promise((r) => { phaseDone = r; setTimeout(r, PHASE_MS); });
  // Dans un navigateur, un refus sans en-tête CORS ressemble à une simple erreur réseau :
  // après 3 échecs d'affilée, la connexion abandonne (avec une pause croissante entre-temps).
  const loop = async () => {
    let failures = 0;
    while (!ctrl.signal.aborted) {
      try {
        await worker(onBytes, ctrl.signal);
        failures = 0;
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (e instanceof HttpError || ++failures >= 3) {
          refused = e instanceof HttpError ? e : new HttpError(0);
          phaseDone();
          return;
        }
        await new Promise((r) => setTimeout(r, 250 * 2 ** failures));
      }
    }
  };
  let warm = null; // état à 2 s : on ignore la montée en charge TCP
  setTimeout(() => { warm = [performance.now(), total]; }, 2000);
  const runners = Array.from({ length: STREAMS }, loop);
  await phase;
  const end = [performance.now(), total];
  ctrl.abort();
  clearInterval(timer);
  await Promise.allSettled(runners);
  // Un refus en cours de route n'invalide pas la mesure s'il y a eu assez de données.
  if (refused && total < 1e6) throw refused;
  return warm ? mbps(end[1] - warm[1], end[0] - warm[0]) : mbps(end[1], end[0] - start);
}

class HttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

async function downloadWorker(onBytes, signal) {
  const res = await fetch(`${BASE}/__down?bytes=${DL_CHUNK}&r=${Math.random()}`, { signal, cache: "no-store" });
  if (!res.ok) throw new HttpError(res.status);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onBytes(value.length);
  }
}

const uploadBlob = new Blob([new Uint8Array(UL_CHUNK)]);
function uploadWorker(onBytes, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let sent = 0;
    xhr.upload.onprogress = (e) => { onBytes(e.loaded - sent); sent = e.loaded; };
    xhr.onload = () => (xhr.status >= 400 ? reject(new HttpError(xhr.status)) : resolve());
    xhr.onerror = xhr.onabort = reject;
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.open("POST", `${BASE}/__up?r=${Math.random()}`);
    xhr.send(uploadBlob);
  });
}

// --- Historique ---
// Optionnel (RGPD / art. 82 Informatique et Libertés) : rien n'est écrit sur l'appareil
// tant que l'utilisateur n'a pas activé « Garder sur cet appareil ». La clé « history »
// n'existe que si l'option est activée.
const historyEnabled = () => {
  try { return localStorage.getItem("history") !== null; } catch { return false; }
};
function setHistoryEnabled(on) {
  try {
    if (on) localStorage.setItem("history", localStorage.getItem("history") || "[]");
    else localStorage.removeItem("history");
  } catch { /* stockage indisponible */ }
  renderHistory();
}
// Le stockage local peut être modifié : on ne garde que des entrées numériques valides.
const isNum = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
function loadHistory() {
  if (!historyEnabled()) return [];
  try {
    const list = JSON.parse(localStorage.getItem("history") || "[]");
    return Array.isArray(list)
      ? list.filter((h) => h && isNum(h.date) && isNum(h.ping) && isNum(h.down) && isNum(h.up)).slice(0, 10)
      : [];
  } catch { return []; }
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}
function renderHistory() {
  const enabled = historyEnabled();
  $("historyToggle").checked = enabled;
  const list = loadHistory();
  $("clearBtn").hidden = !list.length;
  const items = list.map((h) => {
    const li = document.createElement("li");
    li.append(
      el("time", "", new Date(h.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })),
      el("span", "d", `↓ ${fmt(h.down)}`),
      el("span", "u", `↑ ${fmt(h.up)}`),
      el("span", "", `${h.ping.toFixed(0)} ms`),
    );
    return li;
  });
  const empty = enabled
    ? "Aucun test enregistré pour l'instant."
    : "Historique désactivé : les résultats ne sont pas conservés.";
  $("history").replaceChildren(...(items.length ? items : [el("li", "empty", empty)]));
}
function saveResult(r) {
  if (!historyEnabled()) return;
  const list = [{ date: Date.now(), ...r }, ...loadHistory()].slice(0, 10);
  try { localStorage.setItem("history", JSON.stringify(list)); } catch { /* stockage indisponible */ }
  renderHistory();
}

// --- Déroulé du test ---
let running = false;
async function run() {
  if (running) return;
  running = true;
  desktop?.setRunning(true);
  $("startBtn").hidden = true;
  $("againBtn").hidden = true;
  $("readout").hidden = false;
  for (const id of ["ping", "jitter", "loss", "download", "upload"]) $(id).textContent = "–";
  points = [];
  drawSpark(["#7c3aed", "#22d3ee"]);
  try {
    gauge.classList.remove("up");
    setGauge(0);
    $("phase").textContent = desktop ? "Ping et perte" : "Ping";
    $("liveUnit").textContent = "ms";
    const { ping, jitter, loss } = await measureLatency();
    $("ping").textContent = ping.toFixed(0);
    $("jitter").textContent = jitter.toFixed(1);
    showLoss(loss);

    $("phase").textContent = "↓ Téléchargement";
    $("liveUnit").textContent = "Mbit/s";
    const down = await measureThroughput(downloadWorker, ["#7c3aed", "#22d3ee"]);
    $("download").textContent = fmt(down);

    $("phase").textContent = "↑ Envoi";
    gauge.classList.add("up");
    setGauge(0);
    const up = await measureThroughput(uploadWorker, ["#ec4899", "#f59e0b"]);
    $("upload").textContent = fmt(up);

    gauge.classList.remove("up");
    setGauge(down);
    $("phase").textContent = "Téléchargement";
    saveResult({ ping, jitter, down, up });
  } catch (e) {
    gauge.classList.remove("up");
    setGauge(0);
    $("liveValue").textContent = "!";
    $("phase").textContent = !(e instanceof HttpError)
      ? "Hors ligne"
      : e.status === 429 || e.status === 0 ? "Serveur saturé" : `Erreur ${e.status}`;
    $("liveUnit").textContent = e instanceof HttpError ? "Réessayez dans quelques minutes" : "Vérifiez votre connexion";
    console.error(e);
  } finally {
    $("againBtn").hidden = false;
    running = false;
    desktop?.setRunning(false);
  }
}

$("startBtn").addEventListener("click", run);
desktop?.onStartTest(run); // menu Test › Lancer le test (⌘R)
showLoss(null);
$("againBtn").addEventListener("click", run);
$("historyToggle").addEventListener("change", (e) => setHistoryEnabled(e.target.checked));
$("clearBtn").addEventListener("click", () => {
  try { localStorage.setItem("history", "[]"); } catch { /* stockage indisponible */ }
  renderHistory();
});
renderHistory();
