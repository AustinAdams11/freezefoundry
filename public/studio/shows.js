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

  function text(ctx, str, x, y, { size = 64, weight = 700, color = C.text, align = 'center', track = -0.02, alpha = 1, maxW = 900, lh = 1.08, stroke = false } = {}) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${weight} ${size}px ${FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${track * size}px`;
    const lines = wrap(ctx, str, maxW);
    // A dark outline keeps text readable over a busy picture.
    if (stroke) { ctx.lineWidth = size * 0.14; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; lines.forEach((l, i) => ctx.strokeText(l, x, y + i * size * lh)); }
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

  // ---------- Timing ----------
  // Every show is a row of segments (a hook, the body, an outro). Each segment lasts at least its design length,
  // longer when its narration needs it. `secs` holds the narration length of each segment, in seconds.
  const words = str => String(str || '').split(/\s+/).filter(Boolean).length;
  const guess = str => words(str) / 2.6; // seconds to read a line aloud at a natural pace
  function timeline(mins, secs, pads, leads) {
    let at = 0;
    const segs = mins.map((min, i) => {
      const s = secs[i] || 0, len = Math.max(min, s ? leads[i] + s + pads[i] : min);
      const seg = { start: at, len, say: at + leads[i], speech: s };
      at += len;
      return seg;
    });
    return { segs, duration: at };
  }
  const segAt = (tl, t) => { let i = 0; while (i < tl.segs.length - 1 && t >= tl.segs[i + 1].start) i++; return i; };

  // Shorts-style captions: two or three words at a time, the word being spoken lit up. Each sentence is pinned to
  // where the voice really says it (seg.marks); inside a sentence, words share the time by syllables, and a comma
  // gets a pause. Without marks (no voice), the line is spread over its reading time.
  const syllables = w => Math.max(1, (w.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/e$/, '').match(/[aeiouy]+|\d/g) || []).length);
  function wordTimes(line, seg) {
    const marks = seg.marks && seg.marks.length ? seg.marks : [{ text: line, start: 0, end: seg.speech || guess(line) }];
    const out = [];
    for (const m of marks) {
      const ws = m.text.split(/\s+/).filter(Boolean), weight = ws.map(w => syllables(w) + (/[,;:]$/.test(w) ? 1.2 : 0));
      const total = weight.reduce((a, b) => a + b, 0) || 1;
      let acc = 0;
      ws.forEach((w, i) => { out.push({ w, at: seg.say + m.start + (m.end - m.start) * acc / total }); acc += weight[i]; });
    }
    return out;
  }
  function captions(ctx, line, seg, t, y, accent) {
    const times = wordTimes(line, seg), ws = times.map(x => x.w);
    if (!ws.length) return;
    let cur = 0;
    times.forEach((x, i) => { if (t >= x.at) cur = i; });
    // Chunks of up to 3 words or 16 letters; show the chunk holding the current word.
    const chunks = [];
    for (let i = 0, c = []; i < ws.length; i++) {
      c.push(i);
      const len = c.reduce((n, k) => n + ws[k].length + 1, 0);
      if (c.length === 3 || len > 16 || /[.!?,;:]$/.test(ws[i]) || i === ws.length - 1) { chunks.push(c); c = []; }
    }
    const chunk = chunks.find(c => c.includes(cur)) || chunks[0];
    const chunkAt = times[chunk[0]].at;
    const appear = settle((t - Math.max(seg.start, chunkAt - 0.05)) / 0.22);
    ctx.save();
    ctx.font = `900 92px ${FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '-2px';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const gap = 26, parts = chunk.map(k => ({ k, w: ctx.measureText(ws[k].toUpperCase()).width }));
    // Wrap the chunk onto two lines if it is too wide.
    const rows = [[]];
    parts.forEach(p => { const row = rows[rows.length - 1], rw = row.reduce((n, q) => n + q.w + gap, 0); if (row.length && rw + p.w > 900) rows.push([p]); else row.push(p); });
    rows.forEach((row, r) => {
      let x = W / 2 - (row.reduce((n, q) => n + q.w, 0) + gap * (row.length - 1)) / 2;
      const yy = y + r * 104 + (1 - appear) * 18;
      row.forEach(p => {
        const lit = p.k === cur && t >= times[0].at;
        ctx.globalAlpha = appear;
        ctx.lineWidth = 16; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(ws[p.k].toUpperCase(), x, yy);
        ctx.fillStyle = lit ? accent : '#ffffff';
        ctx.fillText(ws[p.k].toUpperCase(), x, yy);
        x += p.w + gap;
      });
    });
    ctx.restore();
  }

  // ---------- Ranked: a top-5 countdown, #5 to #1 ----------
  // Layout keeps everything that matters between y 200 and 1500 and left of x 900: the platforms put their
  // buttons down the right edge and the caption across the bottom.
  const ranked = {
    name: 'Ranked',
    describe: 'A top-5 countdown: a hook, five items from #5 to #1 with a number each, and a question to end on.',
    music: 'chiptune',
    lines(spec) { const n = spec.items.length; return [spec.hook || spec.title, ...spec.items.map((it, i) => it.say || `Number ${n - i}: ${it.label}.`), spec.outro]; },
    timeline(spec, secs) {
      const n = spec.items.length;
      return timeline([2.6, ...Array(n).fill(5.4), 3.4], secs, [0.5, ...Array(n).fill(1.1), 1.2], [0.15, ...Array(n).fill(0.45), 0.5]);
    },
    // Times (in seconds) when something lands; the soundtrack hits on these.
    beats(spec, tl) { return spec.items.map((_, i) => tl.segs[i + 1].start + 0.35); },
    draw(ctx, t, spec, tl) {
      const n = spec.items.length, max = Math.max(...spec.items.map(i => i.value));
      const hookLen = tl.segs[0].len, outro = tl.segs[n + 1];
      const step = clamp(segAt(tl, t) - 1, -1, n - 1);
      const outroT = t - outro.start;
      const seg = step >= 0 ? tl.segs[step + 1] : tl.segs[0];
      const local = t - seg.start, STEP = seg.len;
      background(ctx, t, step >= 0 && outroT < 0 ? Math.exp(-2.2 * Math.max(0, local - 0.35)) * (n - step === 1 ? 1.6 : 1) : 0.2);

      // Hook, then the title moves up and stays, so anyone scrolling in knows what this is.
      const head = settle((t - 0.05) / 0.6), morph = settle((t - hookLen) / 0.7);
      pill(ctx, 'RANKED', W / 2, 230 + (1 - head) * 30, C.molten, head);
      text(ctx, spec.title, W / 2, 820 - 480 * morph, { size: 112 - 50 * morph, weight: 800, track: -0.035, alpha: head, maxW: 900 - 40 * morph });
      if (t < hookLen + 0.6) text(ctx, `Counting down from ${n} to 1`, W / 2, 1230, { size: 46, weight: 600, color: C.dim, alpha: settle((t - 0.7) / 0.6) * (1 - morph) });

      // Spotlight: the item being revealed, big.
      if (step >= 0 && outroT < 0) {
        const item = spec.items[step], rank = n - step, top = rank === 1;
        const inn = settle(local / 0.55), pop = land((local - 0.15) / 0.7), out = settle((local - (STEP - 0.45)) / 0.45);
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
        const item = spec.items[i], rank = n - i, y = by + (rank - 1) * rowH, s = tl.segs[i + 1];
        const a = t - (s.start + s.len - 0.6);
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
        text(ctx, 'Follow for the next ranking', W / 2, 1150, { size: 44, weight: 600, color: C.ice, alpha: settle((outroT - 0.5) / 0.6) });
      }
    },
    // Thumbnail: the subject of number one, big, with the hook. Text stays in the middle band, which every crop keeps.
    thumb(ctx, spec) {
      background(ctx, 3, 1.4);
      const top = spec.items[spec.items.length - 1];
      pill(ctx, 'RANKED', W / 2, 520, C.molten);
      if (top.icon) text(ctx, top.icon, W / 2, 860, { size: 260, weight: 400 });
      thumbWords(ctx, spec.thumb || spec.title, 1040, C.amber);
    }
  };

  // Big two-tone thumbnail words: the last word in the accent color.
  function thumbWords(ctx, str, y, accent) {
    const ws = String(str).toUpperCase().split(/\s+/).filter(Boolean);
    ctx.save();
    let size = 150;
    ctx.font = `900 ${size}px ${FONT}`;
    // Shrink until the longest line fits.
    const lines = () => wrap(ctx, ws.join(' '), 960);
    while (size > 80 && (lines().length > 3 || lines().some(l => ctx.measureText(l).width > 960))) { size -= 8; ctx.font = `900 ${size}px ${FONT}`; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${-0.03 * size}px`;
    const ls = lines();
    ls.forEach((l, i) => {
      const yy = y + i * size * 1.02;
      ctx.lineWidth = size * 0.16; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.strokeText(l, W / 2, yy);
      ctx.fillStyle = i === ls.length - 1 ? accent : '#ffffff';
      ctx.fillText(l, W / 2, yy);
    });
    ctx.restore();
  }

  // ---------- Story shows: narrated scenes with live captions ----------
  // Frostpeak Tour walks the camera around the Frostpeak illustration; Spooky Story and Mysteries & Legends draw
  // their own night skies. All three share the timing and captions.
  const assets = {}; // the renderer puts loaded images here (frostpeak)
  const FOCUS = { // points in the Frostpeak illustration (2576x1438) and how close to get
    town: { x: 1288, y: 760, z: 1.0 }, studio: { x: 1290, y: 1080, z: 1.55 },
    scout: { x: 275, y: 840, z: 1.9 }, writer: { x: 583, y: 520, z: 1.9 }, checker: { x: 1035, y: 450, z: 1.9 },
    publisher: { x: 1636, y: 580, z: 1.9 }, analyst: { x: 2236, y: 580, z: 1.9 }, bank: { x: 2313, y: 920, z: 1.9 }
  };
  const STYLES = {
    frostpeak: { name: 'Frostpeak Tour', label: 'FROSTPEAK MINING CO.', accent: '#ffbe6e', pill: '#ff8a1f', end: 'Follow to meet the next worker',
      describe: 'A narrated tour of Frostpeak Mining Co., the town where AI workers make these videos: who each worker is and the real science behind what it does.' },
    spooky: { name: 'Spooky Story', label: 'SPOOKY STORY', accent: '#ff5a5a', pill: '#c81e3a', end: 'Sleep tight',
      describe: 'A short, original spooky story told by a narrator, building to a twist at the end.' },
    mystery: { name: 'Mysteries & Legends', label: 'UNSOLVED', accent: '#5eead4', pill: '#14b8a6', end: 'Follow for the next mystery',
      describe: 'A real unsolved mystery, legend or strange historical event, told as a story: what is documented, what people claim, and why it is still debated.' }
  };

  function frostCamera(ctx, t, spec, tl) {
    const img = assets.frostpeak;
    if (!img || !img.width) { background(ctx, t, 0.3); return; }
    const i = segAt(tl, t), seg = tl.segs[i];
    const focusOf = k => FOCUS[(k > 0 && k <= spec.scenes.length && spec.scenes[k - 1].focus) || 'town'];
    const prev = focusOf(Math.max(0, i - 1)), cur = focusOf(i);
    const m = settle((t - seg.start) / 1.1), drift = 1 + 0.06 * clamp((t - seg.start) / seg.len);
    const fx = prev.x + (cur.x - prev.x) * m, fy = prev.y + (cur.y - prev.y) * m, z = (prev.z + (cur.z - prev.z) * m) * drift;
    const ch = img.height / z, cw = ch * W / H;
    const sx = clamp(fx - cw / 2, 0, img.width - cw), sy = clamp(fy - ch / 2, 0, img.height - ch);
    ctx.imageSmoothingEnabled = false; // pixel art stays crisp
    ctx.drawImage(img, sx, sy, cw, ch, 0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    // Falling snow over the picture.
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let k = 0; k < 70; k++) {
      const x = (k * 337.7 + Math.sin(t * 0.7 + k) * 30 + t * 12) % W, y = (k * 211.3 + t * (60 + (k % 6) * 14)) % H;
      ctx.fillRect(x, y, 5, 5);
    }
  }

  function nightSky(ctx, t, style) {
    const spooky = style === 'spooky';
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, spooky ? '#140a1c' : '#04121c'); g.addColorStop(1, '#020203');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (spooky) {
      // The moon, its glow, and a lightning flicker now and then.
      const flash = Math.max(0, Math.sin(t * 0.9) * Math.sin(t * 7.3) - 0.93) * 12;
      const mg = ctx.createRadialGradient(800, 330, 20, 800, 330, 420);
      mg.addColorStop(0, `rgba(255,236,214,${0.35 + flash * 0.3})`); mg.addColorStop(1, 'rgba(255,236,214,0)');
      ctx.fillStyle = mg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#f3e7d3'; ctx.beginPath(); ctx.arc(800, 330, 120, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#140a1c'; ctx.beginPath(); ctx.arc(750, 300, 112, 0, Math.PI * 2); ctx.fill();
      if (flash > 0) { ctx.fillStyle = `rgba(220,220,255,${Math.min(0.35, flash * 0.2)})`; ctx.fillRect(0, 0, W, H); }
      // Drifting fog.
      for (let k = 0; k < 7; k++) {
        const x = ((k * 400 + t * (18 + k * 6)) % (W + 1200)) - 600, y = 1100 + k * 110;
        const fg = ctx.createRadialGradient(x, y, 30, x, y, 520);
        fg.addColorStop(0, 'rgba(180,170,200,0.10)'); fg.addColorStop(1, 'rgba(180,170,200,0)');
        ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
      }
    } else {
      // Stars and a slow radar sweep: someone, somewhere, is still looking.
      ctx.fillStyle = 'rgba(200,240,255,0.7)';
      for (let k = 0; k < 120; k++) { const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.8 + k)); ctx.globalAlpha = tw; ctx.fillRect((k * 397.3) % W, (k * 733.1) % (H * 0.7), 3, 3); }
      ctx.globalAlpha = 1;
      const cx = W / 2, cy = 760, a = t * 0.9;
      ctx.strokeStyle = 'rgba(94,234,212,0.18)'; ctx.lineWidth = 3;
      [180, 330, 480].forEach(r => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); });
      const sw = ctx.createConicGradient ? ctx.createConicGradient(a, cx, cy) : null;
      if (sw) { sw.addColorStop(0, 'rgba(94,234,212,0.28)'); sw.addColorStop(0.12, 'rgba(94,234,212,0)'); sw.addColorStop(1, 'rgba(94,234,212,0)'); ctx.fillStyle = sw; ctx.beginPath(); ctx.arc(cx, cy, 480, 0, Math.PI * 2); ctx.fill(); }
    }
    // Vignette.
    const v = ctx.createRadialGradient(W / 2, H / 2, 300, W / 2, H / 2, 1200);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }

  function story(style) {
    const S = STYLES[style];
    return {
      name: S.name, describe: S.describe, music: style,
      lines(spec) { return [spec.hook || spec.title, ...spec.scenes.map(s => s.say), spec.outro]; },
      timeline(spec, secs) {
        const n = spec.scenes.length;
        return timeline([3.0, ...Array(n).fill(3.5), 3.6], secs, [0.7, ...Array(n).fill(0.45), 1.4], [0.35, ...Array(n).fill(0.2), 0.45]);
      },
      beats(spec, tl) { return tl.segs.slice(1, -1).map(s => s.start + 0.1); },
      draw(ctx, t, spec, tl) {
        const i = segAt(tl, t), seg = tl.segs[i], n = spec.scenes.length, local = t - seg.start;
        if (style === 'frostpeak') frostCamera(ctx, t, spec, tl); else nightSky(ctx, t, style);
        // A dark band behind the captions keeps them readable over any picture.
        const band = ctx.createLinearGradient(0, 1050, 0, H);
        band.addColorStop(0, 'rgba(0,0,0,0)'); band.addColorStop(0.25, 'rgba(0,0,0,0.55)'); band.addColorStop(1, 'rgba(0,0,0,0.6)');
        ctx.fillStyle = band; ctx.fillRect(0, 1050, W, H - 1050);
        const head = settle((t - 0.05) / 0.6);
        pill(ctx, S.label, W / 2, 230 + (1 - head) * 30, S.pill, head);
        if (i === 0) {
          // Hook: the title, big, then the spoken hook as captions.
          text(ctx, spec.title, W / 2, 700, { size: 104, weight: 900, track: -0.035, alpha: head, maxW: 900, stroke: true });
          captions(ctx, spec.hook || '', seg, t, 1300, S.accent);
        } else if (i <= n) {
          const sc = spec.scenes[i - 1], inn = settle(local / 0.5), out = settle((local - (seg.len - 0.35)) / 0.35);
          text(ctx, spec.title, W / 2, 330, { size: 46, weight: 800, maxW: 860, stroke: true });
          if (sc.icon) {
            const bob = Math.sin(t * 2.1) * 10, big = style !== 'frostpeak';
            ctx.save(); ctx.globalAlpha = inn * (1 - out);
            if (!big) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.arc(W / 2, 560 + bob, 110, 0, Math.PI * 2); ctx.fill(); }
            text(ctx, sc.icon, W / 2, (big ? 820 : 610) + bob, { size: big ? 260 : 130, weight: 400 });
            ctx.restore();
          }
          captions(ctx, sc.say, seg, t, 1300, S.accent);
          // Progress dots: where we are in the story.
          for (let k = 0; k < n; k++) { ctx.fillStyle = k < i ? S.accent : 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(W / 2 + (k - (n - 1) / 2) * 30, 1600, 8, 0, Math.PI * 2); ctx.fill(); }
        } else {
          const s = settle(local / 0.6);
          ctx.fillStyle = `rgba(4,4,6,${0.82 * s})`; ctx.fillRect(0, 0, W, H);
          text(ctx, spec.outro || 'What do you think?', W / 2, 820, { size: 88, weight: 900, track: -0.035, alpha: s, maxW: 880 });
          text(ctx, S.end, W / 2, 1180, { size: 44, weight: 600, color: S.accent, alpha: settle((local - 0.5) / 0.6) });
        }
      },
      thumb(ctx, spec) {
        const tl = this.timeline(spec, []);
        if (style === 'frostpeak') {
          const k = spec.scenes.findIndex(s => s.focus && s.focus !== 'town');
          frostCamera(ctx, k >= 0 ? tl.segs[k + 1].start + 2 : 2, spec, tl);
          ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
        } else nightSky(ctx, 2.2, style);
        pill(ctx, S.label, W / 2, 520, S.pill);
        const icon = (spec.scenes.find(s => s.icon) || {}).icon;
        if (icon) text(ctx, icon, W / 2, 850, { size: 240, weight: 400 });
        thumbWords(ctx, spec.thumb || spec.title, 1060, S.accent);
      }
    };
  }

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
    return (ctx, out, level = 1) => {
      const t0 = ctx.currentTime + 0.05, beat = 60 / bpm;
      const master = ctx.createGain(); master.gain.value = 0.22 * level; master.connect(out);
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

  // Slow pads for the story shows: a calm, bright bed for Frostpeak, a cold drone for spooky stories, a ticking
  // pulse for mysteries. A soft hit on every scene change.
  function ambient(seed, duration, beats, mood) {
    let s = 7;
    for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const M = {
      frostpeak: { root: 57, chord: [0, 4, 7, 11], prog: [0, 5, 9, 7], wave: 'triangle', cut: 1800, hit: 84 },
      spooky: { root: 45, chord: [0, 3, 7], prog: [0, 1, -4, 0], wave: 'sawtooth', cut: 700, hit: 36 },
      mystery: { root: 50, chord: [0, 3, 7, 10], prog: [0, -4, -2, 0], wave: 'sawtooth', cut: 1100, hit: 74, pulse: true }
    }[mood];
    const hz = m => 440 * Math.pow(2, (m - 69) / 12), len = 4 + Math.floor(rand() * 2);
    return (ctx, out, level = 1) => {
      const t0 = ctx.currentTime + 0.05;
      const master = ctx.createGain(); master.gain.value = 0.16 * level; master.connect(out);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = M.cut; lp.connect(master);
      for (let k = 0, at = t0; at < t0 + duration; k++, at += len) {
        const fade = Math.min(1, (t0 + duration - at) / 3), root = M.root + M.prog[k % M.prog.length];
        M.chord.forEach((iv, j) => [-6, 6].forEach(cents => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = M.wave; o.frequency.value = hz(root + iv); o.detune.value = cents + j;
          const end = Math.min(at + len + 1.2, t0 + duration);
          g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.09 * fade, at + 1.4); g.gain.linearRampToValueAtTime(0, end);
          o.connect(g).connect(lp); o.start(at); o.stop(end + 0.05);
        }));
      }
      if (M.pulse) for (let at = t0; at < t0 + duration - 1; at += 0.75) {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 98;
        g.gain.setValueAtTime(0.5, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
        o.connect(g).connect(master); o.start(at); o.stop(at + 0.3);
      }
      beats.forEach(bt => {
        const at = t0 + bt;
        [0, 7, 12].forEach((iv, k) => {
          const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = hz(M.hit + iv);
          g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.18 / (k + 1), at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + (mood === 'spooky' ? 3 : 1.4));
          o.connect(g).connect(master); o.start(at); o.stop(at + 3.1);
        });
      });
    };
  }
  const soundtrack = (kind, seed, duration, beats) => kind === 'chiptune' ? chiptune(seed, duration, beats) : ambient(seed, duration, beats, kind);

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
      say: str(i && i.say, 200),
      icon: firstEmoji(i && i.icon)
    })).filter(i => i.label && Number.isFinite(i.value) && i.value > 0);
    if (items.length < 3 || items.length > 7) throw new Error('A ranking needs 3 to 7 items, each with a label and a positive number.');
    items.sort((a, b) => a.value - b.value); // countdown: smallest first, biggest is number one
    return { title: str(spec.title, 70) || 'Ranked', hook: str(spec.hook, 200), unit: str(spec.unit, 16), outro: str(spec.outro, 90), thumb: str(spec.thumb, 40), items };
  }
  const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

  function cleanStory(spec) {
    if (!spec || typeof spec !== 'object') throw new Error('No spec');
    const scenes = (Array.isArray(spec.scenes) ? spec.scenes : []).map(sc => ({
      say: str(sc && sc.say, 400),
      icon: firstEmoji(sc && sc.icon),
      focus: FOCUS[sc && sc.focus] ? sc.focus : 'town'
    })).filter(sc => sc.say);
    if (scenes.length < 2 || scenes.length > 12) throw new Error('A story needs 2 to 12 scenes, each with a line to say.');
    return { title: str(spec.title, 70) || 'Untitled', hook: str(spec.hook, 240), outro: str(spec.outro, 120), thumb: str(spec.thumb, 40), scenes };
  }

  const shows = { ranked, frostpeak: story('frostpeak'), spooky: story('spooky'), mystery: story('mystery') };
  // How long a spec runs when every line is read aloud at a natural pace (the server's recording time limit uses it).
  for (const sh of Object.values(shows)) sh.estimate = spec => sh.timeline(spec, sh.lines(spec).map(guess)).duration;
  const api = { W, H, shows, soundtrack, assets, FOCUS, clean: { ranked: cleanRanked, frostpeak: cleanStory, spooky: cleanStory, mystery: cleanStory } };
  if (typeof module !== 'undefined') module.exports = api; else window.FFStudio = api;
})();
