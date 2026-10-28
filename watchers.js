// Watchers: poll an HTTP JSON endpoint or a TCP JSON API (cgminer/Antminer style) on a timer,
// keep a short history of chosen values, and raise an alert when a rule turns true.
const fs = require('fs');
const net = require('net');

const OPS = ['<', '<=', '>', '>=', '==', '!=', 'changed', 'offline'];
const MIN_INTERVAL = 15;

// "SUMMARY.0.MHS 5s" -> obj.SUMMARY[0]["MHS 5s"]
function getPath(obj, p) {
  return String(p || '').split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function clean(w) {
  const kind = w.kind === 'tcp' ? 'tcp' : 'http';
  const out = {
    id: /^[\w-]{1,40}$/.test(w.id || '') ? w.id : 'w' + Date.now().toString(36),
    name: String(w.name || '').trim().slice(0, 80) || 'Watcher',
    kind,
    intervalSec: Math.max(MIN_INTERVAL, Math.min(86400, parseInt(w.intervalSec, 10) || 60)),
    fields: (Array.isArray(w.fields) ? w.fields : String(w.fields || '').split(',')).map(f => String(f).trim()).filter(Boolean).slice(0, 8),
    enabled: w.enabled !== false,
    aiPrompt: String(w.aiPrompt || '').trim().slice(0, 2000) || undefined
  };
  if (w.webhook) {
    const h = new URL(String(w.webhook));
    if (!['http:', 'https:'].includes(h.protocol)) throw new Error('The webhook must be an http:// or https:// address.');
    out.webhook = h.href;
  }
  if (kind === 'http') {
    const u = new URL(String(w.url || ''));
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Use an http:// or https:// address.');
    out.url = u.href;
  } else {
    out.host = String(w.host || '').trim();
    out.port = parseInt(w.port, 10);
    if (!/^[\w.-]{1,253}$/.test(out.host) || !(out.port > 0 && out.port < 65536)) throw new Error('Give a host (e.g. 192.168.1.50) and a port (e.g. 4028).');
    out.command = String(w.command || 'summary').trim().slice(0, 200);
  }
  if (w.rule && OPS.includes(w.rule.op)) {
    out.rule = { op: w.rule.op, path: String(w.rule.path || out.fields[0] || '').trim() };
    if (!['changed', 'offline'].includes(w.rule.op)) {
      out.rule.value = Number(w.rule.value);
      if (!Number.isFinite(out.rule.value)) throw new Error('The alert rule needs a number to compare against.');
    }
  }
  return out;
}

function readTcp(host, port, command) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const sock = net.connect({ host, port, timeout: 8000 }, () => {
      // cgminer-style APIs take {"command":"summary"}; anything starting with { is sent as-is
      sock.write(command.startsWith('{') ? command : JSON.stringify({ command }));
    });
    sock.on('data', d => { buf += d; if (buf.length > 1e6) sock.destroy(new Error('Reply too large')); });
    sock.on('timeout', () => sock.destroy(new Error('Timed out after 8s')));
    sock.on('error', reject);
    sock.on('close', () => {
      const text = buf.replace(/\0/g, '').trim();
      try { resolve(JSON.parse(text)); } catch { text ? resolve(text) : reject(new Error('No reply')); }
    });
  });
}

async function readOnce(w) {
  if (w.kind === 'tcp') return readTcp(w.host, w.port, w.command);
  const r = await fetch(w.url, { signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = (await r.text()).slice(0, 1e6);
  try { return JSON.parse(text); } catch { return text; }
}

function check(rule, value, prev, ok) {
  if (!rule) return false;
  if (rule.op === 'offline') return !ok;
  if (!ok || value === undefined) return false;
  if (rule.op === 'changed') return prev !== undefined && JSON.stringify(prev) !== JSON.stringify(value);
  const v = Number(value);
  if (!Number.isFinite(v)) return false;
  return { '<': v < rule.value, '<=': v <= rule.value, '>': v > rule.value, '>=': v >= rule.value, '==': v === rule.value, '!=': v !== rule.value }[rule.op];
}

function createWatchers(file, { onAlert } = {}) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')).map(w => { try { return clean(w); } catch { return null; } }).filter(Boolean); } catch {}
  const stateFile = file.replace(/\.json$/, '') + '-state.json';
  const state = {};   // id -> { status, error, lastAt, values, history, firing, raw }
  const timers = {};
  let alerts = [];
  // History and alerts survive restarts: reload them, then save at most every 30 seconds.
  try { const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')); alerts = saved.alerts || []; for (const [id, h] of Object.entries(saved.history || {})) state[id] = { history: h }; } catch {}
  let dirty = false;
  const saveState = () => {
    if (!dirty) return;
    dirty = false;
    const tmp = stateFile + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify({ alerts, history: Object.fromEntries(Object.entries(state).map(([id, s]) => [id, s.history || []])) })); fs.renameSync(tmp, stateFile); } catch {}
  };
  const stateTimer = setInterval(saveState, 30000);
  stateTimer.unref?.();
  process.on('exit', () => { dirty = true; saveState(); });

  const save = () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(list, null, 2)); fs.renameSync(tmp, file); };

  // POST the alert to the user's webhook (smart plug, Discord, Home Assistant, ntfy...). 10-second limit, never retried.
  async function sendWebhook(w, a, s) {
    try {
      const r = await fetch(w.webhook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ watcher: w.name, message: a.message, at: a.at, values: s.values || null, text: `Freeze Foundry: ${a.message}`, content: `Freeze Foundry: ${a.message}` })
      });
      a.webhook = r.ok ? 'sent' : `failed (HTTP ${r.status})`;
    } catch (e) { a.webhook = `failed (${e.name === 'TimeoutError' ? 'timed out' : e.message})`; }
  }

  async function poll(w) {
    const s = state[w.id] || (state[w.id] = { history: [] });
    let data, ok = true;
    try { data = await readOnce(w); s.error = null; } catch (e) { ok = false; s.error = e.message; }
    const prevRule = s.ruleValue;
    s.status = ok ? 'ok' : 'error';
    s.lastAt = new Date().toISOString();
    if (ok) {
      s.raw = typeof data === 'string' ? data.slice(0, 4000) : JSON.stringify(data).slice(0, 4000);
      s.values = Object.fromEntries(w.fields.map(f => [f, getPath(data, f)]));
      const first = Number(s.values[w.fields[0]]);
      if (Number.isFinite(first)) { s.history.push(first); if (s.history.length > 120) s.history.shift(); }
    }
    const ruleValue = ok && w.rule ? getPath(data, w.rule.path) : undefined;
    const firing = check(w.rule, ruleValue, prevRule, ok);
    if (ok) s.ruleValue = ruleValue;
    // Alert on the edge only (when the rule becomes true), except "changed", which fires on every change.
    if (firing && (!s.firing || w.rule.op === 'changed')) {
      const a = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        at: s.lastAt, watcher: w.id, name: w.name,
        message: w.rule.op === 'offline' ? `${w.name} is not responding (${s.error})`
          : w.rule.op === 'changed' ? `${w.name}: ${w.rule.path} changed to ${JSON.stringify(ruleValue)}`
          : `${w.name}: ${w.rule.path} is ${ruleValue} (rule: ${w.rule.op} ${w.rule.value})`
      };
      alerts.unshift(a); alerts.length = Math.min(alerts.length, 100);
      if (w.webhook) sendWebhook(w, a, s);
      if (onAlert) onAlert(a, w, s);
    }
    s.firing = firing;
    dirty = true;
  }

  function schedule(w) {
    clearInterval(timers[w.id]);
    delete timers[w.id];
    if (!w.enabled) return;
    poll(w);
    timers[w.id] = setInterval(() => poll(w), w.intervalSec * 1000);
    timers[w.id].unref?.();
  }

  list.forEach(schedule);

  return {
    list: () => list.map(w => ({ ...w, state: state[w.id] || null })),
    alerts: () => alerts,
    upsert(raw) {
      const w = clean(raw);
      const i = list.findIndex(x => x.id === w.id);
      if (i >= 0) list[i] = w; else { if (list.length >= 50) throw new Error('Up to 50 watchers.'); list.push(w); }
      if (i < 0) delete state[w.id]; // editing keeps the chart history
      save(); schedule(w);
      return w;
    },
    remove(id) {
      list = list.filter(w => w.id !== id);
      clearInterval(timers[id]); delete timers[id]; delete state[id];
      dirty = true; save(); saveState();
    },
    async test(raw) {
      const w = clean(raw);
      const data = await readOnce(w);
      return { data, values: Object.fromEntries(w.fields.map(f => [f, getPath(data, f)])) };
    },
    stopAll() { Object.values(timers).forEach(clearInterval); clearInterval(stateTimer); dirty = true; saveState(); }
  };
}

module.exports = { createWatchers, getPath, check, clean };
