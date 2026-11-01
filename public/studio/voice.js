// Narration: Kokoro text-to-speech, run inside the page with WebAssembly. Nothing leaves the machine. The model
// (about 90 MB) downloads from Hugging Face the first time and the browser engine caches it; after that it works offline.
// This is the "timestamped" build of Kokoro: besides the audio it reports how long it holds every speech sound, which
// gives each word its exact start for the captions.
import { KokoroTTS, env } from './vendor/kokoro.web.js';
import { sayLine, wordTimes } from './spoken.mjs';

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

// How many speech sounds each word has on its own: the phonemizer runs, the voice model does not (milliseconds).
async function soundCounts(tts, words, voice) {
  const real = tts.generate_from_ids;
  tts.generate_from_ids = async () => ({ audio: new Float32Array(0), sampling_rate: 24000 });
  try {
    const out = [];
    for (const w of words) { await tts.generate(w, { voice }); out.push(phonemes.replace(/[ˈˌː.,!?;:—…"“”()'’\s-]/g, '').length); }
    return out;
  } finally { tts.generate_from_ids = real; }
}

// Speak one line, sentence by sentence (Kokoro reads at most ~500 tokens at a time). Returns the audio and every
// word's start and end in seconds. The silence Kokoro puts around each sentence is trimmed to a short breath.
export async function speak(text, voice = 'af_heart', speed = 1) {
  const tts = await load();
  // Sentence ends: . ! or ? then a space, but not an initial like the "S." in "George S. Worley" (3.5 has no space).
  const parts = String(text).split(/(?<=[.!?]["')\]]*)(?<!\b[A-Z]\.)\s+/).map(s => s.trim()).filter(Boolean);
  const chunks = [], words = [];
  let rate = 24000, at = 0;
  for (const p of parts) {
    const line = sayLine(p); // numbers written out, so each spoken word maps to one caption word
    const sounds = await soundCounts(tts, line.flatMap(x => x.say), voice);
    const a = await tts.generate(line.flatMap(x => x.say).join(' '), { voice, speed });
    rate = a.sampling_rate;
    const ws = wordTimes(line, phonemes, Array.from(durations.data), a.audio.length, sounds);
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
