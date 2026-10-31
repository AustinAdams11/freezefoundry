// Studio shows: each one turns a spec (written by the crew) into a vertical 1080x1920 animation plus a soundtrack.
// Plain browser JS, shared by the renderer (render.html) and the Town page's preview.
(function () {
  const W = 1080, H = 1920;
  const C = { bg1: '#17181c', bg2: '#08090b', text: '#f6f2ea', dim: '#a9a39a', molten: '#ff8a1f', amber: '#ffbe6e', ice: '#8be0ff', violet: '#b061ff', rule: 'rgba(255,255,255,0.10)' };
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  // Critically damped settle (no overshoot) and a gentle overshoot for things that "land".
  const settle = t => { t = clamp(t); const w = 9, end = 1 - (1 + w) * Math.exp(-w); return (1 - (1 + w * t) * Math.exp(-w * t)) / end; };
  const land = t => { t = clamp(t); return t >= 1 ? 1 : 1 - Math.exp(-7 * t) * Math.cos(10 * t); };
  const fmt = (v, unit, final = v) => {
    const dp = Number.isInteger(final) || Math.abs(final) >= 100 ? 0 : 1;
    const n = v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return unit ? `${n} ${unit}` : n;
  };

  function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/), lines = [];
    let line = '';
    for (const w of words) {
      const next = line ? line + ' ' + w : w;
      if (ctx.measureText(next).width > maxW && line) { lines.push(line); line = w; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  function text(ctx, str, x, y, { size = 64, weight = 700, color = C.text, align = 'center', track = -0.02, alpha = 1, maxW = 900, lh = 1.08 } = {}) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${weight} ${size}px ${FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${track * size}px`;
    const lines = wrap(ctx, str, maxW);
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * size * lh));
    ctx.restore();
    return lines.length * size * lh;
  }

  function pill(ctx, label, x, y, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = `700 34px ${FONT}`;
    const w = ctx.measureText(label).width + 56;
    ctx.fillStyle = color;
    roundRect(ctx, x - w / 2, y - 40, w, 64, 32);
    ctx.fill();
    ctx.fillStyle = '#140b03';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + 4);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function background(ctx, t, heat) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bg1); g.addColorStop(1, C.bg2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // Forge glow that breathes with the reveals.
    const r = ctx.createRadialGradient(W / 2, H * 0.62, 40, W / 2, H * 0.62, 900);
    r.addColorStop(0, `rgba(255,122,26,${0.10 + 0.14 * heat})`); r.addColorStop(1, 'rgba(255,122,26,0)');
    ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
    // Slow drifting ice dust.
    ctx.fillStyle = 'rgba(139,224,255,0.35)';
    for (let i = 0; i < 40; i++) {
      const x = (i * 271.3 + t * (8 + (i % 5) * 3)) % W, y = (i * 517.7 - t * (14 + (i % 7) * 4)) % H;
      ctx.fillRect(x, (y + H) % H, 3, 3);
    }
  }

  // ---------- Ranked: a top-5 countdown, #5 to #1 ----------
  // Layout keeps everything that matters between y 200 and 1500 and left of x 900: the platforms put their
  // buttons down the right edge and the caption across the bottom.
  const ranked = {
    name: 'Ranked',
    describe: 'A top-5 countdown: a hook, five items from #5 to #1 with a number each, and a question to end on.',
    HOOK: 2.6, STEP: 5.4, OUTRO: 3.4,
    duration(spec) { return this.HOOK + spec.items.length * this.STEP + this.OUTRO; },
    // Times (in seconds) when something lands; the soundtrack hits on these.
    beats(spec) { return spec.items.map((_, i) => this.HOOK + i * this.STEP + 0.35); },
    draw(ctx, t, spec) {
      const n = spec.items.length, max = Math.max(...spec.items.map(i => i.value));
      const step = clamp(Math.floor((t - this.HOOK) / this.STEP), -1, n - 1);
      const outroT = t - (this.HOOK + n * this.STEP);
      const local = t - this.HOOK - step * this.STEP;
      background(ctx, t, step >= 0 ? Math.exp(-2.2 * Math.max(0, local - 0.35)) * (n - step === 1 ? 1.6 : 1) : 0.2);

      // Hook, then the title moves up and stays, so anyone scrolling in knows what this is.
      const head = settle((t - 0.05) / 0.6), morph = settle((t - this.HOOK) / 0.7);
      pill(ctx, 'RANKED', W / 2, 230 + (1 - head) * 30, C.molten, head);
      text(ctx, spec.title, W / 2, 820 - 480 * morph, { size: 112 - 50 * morph, weight: 800, track: -0.035, alpha: head, maxW: 900 - 40 * morph });
      if (t < this.HOOK + 0.6) text(ctx, `Counting down from ${n} to 1`, W / 2, 1230, { size: 46, weight: 600, color: C.dim, alpha: settle((t - 0.7) / 0.6) * (1 - morph) });

      // Spotlight: the item being revealed, big.
      if (step >= 0 && outroT < 0) {
        const item = spec.items[step], rank = n - step, top = rank === 1;
        const inn = settle(local / 0.55), pop = land((local - 0.15) / 0.7), out = settle((local - (this.STEP - 0.45)) / 0.45);
        const grow = settle((local - 0.3) / 1.6);
        ctx.save();
        ctx.globalAlpha = inn * (1 - out);
        ctx.translate(W / 2, 760); ctx.scale(0.92 + 0.08 * pop - 0.08 * out, 0.92 + 0.08 * pop - 0.08 * out); ctx.translate(-W / 2, -760);
        // Glass card.
        ctx.fillStyle = 'rgba(255,255,255,0.05)'; roundRect(ctx, 110, 470, 860, 620, 56); ctx.fill();
        ctx.strokeStyle = top ? 'rgba(255,138,31,0.55)' : 'rgba(255,255,255,0.10)'; ctx.lineWidth = 3; roundRect(ctx, 110, 470, 860, 620, 56); ctx.stroke();
        text(ctx, top ? 'NUMBER ONE' : `#${rank}`, W / 2, 560, { size: top ? 44 : 64, weight: 800, color: top ? C.molten : C.dim, track: top ? 0.08 : -0.02 });
        if (item.icon) text(ctx, item.icon, W / 2, 760, { size: 170, weight: 400 });
        text(ctx, item.label, W / 2, item.icon ? 880 : 760, { size: 76, weight: 800, track: -0.03, maxW: 780 });
        text(ctx, fmt(grow < 1 ? item.value * grow : item.value, spec.unit, item.value), W / 2, item.icon ? 1000 : 900, { size: 96, weight: 800, track: -0.03, color: top ? C.amber : C.ice });
        ctx.restore();
        if (item.fact) {
          const f = settle((local - 0.9) / 0.6);
          text(ctx, item.fact, W / 2, 1170 + (1 - f) * 24, { size: 46, weight: 600, alpha: f * (1 - out), maxW: 820, lh: 1.18 });
        }
      }

      // Leaderboard: fills from the bottom (#5) up to #1.
      const bx = 110, bw = 770, rowH = 62, by = 1262;
      for (let i = 0; i <= step && i < n; i++) {
        const item = spec.items[i], rank = n - i, y = by + (rank - 1) * rowH;
        const a = t - this.HOOK - i * this.STEP - (this.STEP - 0.6);
        const enter = i < step || outroT >= 0 ? 1 : settle(a / 0.5);
        if (enter <= 0) continue;
        ctx.save();
        ctx.globalAlpha = enter;
        ctx.fillStyle = rank === 1 ? C.molten : 'rgba(255,255,255,0.10)';
        roundRect(ctx, bx, y, 48, 48, 13); ctx.fill();
        text(ctx, `${rank}`, bx + 24, y + 36, { size: 32, weight: 800, color: rank === 1 ? '#140b03' : C.text });
        text(ctx, item.label, bx + 66, y + 34, { size: 36, weight: 700, align: 'left', maxW: 420 });
        text(ctx, fmt(item.value, spec.unit, item.value), bx + bw, y + 34, { size: 36, weight: 700, align: 'right', color: rank === 1 ? C.amber : C.ice });
        const w = (bw - 64 - 250) * (item.value / max) * enter;
        const g = ctx.createLinearGradient(bx + 64, 0, bx + 64 + w, 0);
        if (rank === 1) { g.addColorStop(0, C.amber); g.addColorStop(1, C.molten); } else { g.addColorStop(0, C.ice); g.addColorStop(1, C.violet); }
        ctx.fillStyle = g; roundRect(ctx, bx + 66, y + 44, Math.max(8, w), 8, 4); ctx.fill();
        ctx.restore();
      }

      // Outro: the question that gets comments.
      if (outroT >= 0) {
        const s = settle(outroT / 0.6);
        ctx.fillStyle = `rgba(8,9,11,${0.88 * s})`; ctx.fillRect(0, 0, W, H);
        text(ctx, spec.outro || 'Which one surprised you?', W / 2, 860, { size: 92, weight: 800, track: -0.035, alpha: s, maxW: 860 });
        text(ctx, 'A new ranking every day', W / 2, 1150, { size: 44, weight: 600, color: C.ice, alpha: settle((outroT - 0.5) / 0.6) });
      }
    }
  };

  // ---------- Soundtrack: original chiptune, made fresh for every episode ----------
  // Returns a function that schedules everything on an AudioContext and connects it to `out`.
  function chiptune(seed, duration, beats) {
    let s = 0;
    for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const progressions = [[0, 8, 3, 10], [0, 5, 8, 7], [0, 3, 5, 7], [0, 8, 5, 7]];
    const prog = progressions[Math.floor(rand() * progressions.length)];
    const root = 45 + Math.floor(rand() * 5); // A2..C#3
    const bpm = 104 + Math.floor(rand() * 20);
    const hz = m => 440 * Math.pow(2, (m - 69) / 12);
    return (ctx, out) => {
      const t0 = ctx.currentTime + 0.05, beat = 60 / bpm;
      const master = ctx.createGain(); master.gain.value = 0.22; master.connect(out);
      const note = (type, freq, at, len, vol) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
        o.connect(g).connect(master); o.start(at); o.stop(at + len + 0.02);
      };
      const noise = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
      noise.getChannelData(0).forEach((_, i, d) => { d[i] = Math.random() * 2 - 1; });
      const hat = (at, vol) => { const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; src.buffer = noise; g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05); src.connect(f).connect(g).connect(master); src.start(at); };
      const minor = [0, 3, 7, 12];
      for (let b = 0, at = t0; at < t0 + duration - 0.6; b++, at += beat) {
        const chord = prog[Math.floor(b / 8) % prog.length];
        const fade = Math.min(1, (t0 + duration - at) / 2);
        note('triangle', hz(root + chord - 12 + 12), at, beat * 0.9, 0.5 * fade);
        for (let k = 0; k < 4; k++) note('square', hz(root + 24 + chord + minor[(b + k) % 4]), at + k * beat / 4, beat / 4.4, 0.07 * fade);
        hat(at + beat / 2, 0.12 * fade);
        if (b % 2 === 0) note('sine', 60, at, 0.18, 0.9 * fade); // kick
      }
      // A rising chime on every reveal; the last (number one) is bigger.
      beats.forEach((bt, i) => {
        const at = t0 + bt, last = i === beats.length - 1;
        [0, 7, 12, last ? 19 : 16].forEach((iv, k) => note('square', hz(root + 36 + iv), at + k * 0.06, last ? 0.5 : 0.25, last ? 0.16 : 0.1));
      });
    };
  }

  // One emoji (a single grapheme with no letters or digits), or nothing.
  function firstEmoji(v) {
    const str = String(v || '').trim();
    const g = typeof Intl !== 'undefined' && Intl.Segmenter ? (new Intl.Segmenter().segment(str)[Symbol.iterator]().next().value || {}).segment : [...str][0];
    return g && !/[\p{L}\p{N}]/u.test(g) ? g : '';
  }

  // Validate and tidy a spec from the Writer, so a bad one fails before rendering.
  function cleanRanked(spec) {
    if (!spec || typeof spec !== 'object') throw new Error('No spec');
    const items = (Array.isArray(spec.items) ? spec.items : []).map(i => ({
      label: String((i && i.label) || '').trim().slice(0, 28),
      value: Number(i && i.value),
      fact: String((i && i.fact) || '').trim().slice(0, 90),
      icon: firstEmoji(i && i.icon)
    })).filter(i => i.label && Number.isFinite(i.value) && i.value > 0);
    if (items.length < 3 || items.length > 7) throw new Error('A ranking needs 3 to 7 items, each with a label and a positive number.');
    items.sort((a, b) => a.value - b.value); // countdown: smallest first, biggest is number one
    return { title: String(spec.title || '').trim().slice(0, 70) || 'Ranked', unit: String(spec.unit || '').trim().slice(0, 16), outro: String(spec.outro || '').trim().slice(0, 60), items };
  }

  const api = { W, H, shows: { ranked }, chiptune, clean: { ranked: cleanRanked } };
  if (typeof module !== 'undefined') module.exports = api; else window.FFStudio = api;
})();
