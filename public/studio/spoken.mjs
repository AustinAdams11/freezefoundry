// What the narrator actually says, word by word, and when. Numbers, dates and symbols are written out in words
// here, before the voice sees them, so every spoken word is known to belong to one caption word. Without this,
// "10,700" (one caption word) becomes four spoken words and every caption after it drifts.

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

function below1000(n) {
  const w = [];
  if (n >= 100) { w.push(ONES[Math.floor(n / 100)], 'hundred'); n %= 100; }
  if (n >= 20) { w.push(TENS[Math.floor(n / 10)]); n %= 10; if (n) w.push(ONES[n]); } else if (n) w.push(ONES[n]);
  return w;
}
export function cardinal(n) {
  if (n === 0) return ['zero'];
  let w = [];
  for (let i = 0; n > 0 && i < SCALES.length; i++, n = Math.floor(n / 1000)) {
    const g = n % 1000;
    if (g) w = [...below1000(g), ...(SCALES[i] ? [SCALES[i]] : []), ...w];
  }
  return w;
}
// Years are read in pairs: 1918 is "nineteen eighteen", 1905 "nineteen oh five", 1900 "nineteen hundred".
function year(n) {
  const hi = Math.floor(n / 100), lo = n % 100;
  if (lo === 0) return [...below1000(hi), 'hundred'];
  return [...below1000(hi), ...(lo < 10 ? ['oh', ONES[lo]] : below1000(lo))];
}
const ORD = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
const ordinal = w => [...w.slice(0, -1), ORD[w[w.length - 1]] || w[w.length - 1].replace(/y$/, 'ie') + 'th'];

// One written word (no surrounding spaces) as the words a narrator says. Anything that is not a number stays as is.
export function sayWord(word) {
  const m = /^([^\w$-]*)(-)?(\$)?(\d+(?:,\d{3})*)(\.\d+)?(st|nd|rd|th|s)?(%)?([A-Za-z]{0,3})([^\w]*)$/.exec(word);
  if (!m) return [word];
  const [, lead, minus, dollar, digits, dec, suffix, pct, unit, trail] = m;
  const n = Number(digits.replace(/,/g, ''));
  if (!Number.isSafeInteger(n)) return [word];
  const plainYear = !digits.includes(',') && !dec && !dollar && !pct && n >= 1100 && n <= 2099 && !(n >= 2000 && n <= 2009);
  let w = plainYear ? year(n) : cardinal(n);
  if (suffix === 's' && plainYear) w = [...w.slice(0, -1), w[w.length - 1].replace(/y$/, 'ie') + 's']; // the 1950s
  else if (suffix && suffix !== 's') w = ordinal(w);
  if (dec) w.push('point', ...dec.slice(1).split('').map(d => ONES[+d]));
  if (minus) w.unshift('minus');
  if (pct) w.push('percent');
  if (dollar) w.push(n === 1 && !dec ? 'dollar' : 'dollars');
  if (unit) w.push(...unit.toUpperCase().split(''));
  w[0] = lead + w[0];
  w[w.length - 1] += trail;
  return w;
}

// A line as [{ w: caption word, say: [spoken words] }].
export const sayLine = text => String(text).split(/\s+/).filter(Boolean).map(w => ({ w, say: sayWord(w) }));

// Caption word times, in samples, from the voice's per-sound durations. The phonemes come one character per token,
// with a padding token at each end and spaces between spoken words. The phonemizer sometimes runs two short words
// together ("in the", "does not") or splits one ("McArthur"), so spoken words are matched to phoneme words by
// length in sounds, allowing a 2-to-1 merge or a 1-to-2 split, with the cheapest overall fit winning (a small alignment table).
const SKIP = /[ˈˌː.,!?;:—…"“”()'’\-]/g;
export function wordTimes(words, ph, dur, samples, sounds = null) {
  const perUnit = samples / dur.reduce((a, b) => a + b, 0);
  const pw = [];
  let t = dur[0] * perUnit, cur = null;
  [...ph].forEach((ch, i) => {
    const len = dur[i + 1] * perUnit;
    if (ch === ' ') { if (cur) pw.push(cur); cur = null; }
    else if (!/[.,!?;:—…"“”()]/.test(ch)) { cur = cur || { start: t, end: t, n: 0 }; cur.end = t + len; if (!/[ˈˌː]/.test(ch)) cur.n++; }
    t += len;
  });
  if (cur) pw.push(cur);
  // How long each spoken word is: its own sound count when the voice gave one (sounds), else its letters.
  let s = 0;
  const sp = words.flatMap((x, k) => x.say.map(w => ({ k, n: Math.max(1, sounds ? sounds[s++] : w.replace(SKIP, '').length) })));
  if (!pw.length || !sp.length) return words.map(x => ({ w: x.w, start: 0, end: samples }));
  // cost[i][j]: best fit of the first i spoken words onto the first j phoneme words.
  const I = sp.length, J = pw.length, fit = (a, b) => Math.abs(Math.log((a + 1) / (b + 1)));
  const cost = Array.from({ length: I + 1 }, () => new Array(J + 1).fill(Infinity)), how = cost.map(r => r.map(() => 0));
  cost[0][0] = 0;
  for (let i = 0; i <= I; i++) for (let j = 0; j <= J; j++) {
    const c = cost[i][j];
    if (c === Infinity) continue;
    const step = (di, dj, v) => { if (i + di <= I && j + dj <= J && c + v < cost[i + di][j + dj]) { cost[i + di][j + dj] = c + v; how[i + di][j + dj] = di * 10 + dj; } };
    if (i < I && j < J) step(1, 1, fit(sp[i].n, pw[j].n));
    if (i + 1 < I && j < J) step(2, 1, fit(sp[i].n + sp[i + 1].n, pw[j].n) + 0.35);
    if (i < I && j + 1 < J) step(1, 2, fit(sp[i].n, pw[j].n + pw[j + 1].n) + 0.35);
  }
  // Walk back, giving each spoken word its time; two words sharing one phoneme word split it by length.
  const at = new Array(I);
  for (let i = I, j = J; i > 0;) {
    const h = how[i][j], di = Math.floor(h / 10), dj = h % 10;
    if (!h) break;
    if (di === 2) {
      const p = pw[j - 1], a = sp[i - 2].n, cut = p.start + (p.end - p.start) * a / (a + sp[i - 1].n);
      at[i - 2] = { start: p.start, end: cut }; at[i - 1] = { start: cut, end: p.end };
    } else at[i - 1] = { start: pw[j - dj].start, end: pw[j - 1].end };
    i -= di; j -= dj;
  }
  return words.map((x, k) => {
    const mine = at.filter((v, i) => v && sp[i].k === k);
    return mine.length ? { w: x.w, start: mine[0].start, end: mine[mine.length - 1].end } : { w: x.w, start: 0, end: 0 };
  }).map((x, k, all) => x.end ? x : { ...x, start: (all[k - 1] || { end: 0 }).end, end: (all[k - 1] || { end: 0 }).end }); // never happens with a full fit; keeps order if it does
}
