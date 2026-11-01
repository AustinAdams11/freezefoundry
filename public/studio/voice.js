// Narration: Kokoro text-to-speech, run inside the page with WebAssembly. Nothing leaves the machine. The model
// (about 90 MB) downloads from Hugging Face the first time and the browser engine caches it; after that it works offline.
// This is the "timestamped" build of Kokoro: besides the audio it reports how long it holds every speech sound, which
// gives each word its exact start for the captions.
import { KokoroTTS, env } from './vendor/kokoro.web.js';

env.wasmPaths = new URL('./vendor/', import.meta.url).href;
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX-timestamped';

let ready = null, phonemes = '', durations = null;
export function load(onProgress) {
  ready = ready || KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm', progress_callback: onProgress }).then(tts => {
    // kokoro-js keeps the phonemes and the durations to itself; catch them on the way through.
    tts.tokenizer = new Proxy(tts.tokenizer, { apply(t, self, args) { phonemes = args[0]; return Reflect.apply(t, self, args); } });
    tts.model = new Proxy(tts.model, { apply(t, self, args) { return Reflect.apply(t, self, args).then(o => { durations = o.durations; return o; }); } });
    dropOldModel();
    return tts;
  }).catch(e => { ready = null; throw e; });
  return ready;
}

// The first narrator build (no timestamps) is not used any more; free its ~90 MB from the cache.
function dropOldModel() {
  if (typeof caches === 'undefined') return;
  caches.open('transformers-cache').then(c => c.keys().then(ks => ks
    .filter(r => r.url.includes('/Kokoro-82M-v1.0-ONNX/resolve/') && r.url.includes('/onnx/'))
    .forEach(r => c.delete(r)))).catch(() => {});
}

// Speak one line, sentence by sentence (Kokoro reads at most ~500 tokens at a time). Returns the audio and every
// word's start and end in seconds. The silence Kokoro puts around each sentence is trimmed to a short breath.
export async function speak(text, voice = 'af_heart', speed = 1) {
  const tts = await load();
  const parts = (String(text).match(/[^.!?]+[.!?]*["')\]]*\s*/g) || [String(text)]).map(s => s.trim()).filter(Boolean);
  const chunks = [], words = [];
  let rate = 24000, at = 0;
  for (const p of parts) {
    const a = await tts.generate(p, { voice, speed });
    rate = a.sampling_rate;
    const ws = wordTimes(p, phonemes, Array.from(durations.data), a.audio.length);
    const from = Math.max(0, Math.round(ws[0].start - rate * 0.04)), to = Math.min(a.audio.length, Math.round(ws[ws.length - 1].end + rate * 0.12));
    for (const w of ws) words.push({ w: w.w, start: (at + w.start - from) / rate, end: (at + w.end - from) / rate });
    chunks.push(a.audio.subarray(from, to));
    at += to - from;
  }
  const samples = new Float32Array(at);
  let o = 0;
  for (const c of chunks) { samples.set(c, o); o += c.length; }
  return { samples, rate, seconds: at / rate, words };
}

// Word starts and ends, in samples, from Kokoro's per-sound durations. The phonemes come one character per token,
// with a padding token at each end and spaces between words. Text and phoneme words are matched clause by clause
// (punctuation survives into the phonemes); inside a clause where they differ, as when "1872" becomes three spoken
// words, the text words share the clause's phoneme words in order.
export function wordTimes(text, ph, dur, samples) {
  const perUnit = samples / dur.reduce((a, b) => a + b, 0);
  const pw = []; // phoneme words: start and end in samples, and whether a clause ends there
  let t = dur[0] * perUnit, cur = null;
  [...ph].forEach((ch, i) => {
    const len = dur[i + 1] * perUnit;
    if (ch === ' ') { if (cur) pw.push(cur); cur = null; }
    else if (/[.,!?;:—…"“”]/.test(ch)) { if (cur) cur.stop = true; }
    else { cur = cur || { start: t, end: t, stop: false }; cur.end = t + len; }
    t += len;
  });
  if (cur) pw.push(cur);
  const tw = String(text).split(/\s+/).filter(Boolean);
  if (!pw.length) return tw.map(w => ({ w, start: 0, end: samples }));
  const clauses = stops => { const out = [[]]; stops.forEach((s, i) => { out[out.length - 1].push(i); if (s && i < stops.length - 1) out.push([]); }); return out; };
  const tc = clauses(tw.map(w => /[.,!?;:]["')\]]*$/.test(w))), pc = clauses(pw.map(p => p.stop));
  const pairs = tc.length === pc.length ? tc.map((c, i) => [c, pc[i]]) : [[tw.map((_, i) => i), pw.map((_, i) => i)]];
  const out = [];
  for (const [tws, pws] of pairs) tws.forEach((ti, j) => {
    const a = Math.floor(j * pws.length / tws.length), b = Math.max(a, Math.ceil((j + 1) * pws.length / tws.length) - 1);
    out.push({ w: tw[ti], start: pw[pws[a]].start, end: pw[pws[b]].end });
  });
  return out;
}
