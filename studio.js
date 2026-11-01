// Studio: Frostpeak Mining Co., a crew of AI agents that makes Shorts, each working its own mine like the workers on the
// factory line: the Prospector picks a topic, the Miner writes it, the Inspector checks it (and sends it back), the
// Dispatcher writes the title and tags, the Smelter records the video, and the Surveyor follows view counts and tells the
// Prospector what works. The Vault adds it up.
const fs = require('fs');
const path = require('path');
const { shows, clean } = require('./public/studio/shows.js');

// Mining titles for the crew of Frostpeak Mining Co.; icon and color tie each mine's sign to the key under the scene.
const CREW = [
  { id: 'scout', name: 'Prospector', icon: '🧭', color: '#7dd3fc', job: 'finds the next vein: picks the topic', role: 'planner' },
  { id: 'writer', name: 'Miner', icon: '⛏️', color: '#c084fc', job: 'digs out the story: writes the Short', role: 'builder' },
  { id: 'checker', name: 'Inspector', icon: '🔍', color: '#34d399', job: 'grades the ore: checks every number', role: 'reviewer' },
  { id: 'publisher', name: 'Dispatcher', icon: '🚂', color: '#ff9d2e', job: 'ships it out: title, description and tags', role: 'builder' },
  { id: 'studio', name: 'Smelter', icon: '🔥', color: '#ff6a5a', job: 'smelts the ingot: records the video', role: null },
  { id: 'analyst', name: 'Surveyor', icon: '📐', color: '#60a5fa', job: 'surveys the claims: tracks views', role: 'planner' }
];
const DEFAULTS = {
  auto: false, everyHours: 6, maxWaiting: 3, topics: '', rpm: 0.05, goal: 10000, show: 'ranked',
  approveScript: true, voiceOn: true, speed: 1,
  voices: { ranked: 'af_heart', frostpeak: 'am_michael', spooky: 'bm_george', mystery: 'am_fenrir' }
};
// Narrator voices (Kokoro), the best-graded English ones.
const VOICES = [
  { id: 'af_heart', name: 'Heart: warm, American' }, { id: 'af_bella', name: 'Bella: bright, American' }, { id: 'af_nicole', name: 'Nicole: soft, American' },
  { id: 'am_michael', name: 'Michael: steady, American' }, { id: 'am_fenrir', name: 'Fenrir: deep, American' }, { id: 'am_puck', name: 'Puck: playful, American' },
  { id: 'bf_emma', name: 'Emma: British' }, { id: 'bm_george', name: 'George: storyteller, British' }, { id: 'bm_fable', name: 'Fable: British' }
];
const VOICE_IDS = VOICES.map(v => v.id);
const ACTIVE = ['scouting', 'writing', 'checking', 'titling', 'rendering'];
// Waiting for you: a script to read, or a finished video to approve.
const WAITING = ['script', 'staged'];

// What the crew really is, so Frostpeak episodes explain the real thing.
const CREW_FACTS = `Frostpeak Mining Co. is a pixel-art mining town where AI workers make these videos. Each worker is the same local AI language model (a 35-billion-parameter mixture-of-experts model that uses about 3 billion parameters per word, compressed to 8-bit numbers, running on the owner's Mac with no cloud) given a different job:
- Prospector (focus "scout"): picks the next topic, using what the Surveyor learned.
- Miner (focus "writer"): writes the script. A language model writes one token (a piece of a word) at a time, each time predicting the most likely next token from everything before it.
- Inspector (focus "checker"): fact-checks the script and sends it back to the Miner with notes if something is wrong.
- Dispatcher (focus "publisher"): writes the title, description and tags.
- Smelter (focus "studio", the central foundry): records the video. The pictures are drawn frame by frame in a browser engine; the narrator's voice is Kokoro, an 82-million-parameter text-to-speech model that turns text into sounds (phonemes) and then into audio.
- Surveyor (focus "analyst"): reads view counts and passes lessons back to the Prospector.
- Vault (focus "bank"): adds up the views and earnings.
- The whole valley (focus "town"). A human owner reads every script and approves every video before it is posted.
Always call the workers by these names: Prospector, Miner, Inspector, Dispatcher, Smelter, Surveyor, Vault. The focus words (scout, writer, checker, publisher, studio, analyst, bank, town) are only camera positions: never say them in the script and never use them as names.`;

// Per show: how the Prospector picks, how the Miner writes, what the Inspector checks.
const AI = {
  ranked: {
    scout: 'Pick something people are curious about and that has real, well-known numbers (speeds, sizes, weights, distances, records, prices, populations).',
    write: 'Write a "Ranked" countdown Short: exactly 5 items, each with a real, widely published number in the SAME unit and measured the SAME way (never mix, for example, running speeds with diving speeds: narrow the topic instead). Every item must be a genuine member of the true top 5 for that exact topic; never pad the list with filler. Number one is the BIGGEST number. Use accurate, mainstream figures (round them); never invent items or numbers. Each "fact" is one punchy on-screen line under 80 characters. Each "say" is what the narrator says for that item, one sentence under 25 words, starting with its rank ("Number five: ..."), with units written out in words (kilometers per hour, not km/h). The title is a hook under 55 characters, like "The 5 fastest animals on Earth". The hook is one spoken sentence that makes people stay. The outro is a short question that makes people comment. "thumb" is 2 to 4 punchy words for the thumbnail. Output ONLY JSON: {"title": "", "hook": "", "unit": "<short unit, e.g. km/h>", "items": [{"label": "<under 24 characters>", "value": <number>, "fact": "", "say": ""}], "outro": "", "thumb": ""}',
    check: 'For each item, is the number right for that item and unit, as commonly published? Is every item a real member of the top 5 for this exact topic (filler that does not belong is wrong)? Is the same measure used for all items? Is number one really the biggest? Are the facts and spoken lines true? Choose "revise" ONLY for wrong numbers, wrong units, items that do not belong, false facts or a ranking that does not hold; small rounding is fine.'
  },
  frostpeak: {
    minWords: 110,
    scout: `Pick the next episode of the Frostpeak Mining Co. series: a friendly tour that introduces one worker (or the town itself) and the real science behind what it does. Topics are worker introductions or a single idea (how the Miner writes one token at a time, why the Inspector double-checks, how a voice is made from text, what "8-bit" means). Never repeat a past topic.

${CREW_FACTS}`,
    write: `Write a narrated tour Short for Frostpeak Mining Co. Friendly tour-guide voice, plain words a 12-year-old follows, and every science claim accurate (no hype, no invented numbers). 6 to 8 scenes; each scene's "say" is one or two spoken sentences, at most 30 words; 110 to 150 words in all. Each scene has "focus" (which place the camera shows: town, scout, writer, checker, publisher, studio, analyst or bank). The hook is one spoken sentence over the title that makes people stay. The outro is a short question that makes people comment. "thumb" is 2 to 4 punchy words for the thumbnail. Output ONLY JSON: {"title": "<under 55 characters>", "hook": "", "scenes": [{"say": "", "focus": ""}], "outro": "", "thumb": ""}

${CREW_FACTS}`,
    check: `Is every science claim accurate and the explanation easy to follow? Does each scene's focus match the worker it talks about? Is every worker called by its Frostpeak name (Prospector, Miner, Inspector, Dispatcher, Smelter, Surveyor, Vault), never by a camera word like scout, writer, checker, publisher, studio or analyst? The "focus" field is a camera position and must stay one of the camera words; only the spoken lines use names. Judge every claim against these facts, and never suggest a fix that contradicts them. Choose "revise" ONLY for false or misleading claims, a wrong worker name, a focus that shows the wrong place, or a script that is confusing.\n\n${CREW_FACTS}`
  },
  spooky: {
    minWords: 170,
    scout: 'Pick the premise for an ORIGINAL short spooky story (never a retelling of a book, film, game or famous creepypasta). Creepy, not gory; fine for teenagers. Make it specific: a real-feeling place (a night-shift gas station, a lake cabin in February, a hospital elevator), one ordinary person, and one wrong detail that will pay off in a twist. The angle names the twist in one sentence.',
    write: `Write an original spooky story Short, told by a narrator in first person, past tense. It must be a complete story with a payoff, not a mood piece.
Structure, one beat per scene:
1. Hook the ordinary: who, where, when, in concrete detail. Plant one small detail that seems harmless (it pays off in the twist).
2-3. Something is wrong, and it escalates: each scene adds a NEW concrete clue (a sound, an object, a message, a rule) and raises the stakes.
4-5. The narrator acts: investigates, breaks the rule, or tries to leave. Show what they see and hear.
6-7. The turn: the danger becomes undeniable.
Last scene: the twist. One or two short sentences that make the planted detail mean something terrible. No explaining it afterwards.
Rules: concrete nouns and sounds, not adjectives like "creepy" or "eerie"; short sentences read aloud well; no gore, nothing about self-harm; nothing a 13-year-old should not hear. 7 to 9 scenes; each scene's "say" is two or three spoken sentences, 20 to 35 words; 190 to 260 words in all. The hook is one spoken sentence over the title that makes people stay, without giving away the twist. The outro is a short question that makes people comment. "thumb" is 2 to 4 punchy words for the thumbnail. Output ONLY JSON: {"title": "<under 55 characters>", "hook": "", "scenes": [{"say": ""}], "outro": "", "thumb": ""}`,
    check: 'Grade it as a story editor. Is it a complete story: a concrete setup, escalation where every scene adds something new, and a twist that pays off a detail planted early? Is it original (not a known story), easy to follow when heard once, and free of filler lines ("it was so creepy")? Is anything gory or unsuitable for teenagers? Choose "revise" for any of these, and say exactly which scene to fix and how.'
  },
  mystery: {
    minWords: 170,
    scout: 'Pick a real unsolved mystery, legend or strange historical event with good records (for example a disappearance at sea, an undeciphered manuscript, a lost expedition). Never about private living people, and never a theory that blames a group of people or denies a tragedy.',
    write: `Write a Short that tells a real mystery or legend as a gripping story, with a narrator.
Structure, one beat per scene:
1. Open on the strangest documented moment, with the date and place.
2-3. Back up: who was involved and what was normal before it happened.
4-5. What was found or what happened, step by step, with the specific documented details that make it strange.
6-7. The leading explanations, each fairly: "Some believe...", "Investigators found...". Say which evidence supports or weakens each one.
Last scene: what is still unexplained, and why it is still debated.
Rules: keep what is documented apart from what people claim ("records show" for facts, "some believe" for theories); names, dates and places must be accurate; no invented quotes or details; concrete details, not adjectives. 7 to 9 scenes; each scene's "say" is two or three spoken sentences, 20 to 35 words; 190 to 260 words in all. The hook is one spoken sentence over the title that makes people stay. The outro is a short question that makes people comment. "thumb" is 2 to 4 punchy words for the thumbnail. Output ONLY JSON: {"title": "<under 55 characters>", "hook": "", "scenes": [{"say": ""}], "outro": "", "thumb": ""}`,
    check: 'Grade it as a fact-checking editor. Are the names, dates, places and documented facts accurate, with nothing invented? Are theories clearly presented as theories, never as fact? Does it avoid blaming a group of people or private living people? Does it tell a clear story where every scene adds something new? Choose "revise" for any of these, and say exactly which scene to fix and how.'
  }
};

function youtubeId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:shorts\/|watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function parseJson(raw) {
  const t = String(raw || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON in the answer');
  return JSON.parse(t.slice(a, b + 1));
}

function createStudio({ dataDir, callModel, getKey, writeJsonAtomic, port, attempts = () => 3 }) {
  const dir = path.join(dataDir, 'studio'), videos = path.join(dir, 'videos');
  fs.mkdirSync(videos, { recursive: true });
  const file = name => path.join(dir, name);
  const load = (name, fallback) => { try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; } };
  const S = {
    episodes: load('episodes.json', {}),
    settings: (st => ({ ...DEFAULTS, ...st, voices: { ...DEFAULTS.voices, ...(st.voices || {}) } }))(load('settings.json', {})),
    memory: load('memory.json', { lessons: [], lastRunAt: null, lastTrackAt: null }),
    events: [],
    busy: {}, // agent id -> what it is doing right now
    running: false
  };
  // A recording is MP4 when the app's engine can encode H.264, WebM otherwise. The thumbnail sits next to it.
  const thumbFile = id => path.join(videos, id + '.jpg');
  const videoFile = id => ['.mp4', '.webm'].map(x => path.join(videos, id + x)).find(f => fs.existsSync(f)) || null;
  const save = () => { writeJsonAtomic(file('episodes.json'), S.episodes); writeJsonAtomic(file('memory.json'), S.memory); };
  // Episodes that were mid-run when the app closed: mark them so the user can run them again.
  for (const ep of Object.values(S.episodes)) if (ACTIVE.includes(ep.status)) { ep.status = 'failed'; ep.error = 'The app closed while this episode was being made.'; }

  // The Town page animates these: work at a house, or a message walking from one house to another.
  function event(from, to, msg, epId) {
    S.events.push({ n: (S.events.length ? S.events[S.events.length - 1].n : 0) + 1, at: new Date().toISOString(), from, to, msg: String(msg).slice(0, 200), ep: epId || null });
    if (S.events.length > 300) S.events.splice(0, S.events.length - 300);
  }
  function log(ep, who, msg) { ep.log.push({ at: new Date().toISOString(), who, msg: String(msg).slice(0, 400) }); ep.updatedAt = new Date().toISOString(); save(); }
  async function work(agent, label, fn) {
    S.busy[agent] = label;
    try { return await fn(); } finally { delete S.busy[agent]; }
  }
  // Ask a crew member for JSON. A broken answer gets one more try before the episode fails.
  async function askJson(agent, system, user) {
    const c = CREW.find(x => x.id === agent);
    let raw;
    for (let i = 0; i < 2; i++) {
      raw = await callModel([{ role: 'system', content: system }, { role: 'user', content: user }], c.role, 'studio');
      try { return parseJson(raw); } catch {}
    }
    throw new Error(`The ${c.name}'s answer was not valid JSON. It began: ${String(raw || '').trim().slice(0, 150)}`);
  }

  // ---------- the crew ----------
  async function scout(ep) {
    const past = Object.values(S.episodes).filter(e => e.topic && e.id !== ep.id && e.show === ep.show).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40).map(e => e.topic);
    const j = await askJson('scout',
      `You are the Prospector for a YouTube Shorts channel. Pick ONE topic for the next Short. ${AI[ep.show].scout} Output ONLY JSON: {"topic": "<the topic, a few words>", "angle": "<one sentence: what makes it worth watching>"}`,
      `Show: ${shows[ep.show].name}. ${shows[ep.show].describe}\n\n` +
      (ep.idea ? `The owner asked for exactly this; turn it into the topic and angle without changing what they asked for:\n${ep.idea}\n\n` : `Past topics (do not repeat): ${past.join('; ') || 'none yet'}\n\n`) +
      (!ep.idea && S.settings.topics.trim() ? `Topic ideas from the owner (prefer these):\n${S.settings.topics.trim()}\n\n` : '') +
      (S.memory.lessons.length ? `What the Surveyor learned from view counts:\n- ${S.memory.lessons.join('\n- ')}` : 'No view data yet.'));
    ep.topic = String(j.topic || '').trim().slice(0, 120);
    ep.angle = String(j.angle || '').trim().slice(0, 240);
    if (!ep.topic) throw new Error('The Prospector did not pick a topic.');
  }

  async function write(ep, feedback) {
    const j = await askJson('writer',
      `You are the Miner, the writer for a YouTube Shorts channel. ${AI[ep.show].write}`,
      `Topic: ${ep.topic}\nAngle: ${ep.angle}` + (ep.idea ? `\nThe owner's request: ${ep.idea}` : '') +
      (feedback ? `\n\nYour last draft was sent back. Fix these problems:\n${feedback}\n\nYour last draft:\n${JSON.stringify(ep.spec)}` : ''));
    try { ep.spec = clean[ep.show](j); } catch (e) { throw new Error('The Miner\'s draft was not usable: ' + e.message); }
  }

  async function check(ep) {
    const j = await askJson('checker',
      `You are the Inspector. Check a Short before it is published. ${AI[ep.show].check} Keep each issue to one short line under 120 characters, and never put double quotes inside the text. Output ONLY JSON: {"verdict": "approve" or "revise", "issues": ["<where>: <what is wrong and the fix>"]}`,
      JSON.stringify(ep.spec, null, 1));
    return { verdict: j.verdict === 'revise' ? 'revise' : 'approve', issues: (Array.isArray(j.issues) ? j.issues : []).map(String).slice(0, 8) };
  }

  async function title(ep) {
    const j = await askJson('publisher',
      'You are the Dispatcher. Write the post for a YouTube Short. Title: under 70 characters, curiosity first, ends with " #Shorts". Description: two short sentences, then 3-5 relevant hashtags. Tags: 5-10 plain keywords. Output ONLY JSON: {"title": "", "description": "", "tags": [""]}',
      `Show: ${shows[ep.show].name}\nShort: ${ep.spec.title}\nScript: ${shows[ep.show].lines(ep.spec).filter(Boolean).join(' ')}\nAngle: ${ep.angle}`);
    let description = String(j.description || '').slice(0, 1900);
    if (S.settings.voiceOn) description += '\n\nNarrated with an AI voice.';
    ep.post = {
      title: String(j.title || ep.spec.title).slice(0, 100),
      description,
      tags: (Array.isArray(j.tags) ? j.tags : []).map(t => String(t).replace(/^#/, '').trim()).filter(Boolean).slice(0, 15)
    };
  }

  // Write, check (and send back) and title a script. With script approval on, it then waits for you; otherwise it
  // goes straight to the Smelter.
  async function produce(ep, feedback = '') {
    ep.status = 'writing';
    const max = Math.max(1, Math.min(5, attempts()));
    for (let i = 1; i <= max; i++) {
      await work('writer', `writing "${ep.topic}"${i > 1 ? ` (draft ${i})` : ''}`, () => write(ep, feedback));
      log(ep, 'Miner', `Draft ${i}: ${ep.spec.title}`);
      event('writer', 'checker', `Draft ${i} of "${ep.spec.title}"`, ep.id);
      ep.status = 'checking';
      const c = await work('checker', `checking "${ep.spec.title}"`, () => check(ep));
      // Too short is never a judgment call: send it back whatever the Inspector says.
      const words = shows[ep.show].lines(ep.spec).join(' ').split(/\s+/).filter(Boolean).length, min = AI[ep.show].minWords || 0;
      if (words < min) { c.verdict = 'revise'; c.issues.unshift(`Length: ${words} spoken words; write at least ${min}, with more scenes or fuller ones.`); }
      ep.checks.push(c);
      if (c.verdict === 'approve') { log(ep, 'Inspector', 'Checks out.'); break; }
      feedback = c.issues.join('\n');
      log(ep, 'Inspector', `Sent back: ${c.issues.join(' | ') || 'needs another pass'}`);
      if (i < max) { event('checker', 'writer', `Fix: ${c.issues[0] || 'needs another pass'}`, ep.id); ep.status = 'writing'; }
    }
    ep.flagged = ep.checks[ep.checks.length - 1].verdict !== 'approve';
    event('checker', 'publisher', ep.flagged ? 'Passing it on, but read my notes first' : 'Approved', ep.id);
    ep.status = 'titling';
    await work('publisher', 'writing the title and tags', () => title(ep));
    log(ep, 'Dispatcher', ep.post.title);
    if (S.settings.approveScript) {
      ep.status = 'script';
      S.running = false;
      log(ep, 'Dispatcher', 'Script ready. Read it, edit it, then press Record.');
      event('publisher', 'bank', `Script ready: ${ep.spec.title}`, ep.id);
      save();
      return;
    }
    record(ep);
  }

  function record(ep) {
    event('publisher', 'studio', `Roll it: ${ep.post.title}`, ep.id);
    ep.status = 'rendering';
    delete ep.error;
    S.running = true;
    S.busy.studio = `recording "${ep.spec.title}"`;
    save();
    render(ep);
  }

  // ---------- the run: one episode, house to house ----------
  async function run({ show, idea } = {}) {
    if (S.running) throw new Error('The crew is already busy with an episode.');
    show = shows[show] ? show : S.settings.show;
    S.running = true;
    const id = 'ep_' + Date.now().toString(36);
    const ep = S.episodes[id] = { id, show, idea: String(idea || '').trim().slice(0, 1000), status: 'scouting', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), log: [], checks: [], links: {}, stats: {}, history: [] };
    if (!ep.idea) delete ep.idea;
    S.memory.lastRunAt = ep.createdAt;
    save();
    guard(ep, async () => {
      await work('scout', ep.idea ? 'reading your idea' : 'looking for a topic', () => scout(ep));
      log(ep, 'Prospector', `Topic: ${ep.topic}. ${ep.angle}`);
      event('scout', 'writer', `New topic: ${ep.topic}`, id);
      await produce(ep);
    });
    return ep;
  }

  // Runs a step of the crew in the background; any error fails the episode and frees the crew.
  function guard(ep, fn) {
    fn().catch(e => {
      ep.status = 'failed'; ep.error = e.message;
      log(ep, 'Town', 'Stopped: ' + e.message);
      S.running = false;
    });
  }

  // The desktop app records in a hidden window; without it (developer mode), open render.html?ep=<id> yourself.
  let electron = null;
  try { const e = require('electron'); if (e && typeof e === 'object' && e.BrowserWindow) electron = e; } catch {}
  const windows = {};
  function render(ep) {
    if (!electron) { log(ep, 'Smelter', `Waiting for a renderer: open /studio/render.html?ep=${ep.id}`); return; }
    const win = windows[ep.id] = new electron.BrowserWindow({
      show: false, width: 540, height: 960,
      webPreferences: { offscreen: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', contextIsolation: true, sandbox: true }
    });
    win.webContents.setFrameRate(30);
    win.loadURL(`http://127.0.0.1:${port}/studio/render.html?ep=${encodeURIComponent(ep.id)}`);
    // Speaking every line comes first, and the first time the voice (about 90 MB) downloads, so allow for both.
    const limit = (shows[ep.show].estimate(ep.spec) * 1.5 + 600) * 1000;
    ep.renderTimer = setTimeout(() => finishRender(ep.id, 'The recording took too long and was stopped.'), limit);
  }
  function finishRender(id, error) {
    const ep = S.episodes[id];
    if (windows[id]) { try { windows[id].destroy(); } catch {} delete windows[id]; }
    if (!ep || ep.status !== 'rendering') return;
    clearTimeout(ep.renderTimer); delete ep.renderTimer;
    delete S.busy.studio;
    S.running = false;
    if (error) { ep.status = 'failed'; ep.error = error; log(ep, 'Smelter', 'Recording failed: ' + error); return; }
    ep.status = 'staged';
    log(ep, 'Smelter', 'Recorded. Waiting for your OK.');
    event('studio', 'bank', `"${ep.spec.title}" is ready for your OK`, id);
  }

  // ---------- the Surveyor: view counts and lessons ----------
  async function track() {
    const key = getKey('youtube');
    const eps = Object.values(S.episodes).filter(e => e.links.youtube);
    if (!key || !eps.length) return { tracked: 0, reason: key ? 'No posted links yet.' : 'Add a YouTube API key in the Town settings to track views.' };
    S.busy.analyst = 'reading view counts';
    try {
      for (let i = 0; i < eps.length; i += 50) {
        const batch = eps.slice(i, i + 50);
        const ids = batch.map(e => youtubeId(e.links.youtube)).filter(Boolean).join(',');
        const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids}&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((d.error && d.error.message) || `YouTube said ${r.status}`);
        for (const item of d.items || []) {
          const ep = batch.find(e => youtubeId(e.links.youtube) === item.id);
          const st = item.statistics || {};
          ep.stats.youtube = { views: +st.viewCount || 0, likes: +st.likeCount || 0, comments: +st.commentCount || 0, at: new Date().toISOString() };
          ep.history.push({ at: ep.stats.youtube.at, views: ep.stats.youtube.views });
          if (ep.history.length > 500) ep.history.splice(0, ep.history.length - 500);
        }
      }
      S.memory.lastTrackAt = new Date().toISOString();
      save();
      event('analyst', 'bank', `Views updated: ${totals().views.toLocaleString('en-US')} total`);
      await learn().catch(() => {});
      return { tracked: eps.length };
    } finally { delete S.busy.analyst; }
  }

  // With a few posted videos, compare the best and the worst and pass the lessons to the Prospector.
  async function learn() {
    const posted = Object.values(S.episodes).filter(e => e.stats.youtube).sort((a, b) => b.stats.youtube.views - a.stats.youtube.views);
    if (posted.length < 3) return;
    const line = e => `${e.stats.youtube.views} views: "${(e.post && e.post.title) || e.spec.title}" (topic: ${e.topic})`;
    const j = await askJson('analyst',
      'You are the Surveyor. Compare the best and worst performing Shorts and write up to 3 short, specific lessons for choosing the next topics and titles. Only conclude what the numbers support. Output ONLY JSON: {"lessons": [""]}',
      `Best:\n${posted.slice(0, 5).map(line).join('\n')}\n\nWorst:\n${posted.slice(-5).map(line).join('\n')}`);
    S.memory.lessons = (Array.isArray(j.lessons) ? j.lessons : []).map(String).filter(Boolean).slice(0, 3);
    save();
    if (S.memory.lessons.length) event('analyst', 'scout', `Lesson: ${S.memory.lessons[0]}`);
  }

  function totals() {
    const eps = Object.values(S.episodes);
    const views = eps.reduce((n, e) => n + ((e.stats.youtube && e.stats.youtube.views) || 0), 0);
    return { views, posts: eps.filter(e => e.links.youtube || e.status === 'posted').length, made: eps.filter(e => ['staged', 'ready', 'posted'].includes(e.status)).length, waiting: eps.filter(e => WAITING.includes(e.status)).length, earnings: Math.round(views / 1000 * S.settings.rpm * 100) / 100 };
  }

  // Autopilot: while the app is open, start an episode every few hours and refresh views every 30 minutes,
  // but never pile up more videos than you've had time to look at.
  const timer = setInterval(() => {
    const now = Date.now();
    if (S.settings.auto && !S.running && totals().waiting < S.settings.maxWaiting && (!S.memory.lastRunAt || now - Date.parse(S.memory.lastRunAt) > S.settings.everyHours * 3600e3)) run().catch(() => {});
    if (!S.memory.lastTrackAt || now - Date.parse(S.memory.lastTrackAt) > 30 * 60e3) track().catch(() => { S.memory.lastTrackAt = new Date().toISOString(); });
  }, 60e3);
  timer.unref();

  function summary(ep) {
    const { log: l, renderTimer, ...rest } = ep;
    return { ...rest, log: l.slice(-20), hasVideo: !!videoFile(ep.id), hasThumb: fs.existsSync(thumbFile(ep.id)), lines: ep.spec ? shows[ep.show].lines(ep.spec) : [] };
  }
  function state(since = 0) {
    return {
      crew: CREW.map(c => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, job: c.job, doing: S.busy[c.id] || null })),
      episodes: Object.values(S.episodes).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60).map(summary),
      bank: { ...totals(), goal: S.settings.goal, rpm: S.settings.rpm },
      events: S.events.filter(e => e.n > since),
      settings: S.settings, running: S.running, lessons: S.memory.lessons,
      youtubeKey: !!getKey('youtube'), canRecord: !!electron,
      shows: Object.entries(shows).map(([id, sh]) => ({ id, name: sh.name, describe: sh.describe })), voices: VOICES
    };
  }

  function updateSettings(b) {
    const st = S.settings;
    if (typeof b.auto === 'boolean') st.auto = b.auto;
    if (Number.isFinite(+b.everyHours) && +b.everyHours >= 1 && +b.everyHours <= 168) st.everyHours = +b.everyHours;
    if (Number.isInteger(+b.maxWaiting) && +b.maxWaiting >= 1 && +b.maxWaiting <= 20) st.maxWaiting = +b.maxWaiting;
    if (typeof b.topics === 'string') st.topics = b.topics.slice(0, 4000);
    if (Number.isFinite(+b.rpm) && +b.rpm >= 0 && +b.rpm <= 50) st.rpm = +b.rpm;
    if (Number.isFinite(+b.goal) && +b.goal >= 100) st.goal = Math.round(+b.goal);
    if (shows[b.show]) st.show = b.show;
    if (typeof b.approveScript === 'boolean') st.approveScript = b.approveScript;
    if (typeof b.voiceOn === 'boolean') st.voiceOn = b.voiceOn;
    if (Number.isFinite(+b.speed) && +b.speed >= 0.7 && +b.speed <= 1.3) st.speed = Math.round(+b.speed * 100) / 100;
    if (b.voices && typeof b.voices === 'object') for (const [k, v] of Object.entries(b.voices)) if (shows[k] && VOICE_IDS.includes(v)) st.voices[k] = v;
    writeJsonAtomic(file('settings.json'), st);
  }

  // ---------- HTTP ----------
  const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  function readBody(req, limit = 1 << 20) {
    return new Promise((resolve, reject) => {
      let b = '';
      req.on('data', c => { b += c; if (b.length > limit) { reject(new Error('Request body too large')); req.destroy(); } });
      req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(e); } });
    });
  }

  async function handle(req, res, pathname, method) {
    if (!pathname.startsWith('/api/studio')) return false;
    const parts = pathname.split('/').slice(3); // after /api/studio
    try {
      if (!parts.length && method === 'GET') return send(res, 200, state(+new URL(req.url, 'http://x').searchParams.get('since') || 0)), true;
      if (parts[0] === 'run' && method === 'POST') { const b = await readBody(req); return send(res, 200, summary(await run({ show: b.show, idea: b.idea }))), true; }
      if (parts[0] === 'track' && method === 'POST') return send(res, 200, await track()), true;
      if (parts[0] === 'settings' && method === 'POST') { updateSettings(await readBody(req)); return send(res, 200, state()), true; }
      if (parts[0] === 'thumbs' && method === 'GET') {
        const id = (parts[1] || '').replace(/\.jpg$/, '');
        if (!/^ep_[a-z0-9]+$/.test(id) || !fs.existsSync(thumbFile(id))) return send(res, 404, { error: 'No thumbnail' }), true;
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache' });
        fs.createReadStream(thumbFile(id)).pipe(res);
        return true;
      }
      if (parts[0] === 'videos' && method === 'GET') {
        const id = (parts[1] || '').replace(/\.(webm|mp4)$/, '');
        const f = /^ep_[a-z0-9]+$/.test(id) && videoFile(id);
        if (!f) return send(res, 404, { error: 'No video' }), true;
        const type = f.endsWith('.mp4') ? 'video/mp4' : 'video/webm';
        const size = fs.statSync(f).size, range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
        if (range) {
          const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], size - 1) : size - 1;
          res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
          fs.createReadStream(f, { start, end }).pipe(res);
        } else {
          res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size, 'Content-Disposition': `inline; filename="${path.basename(f)}"` });
          fs.createReadStream(f).pipe(res);
        }
        return true;
      }
      if (parts[0] === 'episodes' && parts[1]) {
        const ep = S.episodes[parts[1]];
        if (!ep && parts[2] === 'delete') return send(res, 200, { ok: true }), true; // already gone
        if (!ep) return send(res, 404, { error: 'Episode not found' }), true;
        const action = parts[2];
        if (!action && method === 'GET') return send(res, 200, { id: ep.id, show: ep.show, spec: ep.spec, post: ep.post, status: ep.status, voice: { on: S.settings.voiceOn, id: S.settings.voices[ep.show], speed: S.settings.speed } }), true;
        if (method !== 'POST') return send(res, 405, { error: 'Method not allowed' }), true;
        if (action === 'video') {
          if (ep.status !== 'rendering') { req.resume(); return send(res, 409, { error: 'This episode is not being recorded' }), true; }
          const ext = String(req.headers['content-type']).startsWith('video/mp4') ? '.mp4' : '.webm';
          const tmp = path.join(videos, ep.id + ext + '.part');
          let bytes = 0, tooBig = false;
          const out = fs.createWriteStream(tmp);
          req.on('data', c => { bytes += c.length; if (bytes > 500 * 1024 * 1024) { tooBig = true; req.destroy(); } });
          await new Promise((resolve, reject) => { req.pipe(out); out.on('finish', resolve); out.on('error', reject); req.on('error', reject); req.on('close', () => { if (tooBig) reject(new Error('Video too large')); }); });
          if (bytes < 1000) throw new Error('The recording was empty');
          fs.renameSync(tmp, path.join(videos, ep.id + ext));
          ep.video = { bytes, file: ep.id + ext, at: new Date().toISOString() };
          finishRender(ep.id);
          save();
          return send(res, 200, { ok: true, bytes }), true;
        }
        if (action === 'render-error') { const b = await readBody(req); finishRender(ep.id, String(b.error || 'Recording failed').slice(0, 300)); save(); return send(res, 200, { ok: true }), true; }
        if (action === 'thumb') {
          if (ep.status !== 'rendering') { req.resume(); return send(res, 409, { error: 'This episode is not being recorded' }), true; }
          const chunks = []; let bytes = 0;
          for await (const c of req) { bytes += c.length; if (bytes > 4 * 1024 * 1024) throw new Error('Thumbnail too large'); chunks.push(c); }
          fs.writeFileSync(thumbFile(ep.id), Buffer.concat(chunks));
          return send(res, 200, { ok: true }), true;
        }
        if (action === 'script') {
          if (ep.status !== 'script') throw new Error('Only a script that is waiting for you can be edited.');
          const b = await readBody(req), sh = shows[ep.show], lines = Array.isArray(b.lines) ? b.lines.map(String) : null;
          const spec = JSON.parse(JSON.stringify(ep.spec));
          if (typeof b.title === 'string' && b.title.trim()) spec.title = b.title;
          if (lines) {
            const body = ep.show === 'ranked' ? spec.items : spec.scenes, n = body.length;
            if (lines.length !== n + 2) throw new Error(`Expected ${n + 2} lines.`);
            spec.hook = lines[0]; spec.outro = lines[n + 1];
            body.forEach((x, i) => { x.say = lines[i + 1]; });
          }
          ep.spec = clean[ep.show](spec);
          if (b.post && typeof b.post === 'object') {
            if (typeof b.post.title === 'string' && b.post.title.trim()) ep.post.title = b.post.title.trim().slice(0, 100);
            if (typeof b.post.description === 'string') ep.post.description = b.post.description.slice(0, 2000);
          }
          log(ep, 'You', 'Edited the script.');
          return send(res, 200, summary(ep)), true;
        }
        if (action === 'revise') {
          if (!['script', 'staged', 'failed', 'rejected'].includes(ep.status) || !ep.spec) throw new Error('This episode has no script to revise yet.');
          if (S.running) throw new Error('The crew is busy; try again when it is done.');
          const note = String((await readBody(req)).note || '').trim().slice(0, 1000);
          if (!note) throw new Error('Write what you want changed.');
          S.running = true;
          log(ep, 'You', 'Sent back: ' + note);
          event('bank', 'writer', `Rewrite: ${note}`, ep.id);
          guard(ep, () => produce(ep, 'The owner asked for these changes: ' + note));
          return send(res, 200, summary(ep)), true;
        }
        if (action === 'record') {
          if (!['script', 'staged', 'failed', 'rejected'].includes(ep.status) || !ep.post) throw new Error('This episode has no finished script yet.');
          if (S.running) throw new Error('The crew is busy; try again when it is done.');
          record(ep);
          return send(res, 200, summary(ep)), true;
        }
        if (action === 'approve') { if (ep.status !== 'staged') throw new Error('Only a finished episode can be approved.'); ep.status = 'ready'; log(ep, 'You', 'Approved. Post it, then paste the link here.'); event('bank', 'publisher', `Approved: ${ep.spec.title}`, ep.id); return send(res, 200, summary(ep)), true; }
        if (action === 'reject') { if (!['staged', 'ready'].includes(ep.status)) throw new Error('Only a finished episode can be rejected.'); ep.status = 'rejected'; log(ep, 'You', 'Rejected.'); return send(res, 200, summary(ep)), true; }
        if (action === 'link') {
          const b = await readBody(req);
          if (!youtubeId(b.url)) throw new Error('Paste a YouTube link, like https://youtube.com/shorts/…');
          ep.links.youtube = String(b.url).trim().slice(0, 300); ep.status = 'posted';
          log(ep, 'You', 'Posted: ' + ep.links.youtube); event('publisher', 'analyst', `Posted "${ep.spec.title}"`, ep.id);
          track().catch(() => {});
          return send(res, 200, summary(ep)), true;
        }
        if (action === 'delete') {
          if (ACTIVE.includes(ep.status)) throw new Error('Wait until the crew is done with this one.');
          delete S.episodes[ep.id]; try { fs.unlinkSync(videoFile(ep.id)); } catch {} try { fs.unlinkSync(thumbFile(ep.id)); } catch {}
          save(); return send(res, 200, { ok: true }), true;
        }
        return send(res, 404, { error: 'Unknown action' }), true;
      }
      return send(res, 404, { error: 'Not found' }), true;
    } catch (e) { return send(res, 400, { error: e.message }), true; }
  }

  return { handle, run, track, state, videosDir: videos, stop: () => clearInterval(timer) };
}

module.exports = { createStudio, youtubeId, CREW };
