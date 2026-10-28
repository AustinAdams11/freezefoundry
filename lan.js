// LAN Foundry: find LM Studio and Ollama servers on this machine's local networks.
const os = require('os');

const PORTS = { 1234: 'LM Studio', 11434: 'Ollama' };

// Private IPv4 /24 networks this machine is on (10/8, 172.16/12, 192.168/16 only; never public ranges).
function localSubnets() {
  const out = new Set();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const [p, q] = a.address.split('.').map(Number);
      if (p === 10 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168)) out.add(a.address.split('.').slice(0, 3).join('.'));
    }
  }
  return [...out].slice(0, 4);
}

async function listModels(baseUrl, timeoutMs = 3000) {
  const r = await fetch(baseUrl.replace(/\/$/, '') + '/models', { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  return (d.data || []).map(m => m.id).filter(Boolean);
}

// Probe every host on each subnet for the two well-known ports. About 2-4 seconds on a home network.
async function scan() {
  const own = new Set(Object.values(os.networkInterfaces()).flat().map(a => a && a.address));
  const jobs = [];
  for (const net of localSubnets()) for (let h = 1; h < 255; h++) for (const port of Object.keys(PORTS)) jobs.push([`${net}.${h}`, port]);
  const found = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [host, port] = jobs[next++];
      const baseUrl = `http://${host}:${port}/v1`;
      try {
        const models = await listModels(baseUrl, 700);
        found.push({ host, port: Number(port), kind: PORTS[port], baseUrl, models, thisMachine: own.has(host) });
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: 128 }, worker));
  return found.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
}

module.exports = { scan, listModels, localSubnets };
