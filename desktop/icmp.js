// Ping ICMP via la commande système `ping` (impossible depuis une page web).
// Donne la latence réseau pure et la perte de paquets, comme les outils natifs.
const { execFile } = require("child_process");

const HOST = "speed.cloudflare.com";
const RTT = /[=<]\s*([\d.,]+)\s*ms/i; // « time=12.3 ms », « temps=12 ms », « temps<1ms »

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (_err, stdout) => resolve(String(stdout || "")));
  });
}

function parseRtt(line) {
  const m = line.match(RTT);
  return m ? Number(m[1].replace(",", ".")) : null;
}

// Résultat : { sent, received, rtts } — rtts dans l'ordre d'arrivée, en ms.
async function icmpProbe() {
  if (process.platform === "win32") {
    // ping.exe n'accepte pas d'intervalle < 1 s : on enchaîne des pings unitaires.
    const count = 20;
    const rtts = [];
    for (let i = 0; i < count; i++) {
      const out = await run("ping", ["-n", "1", "-w", "1000", HOST], 3000);
      const rtt = /TTL=/i.test(out) ? parseRtt(out) : null;
      if (rtt !== null) rtts.push(rtt);
    }
    return { sent: count, received: rtts.length, rtts };
  }

  // macOS autorise un intervalle de 0,1 s sans droits administrateur (Linux : 0,2 s).
  const count = 50;
  const mac = process.platform === "darwin";
  const args = mac
    ? ["-c", String(count), "-i", "0.1", "-W", "1000", HOST]
    : ["-c", String(count), "-i", "0.2", "-W", "1", HOST];
  const out = await run(mac ? "/sbin/ping" : "ping", args, 30000);
  const rtts = out.split("\n").filter((l) => /icmp_seq/i.test(l)).map(parseRtt).filter((r) => r !== null);
  return { sent: count, received: rtts.length, rtts };
}

module.exports = { icmpProbe };
