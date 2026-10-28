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
  server.stderr.on('data', d => { if (process.env.FF_TEST_LOG) process.stderr.write(d); });
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

test('LAN machines are saved and listed', async () => {
  const http = require('node:http');
  const mock = http.createServer((q, r) => r.end(JSON.stringify({ data: [{ id: 'remote-coder' }] }))).listen(0);
  await new Promise(r => setTimeout(r, 100));
  const url = `http://127.0.0.1:${mock.address().port}`;
  try {
    await post('/api/settings', { machines: [{ name: 'Other PC', baseUrl: url }, { name: 'bad', baseUrl: 'ftp://x' }] });
    assert.deepEqual((await (await fetch(BASE + '/api/settings')).json()).machines, [{ name: 'Other PC', baseUrl: url + '/v1' }]);
    assert.deepEqual((await (await fetch(BASE + '/api/machines/models?url=' + encodeURIComponent(url))).json()).models, ['remote-coder']);
    assert.equal((await fetch(BASE + '/api/machines/models?url=nope')).status, 400);
  } finally { mock.close(); await post('/api/settings', { machines: [] }); }
});

test('saves are atomic and the server keeps a log', async () => {
  await post('/api/settings', { attempts: 4 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'data', 'settings.json'), 'utf8')).attempts, 4);
  assert.deepEqual(fs.readdirSync(path.join(home, 'data')).filter(f => f.endsWith('.tmp')), []);
  assert.match(fs.readFileSync(path.join(home, 'data', 'logs', 'server.log'), 'utf8'), /server running at/);
  await post('/api/settings', { attempts: 3 });
});

test('the foreman runs a project: parallel lines, re-plan on failure, final inspection, apply and undo', async () => {
  const http = require('node:http');
  const calls = [];
  let active = 0, peak = 0, inspections = 0, plans = 0;
  const reply = (r, text) => r.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: {} }));
  const mockFor = name => http.createServer((q, r) => {
    let b = ''; q.on('data', d => b += d); q.on('end', async () => {
      const body = JSON.parse(b), msgs = body.messages, sys = msgs[0].content, user = msgs[msgs.length - 1].content;
      if (/foreman/.test(sys)) {
        plans++;
        return reply(r, /RE-PLAN/.test(user)
          ? JSON.stringify({ project: 'csv2json', orders: [{ file: 'main.js', goal: 'Create main.js that prints toJson(parseCsv(text))', needs: ['src/parse.js', 'src/format.js'] }] })
          : JSON.stringify({ project: 'csv2json', orders: [
            { file: 'src/parse.js', goal: 'Create src/parse.js that exports parseCsv(text)', needs: [] },
            { file: 'src/format.js', goal: 'Create src/format.js that exports toJson(rows)', needs: [] },
            { file: 'cli.js', goal: 'Create cli.js that uses both', needs: ['src/parse.js', 'src/format.js', 'nope.js'] }] }));
      }
      if (/final inspector/.test(sys)) return reply(r, ++inspections === 1 ? '{"verdict": "revise", "issues": [{"file": "src/format.js", "problem": "toJson must indent with 2 spaces"}]}' : '{"verdict": "approve", "issues": []}');
      if (/code reviewer/.test(sys)) return reply(r, '{"verdict": "approve", "issues": []}');
      const goal = user.match(/^Goal: (.*)/)[1];
      calls.push({ name, model: body.model, goal, user });
      active++; peak = Math.max(peak, active);
      await new Promise(res => setTimeout(res, 300));
      active--;
      const file = goal.match(/[\w/]+\.js/)[0];
      const content = file === 'cli.js' ? 'console.log(' : file === 'main.js' ? "require('./src/parse');\nrequire('./src/format');\n" : 'module.exports = {};\n';
      reply(r, JSON.stringify({ file_path: file, content }));
    });
  }).listen(0);
  const main = mockFor('main'), mac = mockFor('mac');
  await new Promise(r => setTimeout(r, 100));
  const url = s => `http://127.0.0.1:${s.address().port}/v1`;
  const before = await (await fetch(BASE + '/api/settings')).json();
  const ws = path.join(home, 'workspace');
  const waitFor = async (id, statuses) => {
    for (let i = 0; i < 200; i++) {
      const p = (await (await fetch(BASE + '/api/projects')).json()).find(x => x.id === id);
      if (statuses.includes(p.status) && !p.running) return p;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('project never finished');
  };
  try {
    await post('/api/settings', { provider: 'local', baseUrl: url(main), model: 'm', attempts: 1, autoApply: false, machines: [{ name: 'Mac', baseUrl: url(mac) }] });
    assert.equal((await post('/api/foreman', { goal: '' })).status, 400);
    const plan = await (await post('/api/foreman', { goal: 'A CLI that turns CSV into JSON' })).json();
    assert.deepEqual(plan.orders.map(o => o.needs), [[], [], ['src/parse.js', 'src/format.js']]); // unknown needs dropped

    const created = await post('/api/projects', { name: plan.project, goal: 'A CLI that turns CSV into JSON', orders: plan.orders, lines: [{ baseUrl: url(mac), model: 'm2' }, { baseUrl: 'http://evil.example/v1' }] });
    assert.equal(created.status, 201);
    const { id, lines } = await created.json();
    assert.deepEqual(lines.map(l => l.name), ['Main line', 'Mac']); // unsaved machines are ignored
    const p = await waitFor(id, ['staged']);

    assert.equal(peak, 2, 'independent files build at the same time');
    assert.ok(calls.some(c => c.name === 'mac' && c.model === 'm2'), 'the Mac line uses its own server and model');
    const cli = calls.find(c => c.goal.includes('cli.js'));
    assert.match(cli.user, /--- src\/parse\.js/, 'a builder sees the files it needs');
    assert.equal(plans, 2, 'the failed cli.js made the foreman re-plan');
    assert.deepEqual(p.orders.map(o => [o.file, o.status]), [['src/parse.js', 'done'], ['src/format.js', 'done'], ['main.js', 'done']]);
    assert.match(calls.filter(c => c.goal.includes('format.js')).pop().user, /indent with 2 spaces/, 'the inspector sent format.js back');
    assert.ok(p.inspection.passed);
    assert.ok(p.inspection.checks.some(c => c.command === 'links in main.js' && c.exitCode === 0));
    assert.ok(!fs.existsSync(path.join(ws, 'main.js')), 'nothing is written before you apply');

    assert.equal((await post(`/api/projects/${id}/apply`, {})).status, 200);
    assert.equal(fs.readFileSync(path.join(ws, 'src', 'parse.js'), 'utf8'), 'module.exports = {};\n');
    assert.equal((await post(`/api/projects/${id}/undo`, {})).status, 200);
    assert.ok(!fs.existsSync(path.join(ws, 'main.js')));
    assert.equal((await post(`/api/projects/${id}/remove`, {})).status, 200);
    assert.equal((await fetch(`${BASE}/api/projects/${id}`)).status, 404);
  } finally {
    main.close(); mac.close();
    await post('/api/settings', { baseUrl: before.baseUrl, model: before.model, attempts: before.attempts, autoApply: before.autoApply, machines: [] });
  }
});

test('a project set to pause waits for you when an order fails', async () => {
  const http = require('node:http');
  const mock = http.createServer((q, r) => {
    let b = ''; q.on('data', d => b += d); q.on('end', () => {
      const sys = JSON.parse(b).messages[0].content;
      const text = /code reviewer/.test(sys) ? '{"verdict": "revise", "issues": ["wrong"]}' : /final inspector/.test(sys) ? '{"verdict": "approve"}' : '{"file_path": "a.txt", "content": "a"}';
      r.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: {} }));
    });
  }).listen(0);
  await new Promise(r => setTimeout(r, 100));
  const before = await (await fetch(BASE + '/api/settings')).json();
  const state = async id => (await (await fetch(BASE + '/api/projects')).json()).find(x => x.id === id);
  try {
    await post('/api/settings', { provider: 'local', baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, model: 'm', attempts: 1, autoApply: false });
    const { id } = await (await post('/api/projects', { name: 't', onFail: 'pause', orders: [{ file: 'a.txt', goal: 'Create a.txt' }, { file: 'b.txt', goal: 'Create b.txt', needs: ['a.txt'] }] })).json();
    let p;
    for (let i = 0; i < 50 && (!p || p.running); i++) { await new Promise(r => setTimeout(r, 100)); p = await state(id); }
    assert.equal(p.status, 'paused');
    assert.deepEqual(p.orders.map(o => o.status), ['failed', 'waiting'], 'b.txt needs a.txt, so it never started');
    assert.equal((await post(`/api/projects/${id}/skip`, {})).status, 200);
    for (let i = 0; i < 50 && (p.status !== 'staged' || p.running); i++) { await new Promise(r => setTimeout(r, 100)); p = await state(id); }
    assert.equal(p.status, 'paused', 'b.txt fails too and pauses again');
    assert.equal((await post(`/api/projects/${id}/stop`, {})).status, 200);
    assert.equal((await state(id)).status, 'stopped');
  } finally {
    mock.close();
    await post('/api/settings', { baseUrl: before.baseUrl, model: before.model, attempts: before.attempts, autoApply: before.autoApply });
  }
});
