// Runs the narrator off the page's main thread, so the app stays responsive while a line is spoken.
import { load, speak } from './voice.js';

onmessage = async ({ data }) => {
  try {
    await load(p => { if (p.status === 'progress' && p.total) postMessage({ progress: { loaded: p.loaded, total: p.total } }); });
    postMessage({ speaking: true });
    const a = await speak(data.text, data.voice, data.speed);
    postMessage({ samples: a.samples, rate: a.rate }, [a.samples.buffer]);
  } catch (e) { postMessage({ error: e.message || String(e) }); }
};
