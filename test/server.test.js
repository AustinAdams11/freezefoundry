// Starts the real server against a throwaway data folder and checks the safety rules and core APIs.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 4188;
const BASE = `http://127.0.0.1:${PORT}`;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-test-'));
let server;

const post = (p, body, headers = {}) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, FF_HOME: home, FF_PORT: String(PORT) } });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', d => { if (String(d).includes('running at')) resolve(); });
    server.on('exit', code => reject(new Error('server exited ' + code)));
  });
});

after(() => { server.kill(); fs.rmSync(home, { recursive: true, force: true }); });

test('settings load with defaults', async () => {
  const s = await (await fetch(BASE + '/api/settings')).json();
  assert.equal(s.attempts, 3);
  assert.equal(s.dataDir, path.join(home, 'data'));
});

test('other websites cannot drive the factory', async () => {
  const r = await post('/api/tasks', { goal: 'x' }, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('model downloads only accept Hugging Face .gguf links', async () => {
  assert.equal((await post('/api/download', { url: 'https://example.com/a.gguf' })).status, 400);
  assert.equal((await post('/api/download', { url: 'https://huggingface.co/a/b/resolve/main/notes.txt' })).status, 400);
});

test('file viewer cannot leave the workspace', async () => {
  const r = await fetch(BASE + '/api/file?path=' + encodeURIComponent('../data/settings.json'));
  assert.equal(r.status, 404);
});

test('starter skills are installed and a new skill round-trips', async () => {
  const before = await (await fetch(BASE + '/api/skills')).json();
  assert.ok(before.some(k => k.id === 'house-style'));
  const r = await post('/api/skills', { name: 'Test Skill', triggers: 'widget, gizmo', roles: ['builder'], body: 'Say hi.' });
  assert.equal(r.status, 200);
  const k = (await (await fetch(BASE + '/api/skills')).json()).find(x => x.id === 'test-skill');
  assert.deepEqual(k.triggers, ['widget', 'gizmo']);
  assert.deepEqual(k.roles, ['builder']);
  assert.equal(k.body, 'Say hi.');
  assert.equal((await post('/api/skills/delete', { id: '../data' })).status, 400);
  await post('/api/skills/delete', { id: 'test-skill' });
  assert.ok(!(await (await fetch(BASE + '/api/skills')).json()).some(x => x.id === 'test-skill'));
});

test('settings reject unsafe values and keep good ones', async () => {
  const s = await (await post('/api/settings', { temperature: 9, maxTokens: 5, ui: { accent: 'red;}', scale: 1.25, sounds: false } })).json();
  assert.equal(s.temperature, 0.7);
  assert.equal(s.maxTokens, 4096);
  assert.equal(s.ui.accent, '#a855f7');
  assert.equal(s.ui.scale, 1.25);
  assert.equal(s.ui.sounds, false);
});

test('API keys are stored but never sent back to the UI', async () => {
  const r = await post('/api/keys', { provider: 'openai', key: 'sk-test-1234567890' });
  assert.equal(r.status, 200);
  const s = await (await fetch(BASE + '/api/settings')).json();
  assert.equal(s.keysSet.openai, true);
  assert.ok(!JSON.stringify(s).includes('sk-test-1234567890'));
  assert.equal((await post('/api/keys', { provider: 'local', key: 'x' })).status, 400);
  assert.equal((await post('/api/keys', { provider: 'openai', key: 'has spaces in it' })).status, 400);
  await post('/api/keys', { provider: 'openai', key: '' });
  assert.equal((await (await fetch(BASE + '/api/settings')).json()).keysSet.openai, undefined);
});

test('sources: text uploads work, binary and web pages are refused by default', async () => {
  let r = await post('/api/sources', { name: 'notes.md', text: 'Our product sells templates.' });
  assert.equal(r.status, 200);
  const [src] = await r.json();
  assert.equal(src.name, 'notes.md');
  assert.equal((await post('/api/sources', { name: 'x.bin', text: 'a\u0000b' })).status, 400);
  assert.equal((await post('/api/sources', { url: 'https://example.com' })).status, 400); // internet is off by default
  r = await post('/api/sources/update', { id: src.id, remove: true });
  assert.equal((await r.json()).length, 0);
});

test('publishing needs a token and a real workspace folder', async () => {
  assert.equal((await post('/api/publish/apify', { folder: 'nope' })).status, 400);
});

test('training bay: off by default, then runs an approved .py file', async () => {
  const off = await post('/api/run', { path: 'train.py' });
  assert.equal(off.status, 400);
  assert.match((await off.json()).error, /Permissions/);

  const s = await (await fetch(BASE + '/api/settings')).json();
  await post('/api/settings', { permissions: { ...s.permissions, runScripts: true } });
  assert.equal((await post('/api/run', { path: '../outside.py' })).status, 400);
  assert.equal((await post('/api/run', { path: 'notes.txt' })).status, 400);

  fs.writeFileSync(path.join(s.workspace, 'train.py'), 'for e in range(3): print(f"epoch {e} loss {1/(e+1):.3f}")\n');
  assert.equal((await post('/api/run', { path: 'train.py' })).status, 200);
  let run;
  for (let i = 0; i < 50; i++) {
    run = await (await fetch(BASE + '/api/run')).json();
    if (run.status !== 'running') break;
    await new Promise(r => setTimeout(r, 200));
  }
  assert.equal(run.status, 'done', run.output);
  assert.match(run.output, /epoch 2 loss 0\.333/);
});
