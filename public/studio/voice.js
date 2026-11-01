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

// Speak one line. Kokoro reads at most ~500 tokens per call, so longer text goes sentence by sentence.
export async function speak(text, voice = 'af_heart', speed = 1) {
  const tts = await load();
  const parts = String(text).match(/[^.!?]+[.!?]*["')\]]*\s*/g) || [String(text)];
  const chunks = [];
  let rate = 24000;
  for (const p of parts.map(s => s.trim()).filter(Boolean)) {
    const a = await tts.generate(p, { voice, speed });
    rate = a.sampling_rate;
    chunks.push(a.audio, new Float32Array(Math.round(rate * 0.12))); // a breath between sentences
  }
  const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { samples.set(c, o); o += c.length; }
  return { samples, rate, seconds: samples.length / rate };
}
