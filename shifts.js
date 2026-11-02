// Shifts: the Factory starts a work order on a schedule while the app is open. A shift missed while the app was closed runs
// once when it opens, the same day. A busy crew is tried again on the next tick.
const fs = require('fs');

const CREWS = ['factory'];

function createShifts(file, { writeJsonAtomic, start, every = 30e3 }) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const save = () => writeJsonAtomic(file, list);

  // Today's start time, if today is one of the shift's days and that time has passed.
  const dueAt = (s, now) => {
    if (!s.days.includes(now.getDay())) return null;
    const [h, m] = s.time.split(':').map(Number), t = new Date(now);
    t.setHours(h, m, 0, 0);
    return t <= now ? t : null;
  };

  async function fire(s, now = new Date()) {
    try { await start(s); s.lastRun = now.toISOString(); s.lastError = null; }
    catch (e) { s.lastError = e.message; }
    save();
  }

  let ticking = false;
  async function tick(now = new Date()) {
    if (ticking) return;
    ticking = true;
    try {
      for (const s of list) {
        const t = s.enabled && dueAt(s, now);
        if (t && Date.parse(s.lastRun || s.createdAt) < t.getTime()) await fire(s, now);
      }
    } finally { ticking = false; }
  }
  const timer = setInterval(() => tick().catch(() => {}), every);
  timer.unref?.();

  function upsert(b) {
    const crew = CREWS.includes(b.crew) ? b.crew : null;
    if (!crew) throw new Error('Unknown crew.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.time))) throw new Error('Pick a start time.');
    const days = [...new Set((Array.isArray(b.days) ? b.days : []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (!days.length) throw new Error('Pick at least one day.');
    const goal = String(b.goal || '').trim().slice(0, 4000);
    if (!goal) throw new Error('Write the work order the Factory should run.');
    const old = list.find(s => s.id === b.id);
    const s = {
      id: old ? old.id : 'sh_' + Date.now().toString(36),
      crew, time: b.time, days, enabled: b.enabled !== false,
      goal,
      // A new shift counts from when it was made, so one made at 3 pm for 1 am doesn't fire straight away.
      createdAt: old ? old.createdAt : new Date().toISOString(), lastRun: old ? old.lastRun : null, lastError: old ? old.lastError : null
    };
    if (old) Object.assign(old, s); else list.push(s);
    save();
    return s;
  }
  function remove(id) { list = list.filter(s => s.id !== id); save(); }

  return { list: () => list, upsert, remove, tick, runNow: id => { const s = list.find(x => x.id === id); if (!s) throw new Error('No such shift'); return fire(s).then(() => s); }, stop: () => clearInterval(timer) };
}

module.exports = { createShifts };
