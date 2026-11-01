// Narration: Kokoro text-to-speech, run inside the page with WebAssembly. Nothing leaves the machine. The model
// (about 90 MB) downloads from Hugging Face the first time and the browser engine caches it; after that it works offline.
import { KokoroTTS, env } from './vendor/kokoro.web.js';

env.wasmPaths = new URL('./vendor/', import.meta.url).href;

let ready = null;
export function load(onProgress) {
  ready = ready || KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'wasm', progress_callback: onProgress })
    .catch(e => { ready = null; throw e; });
  return ready;
}

// Speak one line. Kokoro reads at most ~500 tokens per call, so longer text goes sentence by sentence. Each
// sentence's audible start and end are measured, so captions can follow the real voice ("marks", in seconds).
export async function speak(text, voice = 'af_heart', speed = 1) {
  const tts = await load();
  const parts = (String(text).match(/[^.!?]+[.!?]*["')\]]*\s*/g) || [String(text)]).map(s => s.trim()).filter(Boolean);
  const chunks = [], marks = [];
  let rate = 24000, at = 0;
  for (const p of parts) {
    const a = await tts.generate(p, { voice, speed });
    rate = a.sampling_rate;
    const [from, to] = voicedSpan(a.audio, rate);
    // Pin each comma phrase to the pause the voice really makes there, when the pauses and commas line up.
    const phrases = p.split(/(?<=[,;:])\s+/), gaps = pauses(a.audio, rate, from, to);
    const cuts = phrases.length > 1 && gaps.length === phrases.length - 1 ? gaps : [];
    phrases.forEach((text, i) => {
      if (!cuts.length && i) return;
      const s0 = cuts.length && i ? cuts[i - 1][1] : from, s1 = cuts.length && i < cuts.length ? cuts[i][0] : to;
      marks.push({ text: cuts.length ? text : p, start: (at + s0) / rate, end: (at + s1) / rate });
    });
    const gap = new Float32Array(Math.round(rate * 0.18)); // a breath between sentences
    chunks.push(a.audio, gap);
    at += a.audio.length + gap.length;
  }
  const samples = new Float32Array(at);
  let o = 0;
  for (const c of chunks) { samples.set(c, o); o += c.length; }
  return { samples, rate, seconds: samples.length / rate, marks };
}

// Silences of 100 ms or more inside the speech, as [start, end] sample pairs.
export function pauses(x, rate, from, to) {
  const win = Math.round(rate * 0.01), out = [];
  let q = -1;
  for (let i = from; i < to; i += win) {
    let e = 0; for (let k = i; k < Math.min(to, i + win); k++) e = Math.max(e, Math.abs(x[k]));
    if (e < 0.02) { if (q < 0) q = i; } else { if (q >= 0 && i - q >= rate * 0.1) out.push([q, i]); q = -1; }
  }
  return out;
}

// First and last sample of actual speech: 10 ms windows whose loudness clears a quiet floor.
export function voicedSpan(x, rate) {
  const win = Math.max(1, Math.round(rate * 0.01)), loud = i => { let e = 0; for (let k = i; k < Math.min(x.length, i + win); k++) e = Math.max(e, Math.abs(x[k])); return e > 0.02; };
  let a = 0, b = x.length;
  while (a < x.length && !loud(a)) a += win;
  while (b > a && !loud(Math.max(0, b - win))) b -= win;
  return a < b ? [a, b] : [0, x.length];
}
