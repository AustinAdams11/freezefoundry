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

test('watchers read HTTP and cgminer-style TCP APIs and raise alerts', async () => {
  const http = require('node:http'), net = require('node:net');
  const web = http.createServer((q, r) => r.end(JSON.stringify({ temp: 91, hashRate: 480 }))).listen(0);
  const miner = net.createServer(sock => sock.on('data', d => {
    assert.match(String(d), /"command":"summary"/);
    sock.end(JSON.stringify({ SUMMARY: [{ 'MHS 5s': 9300.5 }] }) + '\0');
  })).listen(0);
  await new Promise(r => setTimeout(r, 100));
  try {
    const t = await (await post('/api/watchers/test', { kind: 'tcp', host: '127.0.0.1', port: miner.address().port, fields: 'SUMMARY.0.MHS 5s' })).json();
    assert.equal(t.values['SUMMARY.0.MHS 5s'], 9300.5);

    assert.equal((await post('/api/watchers', { kind: 'http', url: 'file:///etc/passwd' })).status, 400);
    const w = await (await post('/api/watchers', { name: 'Rig', kind: 'http', url: `http://127.0.0.1:${web.address().port}/`, fields: 'temp,hashRate', rule: { op: '>', path: 'temp', value: 85 } })).json();
    let list;
    for (let i = 0; i < 25; i++) {
      list = await (await fetch(BASE + '/api/watchers')).json();
      if (list.alerts.length) break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(list.watchers[0].state.values.temp, 91);
    assert.match(list.alerts[0].message, /temp is 91/);
    await post('/api/watchers/delete', { id: w.id });
    assert.equal((await (await fetch(BASE + '/api/watchers')).json()).watchers.length, 0);
  } finally { web.close(); miner.close(); }
});

test('approve records the change, undo restores or removes it, statuses persist', async () => {
  const s = await (await fetch(BASE + '/api/settings')).json();
  const stage = async (goal, file, content) => {
    const t = await (await post('/api/tasks', { goal })).json();
    const pid = `${t.id}_1`;
    fs.mkdirSync(path.join(home, 'data', 'proposals'), { recursive: true });
    fs.writeFileSync(path.join(home, 'data', 'proposals', `proposal_${pid}.json`), JSON.stringify({ proposal_id: pid, file_path: file, content }));
    return { t, pid };
  };
  // a new file: undo deletes it
  const a = await stage('Create notes/new.txt', 'notes/new.txt', 'hello');
  assert.equal((await post(`/api/tasks/${a.t.id}/approve`, { proposal_id: a.pid })).status, 200);
  assert.equal(fs.readFileSync(path.join(s.workspace, 'notes/new.txt'), 'utf8'), 'hello');
  assert.equal((await post(`/api/tasks/${a.t.id}/undo`, {})).status, 200);
  assert.equal(fs.existsSync(path.join(s.workspace, 'notes/new.txt')), false);

  // an existing file: undo restores the old content, but refuses if it was edited after applying
  fs.writeFileSync(path.join(s.workspace, 'keep.txt'), 'v1');
  const b = await stage('Update keep.txt', 'keep.txt', 'v2');
  await post(`/api/tasks/${b.t.id}/approve`, { proposal_id: b.pid });
  fs.writeFileSync(path.join(s.workspace, 'keep.txt'), 'v2 plus my edit');
  assert.equal((await post(`/api/tasks/${b.t.id}/undo`, {})).status, 400);
  fs.writeFileSync(path.join(s.workspace, 'keep.txt'), 'v2');
  assert.equal((await post(`/api/tasks/${b.t.id}/undo`, {})).status, 200);
  assert.equal(fs.readFileSync(path.join(s.workspace, 'keep.txt'), 'utf8'), 'v1');

  const c = await (await post('/api/tasks', { goal: 'x' })).json();
  assert.equal((await post(`/api/tasks/${c.id}/status`, { status: 'running' })).status, 200);
  assert.equal((await post(`/api/tasks/${c.id}/status`, { status: 'hacked' })).status, 400);
  const tasks = await (await fetch(BASE + '/api/tasks')).json();
  assert.equal(tasks[a.t.id].status, 'undone');
  assert.equal(tasks[c.id].status, 'running');
});

test('an unreachable model server gives a clear, actionable error', async () => {
  const s = await (await fetch(BASE + '/api/settings')).json();
  const net = require('node:net');
  const free = await new Promise(r => { const sv = net.createServer().listen(0, () => { const p = sv.address().port; sv.close(() => r(p)); }); });
  await post('/api/settings', { provider: 'local', baseUrl: `http://127.0.0.1:${free}/v1` });
  const t = await (await post('/api/tasks', { goal: 'Create a.js' })).json();
  const r = await post(`/api/tasks/${t.id}/plan`, { task: t.goal });
  assert.ok(r.status >= 400);
  assert.match((await r.json()).error, /Can't reach the model server/);
  await post('/api/settings', { baseUrl: s.baseUrl });
});

test('watcher alerts are POSTed to a webhook', async () => {
  const http = require('node:http');
  let got;
  const hook = http.createServer((q, r) => { let b = ''; q.on('data', d => b += d); q.on('end', () => { got = JSON.parse(b); r.end('ok'); }); }).listen(0);
  const dev = http.createServer((q, r) => r.end(JSON.stringify({ temp: 99 }))).listen(0);
  await new Promise(r => setTimeout(r, 100));
  try {
    const w = await (await post('/api/watchers', { name: 'Hot', kind: 'http', url: `http://127.0.0.1:${dev.address().port}/`, fields: 'temp', rule: { op: '>', path: 'temp', value: 80 }, webhook: `http://127.0.0.1:${hook.address().port}/off` })).json();
    for (let i = 0; i < 30 && !got; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(got.watcher, 'Hot');
    assert.match(got.message, /temp is 99/);
    await post('/api/watchers/delete', { id: w.id });
  } finally { hook.close(); dev.close(); }
});

test('applied changes are committed when the workspace is a git repo and the option is on', async () => {
  const { execFileSync } = require('node:child_process');
  const s = await (await fetch(BASE + '/api/settings')).json();
  try { execFileSync('git', ['--version']); } catch { return; } // no git on this machine
  execFileSync('git', ['init', '-q', s.workspace]);
  await post('/api/settings', { gitCommit: true });
  const t = await (await post('/api/tasks', { goal: 'Create hello.md' })).json();
  const pid = `${t.id}_1`;
  fs.writeFileSync(path.join(home, 'data', 'proposals', `proposal_${pid}.json`), JSON.stringify({ proposal_id: pid, file_path: 'hello.md', content: '# hi' }));
  const r = await (await post(`/api/tasks/${t.id}/approve`, { proposal_id: pid })).json();
  assert.ok(r.committed, 'expected a commit hash');
  assert.match(execFileSync('git', ['-C', s.workspace, 'log', '-1', '--format=%s']).toString(), /Freeze Foundry: Create hello\.md/);
  await post('/api/settings', { gitCommit: false });
});

test('DNS rebinding is blocked and responses carry hardening headers', async () => {
  const http = require('node:http');
  const get = host => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: PORT, path: '/api/settings', headers: { Host: host } }, r => { r.resume(); resolve(r); }).on('error', reject));
  assert.equal((await get('evil.example:' + PORT)).statusCode, 403);
  const ok = await get('localhost:' + PORT);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['x-frame-options'], 'DENY');
  assert.equal(ok.headers['x-content-type-options'], 'nosniff');
  for (const p of ['/public/../server.js', '/%2e%2e/server.js', '/..%2fserver.js']) assert.doesNotMatch(await (await fetch(BASE + p)).text(), /createServer/, p);
});
