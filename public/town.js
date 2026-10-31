// The Town: Frostpeak, a snowy mining valley (the owner's illustration, public/img/frostpeak.jpg), brought to life.
// Snow falls, the stacks smoke and flare, the furnace and windows flicker, lanterns glow at every mine, and carts run
// the drawn rails to the foundry. All coordinates are in the illustration's own pixels (2576x1438).
function FrostpeakScene(canvas) {
  const IW = 2576, IH = 1438, K = 0.5; // canvas is half the illustration's size; still finer than it is shown
  canvas.width = IW * K; canvas.height = IH * K;
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.src = 'img/frostpeak.jpg';
  const mines = [
    { x: 275, y: 910, lantern: [341, 845] }, { x: 583, y: 590, lantern: [657, 515] }, { x: 1035, y: 520, lantern: [1113, 455] },
    { x: 1636, y: 648, lantern: [1560, 568] }, { x: 2236, y: 645, lantern: [2173, 570] }, { x: 2313, y: 990, lantern: [2241, 915] }
  ];
  const stacks = [
    { x: 1235, y: 860, size: 22, color: [238, 244, 250] }, { x: 1040, y: 1005, size: 16, color: [228, 236, 246] },
    { x: 1606, y: 1040, size: 16, color: [228, 236, 246] }, { x: 1301, y: 925, size: 14, color: [70, 66, 70], flame: true },
    { x: 1351, y: 910, size: 14, color: [70, 66, 70], flame: true }
  ];
  const glows = [ // furnace, door, windows
    { x: 1366, y: 1268, r: 70, a: 0.55 }, { x: 1102, y: 1280, r: 46, a: 0.4 },
    { x: 1215, y: 1095, r: 26, a: 0.3 }, { x: 1556, y: 1167, r: 22, a: 0.3 }, { x: 1596, y: 1167, r: 22, a: 0.3 }
  ];
  // The big rail loop: top-left junction, down to the foundry yard, along the bottom, and up the east side.
  const rail = [[960, 765], [880, 810], [780, 870], [700, 925], [660, 950], [560, 1035], [455, 1105], [690, 1326], [1890, 1326],
    [1960, 1270], [2040, 1200], [2100, 1130], [2040, 1070], [1980, 1010], [1922, 950], [1900, 895], [1860, 858], [1780, 825], [1680, 785], [1580, 748], [1522, 722]];
  const cum = [0];
  for (let i = 1; i < rail.length; i++) cum.push(cum[i - 1] + Math.hypot(rail[i][0] - rail[i - 1][0], rail[i][1] - rail[i - 1][1]));
  const total = cum[cum.length - 1];
  const at = s => {
    s = Math.max(0, Math.min(total, s));
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [rail[i - 1][0] + (rail[i][0] - rail[i - 1][0]) * f, rail[i - 1][1] + (rail[i][1] - rail[i - 1][1]) * f];
  };
  const foundryStop = cum[7] + (1300 - 690); // the yard in front of the furnace

  let snowMode = 2, oreSmelted = 1420, frame = 0, running = false;
  const busy = {}, view = { highlight: null };
  const carts = [];
  const oreColors = ['#ff9d2e', '#ff6b1a', '#ffd147', '#38bdf8'];
  function createCart(i, start) {
    carts.push({ s: (start ?? Math.random()) * total, dir: i % 2 ? 1 : -1, speed: 2.2 + Math.random() * 0.8, loaded: true, ore: oreColors[i % oreColors.length], pause: 0 });
  }
  for (let i = 0; i < 4; i++) createCart(i, i * 0.27 + 0.05);
  const smoke = [], sparks = [];
  const flakes = Array.from({ length: 260 }, () => ({ x: Math.random() * IW, y: Math.random() * IH, vy: 1.2 + Math.random() * 2.2, vx: (Math.random() - 0.5) * 0.6, r: Math.random() > 0.7 ? 4 : 3, near: Math.random() > 0.35 }));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  function glow(x, y, r, color, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${color},${a})`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // A cart drawn in the illustration's pixel style: iron tub, rim, wheels, glowing load.
  function drawCart(c) {
    const [x, y] = at(c.s), X = Math.round(x / 4) * 4, Y = Math.round(y / 4) * 4;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(X - 30, Y - 4, 60, 8);
    if (c.loaded) { ctx.fillStyle = c.ore; ctx.fillRect(X - 22, Y - 38, 44, 12); ctx.fillStyle = '#fff3b0'; ctx.fillRect(X - 12, Y - 42, 20, 6); }
    ctx.fillStyle = '#394352'; ctx.fillRect(X - 28, Y - 28, 56, 22);
    ctx.fillStyle = '#58667a'; ctx.fillRect(X - 28, Y - 28, 56, 5);
    ctx.fillStyle = '#2a313c'; ctx.fillRect(X - 24, Y - 20, 48, 3);
    ctx.fillStyle = '#14181f'; ctx.fillRect(X - 22, Y - 8, 12, 8); ctx.fillRect(X + 10, Y - 8, 12, 8);
  }

  function draw() {
    frame++;
    ctx.setTransform(K, 0, 0, K, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, IW, IH); else { ctx.fillStyle = '#5b718c'; ctx.fillRect(0, 0, IW, IH); }
    const recording = !!busy.studio;

    // Warm light: furnace, door and windows flicker; the furnace roars while a video records.
    ctx.globalCompositeOperation = 'lighter';
    glows.forEach((g, i) => {
      const flick = 0.75 + 0.25 * Math.sin(frame * (0.21 + i * 0.03) + i) + (Math.random() - 0.5) * 0.12;
      glow(g.x, g.y, g.r * (recording && i < 2 ? 1.6 : 1), '255,140,40', g.a * flick * (recording && i < 2 ? 1.5 : 1));
    });
    // Mine lanterns: always flicker; a crew member at work makes theirs blaze.
    mines.forEach((m, i) => {
      const on = !!busy[m.id];
      const flick = 0.7 + 0.3 * Math.sin(frame * 0.18 + i * 1.7) + (Math.random() - 0.5) * 0.15;
      glow(m.lantern[0], m.lantern[1], on ? 70 : 36, '255,190,80', (on ? 0.55 : 0.32) * flick);
      if (on) glow(m.x, m.y - 50, 80, '255,170,70', 0.18 * flick);
    });
    // The worker hovered in the key gets a pulsing ring of light at its mine (or over the foundry).
    if (view.highlight) {
      const m = mines.find(x => x.id === view.highlight), pulse = 0.5 + 0.5 * Math.sin(frame * 0.2);
      const [hx, hy, hr] = m ? [m.x, m.y - 60, 150] : view.highlight === 'studio' ? [1290, 1120, 360] : [0, 0, 0];
      if (hr) glow(hx, hy, hr, '255,225,150', 0.25 + 0.2 * pulse);
    }
    ctx.globalCompositeOperation = 'source-over';

    // Stack smoke and flames.
    stacks.forEach((st, i) => {
      const rate = recording ? 0.5 : 0.25;
      if (Math.random() < rate) smoke.push({ x: st.x + (Math.random() - 0.5) * 10, y: st.y, r: st.size * (0.6 + Math.random() * 0.5), vy: 1.4 + Math.random() * 0.8, vx: 0.5 + Math.random() * 0.6, life: 1, c: st.color });
      if (st.flame) {
        const h = 10 + Math.random() * (recording ? 22 : 12);
        ctx.fillStyle = '#ff771c'; ctx.fillRect(st.x - 8, st.y - h, 16, h);
        ctx.fillStyle = '#ffd644'; ctx.fillRect(st.x - 4, st.y - h * 0.6, 8, h * 0.6);
      }
    });
    smoke.forEach(p => {
      p.y -= p.vy; p.x += p.vx + Math.sin(frame * 0.03 + p.y * 0.01) * 0.4; p.r += 0.22; p.life -= 0.0045;
      const s = Math.round(p.r / 4) * 4;
      ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${Math.max(0, p.life) * 0.55})`;
      ctx.fillRect(Math.round(p.x / 4) * 4 - s / 2, Math.round(p.y / 4) * 4 - s / 2, s, s);
    });
    for (let i = smoke.length - 1; i >= 0; i--) if (smoke[i].life <= 0 || smoke[i].y < 80) smoke.splice(i, 1);
    if (smoke.length > 600) smoke.splice(0, smoke.length - 600);

    // Sparks from the furnace mouth.
    if (Math.random() < (recording ? 0.6 : 0.15)) sparks.push({ x: 1366 + (Math.random() - 0.5) * 30, y: 1255, vx: (Math.random() - 0.5) * 3, vy: -2 - Math.random() * 3, life: 1 });
    sparks.forEach(s => { s.x += s.vx; s.y += s.vy; s.vy += 0.08; s.life -= 0.025; ctx.fillStyle = `rgba(255,${180 + Math.random() * 60},80,${Math.max(0, s.life)})`; ctx.fillRect(Math.round(s.x / 4) * 4, Math.round(s.y / 4) * 4, 4, 4); });
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);

    // Carts run the loop, stop at the foundry to unload, and turn around at each end.
    carts.forEach(c => {
      if (c.pause > 0) { c.pause--; drawCart(c); return; }
      const before = c.s;
      c.s += c.speed * c.dir;
      if ((before - foundryStop) * (c.s - foundryStop) <= 0 && c.loaded) {
        c.s = foundryStop; c.pause = 50; c.loaded = false; oreSmelted += 5;
        const el = document.getElementById('statsReadout');
        if (el) el.textContent = 'Ore Smelted: ' + oreSmelted.toLocaleString() + ' Tons';
      }
      if (c.s <= 0 || c.s >= total) { c.s = Math.max(0, Math.min(total, c.s)); c.dir *= -1; c.pause = 40; c.loaded = true; }
      drawCart(c);
    });

    // Snow.
    if (snowMode > 0 && !reduce.matches) {
      const n = snowMode === 2 ? flakes.length : Math.floor(flakes.length * 0.45);
      for (let i = 0; i < n; i++) {
        const f = flakes[i];
        f.y += f.vy; f.x += f.vx + Math.sin(frame * 0.02 + i) * 0.4;
        if (f.y > IH) { f.y = -4; f.x = Math.random() * IW; }
        if (f.x < 0) f.x = IW; if (f.x > IW) f.x = 0;
        ctx.fillStyle = f.near ? '#ffffff' : '#cfe0f0';
        ctx.fillRect(Math.round(f.x / 4) * 4, Math.round(f.y / 4) * 4, f.r, f.r);
      }
    }
    if (running) setTimeout(() => requestAnimationFrame(draw), 33);
  }

  return {
    GW: IW, GH: IH, mines, busy, view,
    start() { if (!running) { running = true; draw(); } },
    stop() { running = false; },
    cycleSnow() { snowMode = (snowMode + 1) % 3; return ['Snow: Off', 'Snow: Light', 'Snow: Heavy'][snowMode]; },
    dispatchCart() { if (carts.length < 18) createCart(carts.length, 0); },
    png() { return canvas.toDataURL('image/png'); }
  };
}

// Crew overlay: who works in which mine (labels and bubbles in HTML over the picture); the foundry is the Studio.
class TownMap {
  constructor(canvas, overlay, onPick) {
    this.scene = FrostpeakScene(canvas);
    this.overlay = overlay; this.onPick = onPick;
    this.W = this.scene.GW; this.H = this.scene.GH;
    const ids = ['scout', 'writer', 'checker', 'publisher', 'analyst', 'bank'];
    this.scene.mines.forEach((m, i) => { m.id = ids[i]; });
    this.houses = Object.fromEntries(this.scene.mines.map(m => [m.id, { id: m.id, x: m.x, y: m.y }]));
    this.houses.studio = { id: 'studio', x: 1290, y: 1330, foundry: true };
    canvas.addEventListener('click', e => {
      const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) * this.W / r.width, y = (e.clientY - r.top) * this.H / r.height;
      const hit = Object.values(this.houses).find(h => h.foundry ? x > 900 && x < 1720 && y > 820 && y < 1330 : Math.abs(h.x - x) < 80 && y > h.y - 150 && y < h.y + 20);
      if (hit && this.onPick) this.onPick(hit.id);
    });
  }
  set busy(map) { Object.keys(this.scene.busy).forEach(k => delete this.scene.busy[k]); Object.assign(this.scene.busy, map); }
  get busy() { return this.scene.busy; }
  set highlight(id) { this.scene.view.highlight = id; }
  tagSpot(id) { const h = this.houses[id]; return { x: h.x, y: h.foundry ? 1290 : h.y + 18 }; }
  send(from, to, text) { this.say(to, text); }
  say(id, text) {
    const h = this.houses[id];
    if (!h || !text) return;
    const el = document.createElement('div');
    el.className = 'town-bubble';
    el.textContent = text;
    el.style.left = (h.x / this.W * 100) + '%';
    el.style.top = ((h.foundry ? 820 : h.y - 150) / this.H * 100) + '%';
    this.overlay.appendChild(el);
    setTimeout(() => el.classList.add('out'), 3800);
    setTimeout(() => el.remove(), 4300);
  }
  start() { this.scene.start(); }
  stop() { this.scene.stop(); }
}
