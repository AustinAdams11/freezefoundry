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
