const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

// Configuration
const PORT = Number(process.env.FF_PORT) || 4177;
const HOST = '127.0.0.1';
const MODEL_NAME = 'qwen/qwen3.5-9b';
// Installed app: data lives in FF_HOME (set by the desktop shell); dev: next to this file.
const ROOT_DIR = process.env.FF_HOME || __dirname;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const WORKSPACE_DIR = (() => {
  try { const w = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf8')).workspace; if (w) return path.resolve(w); } catch {}
  return path.join(ROOT_DIR, 'workspace');
})();
const PROPOSALS_DIR = path.join(DATA_DIR, 'proposals');

// Ensure directories exist
function ensureDirectories() {
  const dirs = [DATA_DIR, WORKSPACE_DIR, PROPOSALS_DIR];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

ensureDirectories();

// Load persisted tasks from JSON file
function loadTasks() {
  const tasksFile = path.join(DATA_DIR, 'tasks.json');
  if (fs.existsSync(tasksFile)) {
    try {
      return JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
    } catch (err) {
      console.error('Error loading tasks:', err.message);
      return {};
    }
  }
  return {};
}

// Save tasks to JSON file
function saveTasks(tasks) {
  writeJsonAtomic(path.join(DATA_DIR, 'tasks.json'), tasks);
}

// Write to a temp file and rename it over the original, so a crash or power cut mid-write never leaves half a file.
function writeJsonAtomic(file, value, opts = {}) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', ...opts });
  fs.renameSync(tmp, file);
}

// Mirror server output to data/logs/server.log (rotated at 2 MB) so problems can be diagnosed after the fact.
(() => {
  const dir = path.join(DATA_DIR, 'logs');
  const file = path.join(dir, 'server.log');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const write = (level, args) => {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, file + '.1');
      const text = args.map(a => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${text}\n`);
    } catch {}
  };
  for (const [name, level] of [['log', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR']]) {
    const orig = console[name].bind(console);
    console[name] = (...args) => { orig(...args); write(level, args); };
  }
})();

// Check if a file is a symlink
function isSymlink(filePath) {
  try {
    const stats = fs.lstatSync(filePath);
    return stats.isSymbolicLink();
  } catch (err) {
    return false;
  }
}

// Get relative path from workspace root
function getRelativePath(absPath, workspaceRoot) {
  try {
    return path.relative(workspaceRoot, absPath);
  } catch (err) {
    throw new Error('Cannot resolve relative path');
  }
}

// Check if a file exists and is not a symlink
function safeFileExists(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return !stats.isSymbolicLink() && stats.isFile();
  } catch (err) {
    return false;
  }
}

// Backup a file before replacing it
function backupFile(sourcePath, backupPath) {
  if (!fs.existsSync(sourcePath)) {
    return;
  }
  const dir = path.dirname(backupPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.copyFileSync(sourcePath, backupPath);
}

// fetch for model servers: a time limit, up to two retries on rate limits, server errors and dropped connections,
// and errors that say what to do instead of "fetch failed".
async function modelFetch(st, url, opts) {
  const limit = (st.requestTimeoutSec || 600) * 1000;
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(url, { ...opts, signal: AbortSignal.timeout(limit) });
    } catch (e) {
      const code = e.cause && e.cause.code;
      if (e.name === 'TimeoutError') throw new Error(`The model took longer than ${limit / 1000}s to answer. Raise "Model time limit" in Settings, lower Max tokens, or use a smaller model.`);
      const unreachable = () => new Error(st.provider === 'local' || st.provider === 'custom'
        ? `Can't reach the model server at ${String(url).replace(/\/(chat\/completions|messages)$/, '')}. Start it (LM Studio: Developer tab > Start server; Ollama: run "ollama serve"), or check the address on the Models page.`
        : `Can't reach ${PROVIDERS[st.provider].label} (${code || e.message}). Check your internet connection.`);
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') throw unreachable(); // nothing listening: retrying won't help
      if (attempt >= 2) throw unreachable();
      await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));
      continue;
    }
    if ((r.status === 429 || r.status >= 500) && attempt < 2) {
      const wait = Math.min(20, Number(r.headers.get('retry-after')) || 2 * (attempt + 1));
      console.warn(`Model server returned ${r.status}; retrying in ${wait}s`);
      await new Promise(res => setTimeout(res, wait * 1000));
      continue;
    }
    return r;
  }
}

// Call the configured OpenAI-compatible model server (LM Studio or Ollama) and record usage in the ledger.
async function callLMStudio(messages, role = 'default', taskId = null) {
  const st = { ...loadSettings() };
  // Per-worker tuning: each worker can override provider, model, temperature, token limit, top-p and add instructions.
  const rc = (st.roleConfig || {})[role] || {};
  // LAN Foundry: a worker can run on another machine's LM Studio or Ollama server.
  if (rc.baseUrl) { st.provider = 'local'; st.baseUrl = rc.baseUrl; }
  if (!rc.baseUrl && rc.provider && rc.provider !== st.provider) {
    if (!rc.model) throw new Error(`The ${role} uses ${PROVIDERS[rc.provider].label}; type its model name in Models > Worker tuning.`);
    st.provider = rc.provider;
  }
  const model = rc.model || (rc.provider || rc.baseUrl ? '' : (st.roleModels && st.roleModels[role])) || st.model;
  if (!model) throw new Error(`No model chosen for the ${role}. Pick one on the Models page.`);
  if (rc.temperature != null) st.temperature = rc.temperature;
  if (rc.maxTokens) st.maxTokens = rc.maxTokens;
  if (rc.instructions) {
    const i = messages.findIndex(m => m.role === 'system');
    messages = [...messages];
    messages.splice(i + 1, 0, { role: 'system', content: `Extra instructions from the user for the ${role}:\n${rc.instructions}` });
  }
  const started = Date.now();
  try {
    const key = st.provider === 'local' ? (process.env.LM_STUDIO_API_KEY || '') : getKey(st.provider);
    if (!key && st.provider !== 'local' && st.provider !== 'custom') throw new Error(`Add your ${PROVIDERS[st.provider].label} API key on the Models page first.`);
    let text, usage;
    if (st.provider === 'anthropic') {
      const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
      const r = await modelFetch(st, PROVIDERS.anthropic.base + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, system, max_tokens: st.maxTokens, temperature: Math.min(st.temperature, 1), messages: messages.filter(m => m.role !== 'system') })
      });
      if (!r.ok) throw new Error(`Claude API error ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const d = await r.json();
      text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      usage = { prompt_tokens: (d.usage || {}).input_tokens || 0, completion_tokens: (d.usage || {}).output_tokens || 0 };
    } else {
      // OpenAI's newer models only take max_completion_tokens and their default temperature.
      const body = st.provider === 'openai' ? { model, messages, max_completion_tokens: st.maxTokens } : { model, messages, temperature: st.temperature, max_tokens: st.maxTokens, ...(rc.topP != null ? { top_p: rc.topP } : {}) };
      const r = await modelFetch(st, providerBase(st) + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify(body)
      });
      if (!r.ok) throw new Error(`Model error ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const d = await r.json();
      text = d.choices[0].message.content || '';
      usage = d.usage || {};
    }
    logUsage({ ts: new Date().toISOString(), task: taskId, role, provider: rc.baseUrl ? 'lan' : st.provider, model, prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, ms: Date.now() - started });
    return text;
  } catch (err) {
    console.error('Model call failed:', err.message);
    throw err;
  }
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, 'http://localhost');
  parsedUrl.query = Object.fromEntries(parsedUrl.searchParams);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Set default headers
  res.setHeader('Content-Type', 'application/json');
  // Hardening: never framed by another site, no MIME sniffing, no referrer leaks.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  // DNS rebinding guard: a hostile website can point its own domain at 127.0.0.1, but it can't fake the Host header.
  if (!isLocalHost(req.headers.host)) {
    res.writeHead(403);
    return res.end(JSON.stringify({ error: 'Freeze Foundry only answers on 127.0.0.1 or localhost' }));
  }
  // Only this app may change things: blocks other websites in your browser from driving the factory.
  const origin = req.headers.origin;
  if (method !== 'GET' && method !== 'HEAD' && origin && origin !== `http://127.0.0.1:${PORT}` && origin !== `http://localhost:${PORT}`) {
    res.writeHead(403);
    return res.end(JSON.stringify({ error: 'Cross-site request blocked' }));
  }

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API Routes
  if (pathname === '/api/tasks') {
    if (method !== 'GET' && method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        if (method === 'POST') {
          const limit = 1024 * 1024; // 1MB limit
          if (Buffer.byteLength(body) > limit) {
            res.writeHead(413);
            res.end(JSON.stringify({ error: 'Request body too large' }));
            return;
          }

          const data = JSON.parse(body || '{}');
          const tasks = loadTasks();
          const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          const task = {
            id: taskId,
            goal: data.goal || '',
            project: cleanProject(data.project),
            status: 'pending',
            createdAt: new Date().toISOString(),
            plan: null,
            proposals: []
          };

          tasks[taskId] = task;
          saveTasks(tasks);

          res.writeHead(201);
          res.end(JSON.stringify(task));
        } else {
          const tasks = loadTasks();
          res.writeHead(200);
          res.end(JSON.stringify(tasks));
        }
      } catch (err) {
        console.error('Error processing task:', err.message);
        res.writeHead(400);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Outcome of a task as the UI saw it (running, answered, staged, failed, cancelled); drives queue recovery after a restart.
  if (pathname.startsWith('/api/tasks/') && pathname.endsWith('/status') && method === 'POST') {
    try {
      const b = await readJsonBody(req);
      const tasks = loadTasks(), task = tasks[pathname.split('/')[3]];
      if (!task) throw new Error('Task not found');
      if (!['running', 'answered', 'staged', 'failed', 'cancelled', 'done'].includes(b.status)) throw new Error('Unknown status');
      task.status = b.status;
      if (typeof b.outcome === 'string') task.outcome = b.outcome.slice(0, 500);
      task.updatedAt = new Date().toISOString();
      saveTasks(tasks);
      res.writeHead(200); return res.end(JSON.stringify({ ok: true }));
    } catch (e) { res.writeHead(400); return res.end(JSON.stringify({ error: e.message })); }
  }

  // Put the workspace back the way it was before a change was applied (only if nobody edited the file since).
  if (pathname.startsWith('/api/tasks/') && pathname.endsWith('/undo') && method === 'POST') {
    try {
      const tasks = loadTasks(), task = tasks[pathname.split('/')[3]];
      const a = task && task.applied;
      if (!a) throw new Error('This task has no applied change to undo.');
      const target = path.resolve(WORKSPACE_DIR, a.path);
      if (!target.startsWith(WORKSPACE_DIR + path.sep)) throw new Error('Invalid file path');
      const current = fs.existsSync(target) ? fs.readFileSync(target) : null;
      if (!current || sha1(current) !== a.hash) throw new Error(`${a.path} has changed since it was applied, so undo would lose those edits. Restore it from ${a.backup ? 'data/backups' : 'your own copy'} by hand.`);
      if (a.backup) fs.copyFileSync(a.backup, target); else fs.unlinkSync(target);
      task.status = 'undone'; task.updatedAt = new Date().toISOString(); delete task.applied;
      saveTasks(tasks);
      res.writeHead(200); return res.end(JSON.stringify({ ok: true, path: a.path, restored: !!a.backup }));
    } catch (e) { res.writeHead(400); return res.end(JSON.stringify({ error: e.message })); }
  }

  // FOREMAN: break a big goal into ordered one-file work orders that fit together
  if (pathname === '/api/foreman' && method === 'POST') {
    try {
      const b = await readJsonBody(req);
      const goal = String(b.goal || '').trim();
      if (!goal || goal.length > 4000) throw new Error('Describe the project on the work order first.');
      const raw = await callLMStudio(withSkills([
        { role: 'system', content: 'You are the foreman of a software factory. Workers build exactly ONE file per work order. Break the project into the smallest set of work orders (at most 8) in build order: shared modules first, then the files that use them, then tests, then docs. Each work order must name its file path and say what it does and which other project files it uses, e.g. "Create src/parse.js that exports parseCsv(text)". Reuse existing files from the file list instead of recreating them. Output ONLY JSON: {"project": "<short name>", "orders": ["<work order>", ...]}' },
        { role: 'user', content: `Project: ${goal}\n\n${workspaceContext(goal)}` + (await extraContext(goal)) }
      ], skillsFor('planner', goal)), 'planner');
      const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
      let plan;
      try { plan = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { throw new Error('The foreman did not return a plan. Try again, or use a stronger model for the Planner.'); }
      const orders = (Array.isArray(plan.orders) ? plan.orders : []).map(o => String(typeof o === 'string' ? o : (o && o.goal) || '').trim().slice(0, 1000)).filter(Boolean).slice(0, 8);
      if (!orders.length) throw new Error('The foreman returned no work orders. Make the project description more specific.');
      res.writeHead(200); return res.end(JSON.stringify({ project: String(plan.project || goal).slice(0, 80), orders }));
    } catch (e) { res.writeHead(400); return res.end(JSON.stringify({ error: e.message })); }
  }

  if (pathname.startsWith('/api/tasks/') && pathname.endsWith('/plan')) {
    const taskId = pathname.split('/')[3];
    if (method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const limit = 1024 * 1024; // 1MB limit
        if (Buffer.byteLength(body) > limit) {
          res.writeHead(413);
          res.end(JSON.stringify({ error: 'Request body too large' }));
          return;
        }

        const data = JSON.parse(body || '{}');
        const used = skillsFor('planner', data.task);
        const messages = withSkills([
          { role: 'system', content: 'You are the planner in a software factory. If the request asks to create or change files, reply with a concise implementation plan. If it does not (a greeting, a question, small talk), reply with exactly NO_BUILD: followed by a short, friendly answer, and nothing else.' },
          { role: 'user', content: `Task: ${data.task || ''}` + (await extraContext(data.task)) }
        ], used);

        const response = await callLMStudio(messages, 'planner', taskId);
        const plan = response.trim();

        const tasks = loadTasks();
        if (!tasks[taskId]) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Task not found' }));
          return;
        }

        tasks[taskId].plan = plan;
        saveTasks(tasks);

        res.writeHead(200);
        res.end(JSON.stringify({ task: taskId, plan, skills: used.map(k => k.name) }));
      } catch (err) {
        console.error('Error processing plan:', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname.startsWith('/api/tasks/') && pathname.endsWith('/propose')) {
    const taskId = pathname.split('/')[3];
    if (method !== 'POST') { res.writeHead(405); return res.end(JSON.stringify({ error: 'Method not allowed' })); }

    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
        try {
            const tasks = loadTasks();
            const task = tasks[taskId];
            if (!task) { res.writeHead(404); return res.end(JSON.stringify({ error: 'Task not found' })); }
            let feedback = '', previousId = null;
            try {
                const b = JSON.parse(body || '{}');
                feedback = String(b.feedback || '').slice(0, 6000);
                previousId = b.previous_proposal_id;
            } catch {}

            let previous = '';
            const prev = feedback && getProposal(taskId, previousId);
            if (prev) previous = `\n\nYour previous draft (${prev.data.file_path}):\n${String(prev.data.content || '').slice(0, 12000)}`;
            const messages = await builderMessages(task, feedback, previous);
            const parsed = parseBuilderOutput(await callLMStudio(messages, 'builder', taskId));

            const proposalId = taskId + '_' + Date.now();
            const proposalsDir = typeof PROPOSALS_DIR !== 'undefined' ? PROPOSALS_DIR : path.join(DATA_DIR, 'proposals');
            if (!fs.existsSync(proposalsDir)) fs.mkdirSync(proposalsDir, { recursive: true });
            
            const proposalFile = path.join(proposalsDir, 'proposal_' + proposalId + '.json');
            
            parsed.proposal_id = proposalId;
            fs.writeFileSync(proposalFile, JSON.stringify(parsed, null, 2));
            if (prev) try { fs.unlinkSync(prev.file); } catch {} // a retry replaces its earlier draft

            res.writeHead(200);
            res.end(JSON.stringify(parsed));
        } catch(e) {
            console.error("Propose error:", e);
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
        }
    });
    return;
}

if (pathname.startsWith('/api/tasks/') && pathname.endsWith('/approve')) {
    const taskId = pathname.split('/')[3];
    if (method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const limit = 1024 * 1024; // 1MB limit
        if (Buffer.byteLength(body) > limit) {
          res.writeHead(413);
          res.end(JSON.stringify({ error: 'Request body too large' }));
          return;
        }

        const data = JSON.parse(body || '{}');
        const proposalId = data.proposal_id;
        const tasks = loadTasks();
        const task = tasks[taskId];

        if (!task) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Task not found' }));
          return;
        }

        // Verify proposal belongs to this task by checking proposal_id prefix
        if (!proposalId.startsWith(`${taskId}_`)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Proposal does not belong to this task' }));
          return;
        }

        // Find proposal file
        const found = getProposal(taskId, proposalId);
        const proposalFile = found ? found.file : null;

        if (!proposalFile) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Proposal not found' }));
          return;
        }

        // Verify proposal_id matches exactly
        const expectedFileName = `proposal_${proposalId}.json`;
        if (path.basename(proposalFile) !== expectedFileName) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Proposal ID mismatch' }));
          return;
        }

        const proposal = JSON.parse(fs.readFileSync(proposalFile, 'utf8'));
        const targetPath = path.join(WORKSPACE_DIR, proposal.file_path);
        const relativePath = getRelativePath(targetPath, WORKSPACE_DIR);

        // Validate path is within workspace and not absolute or traversal
        if (relativePath.startsWith('..') || relativePath.includes('..')) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid file path' }));
          return;
        }

        // Check for symlinks in target path components
        let current = WORKSPACE_DIR;
        const parts = relativePath.split(path.sep);
        for (const part of parts) {
          current = path.join(current, part);
          if (isSymlink(current)) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Symlink detected in file path' }));
            return;
          }
        }

        // Backup existing file if it exists to unique backup location outside target's parent-name construction
        const backupDir = path.join(DATA_DIR, 'backups');
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }
        
        const backupPath = path.join(backupDir, `backup_${taskId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.json`);
        const existed = fs.existsSync(targetPath);
        backupFile(targetPath, backupPath);

        // Write new content
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(targetPath, proposal.content, 'utf8');

        // Remove proposal file
        fs.unlinkSync(proposalFile);

        task.status = 'applied';
        task.updatedAt = new Date().toISOString();
        task.applied = { path: relativePath, backup: existed ? backupPath : null, hash: sha1(Buffer.from(proposal.content, 'utf8')), at: task.updatedAt };
        saveTasks(tasks);
        const committed = loadSettings().gitCommit ? gitCommit(relativePath, task.goal) : null;

        res.writeHead(200);
        res.end(JSON.stringify({ task: taskId, status: 'approved', path: relativePath, committed }));
      } catch (err) {
        console.error('Error approving task:', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname.startsWith('/api/tasks/') && pathname.endsWith('/reject')) {
    const taskId = pathname.split('/')[3];
    if (method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const limit = 1024 * 1024; // 1MB limit
        if (Buffer.byteLength(body) > limit) {
          res.writeHead(413);
          res.end(JSON.stringify({ error: 'Request body too large' }));
          return;
        }

        const data = JSON.parse(body || '{}');
        const proposalId = data.proposal_id;
        const tasks = loadTasks();
        const task = tasks[taskId];

        if (!task) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Task not found' }));
          return;
        }

        // Verify proposal belongs to this task by checking proposal_id prefix
        if (!proposalId.startsWith(`${taskId}_`)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Proposal does not belong to this task' }));
          return;
        }

        // Find proposal file
        const found = getProposal(taskId, proposalId);
        const proposalFile = found ? found.file : null;

        if (!proposalFile) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Proposal not found' }));
          return;
        }

        // Verify proposal_id matches exactly
        const expectedFileName = `proposal_${proposalId}.json`;
        if (path.basename(proposalFile) !== expectedFileName) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Proposal ID mismatch' }));
          return;
        }

        // Remove proposal file only - never modify workspace files
        fs.unlinkSync(proposalFile);

        res.writeHead(200);
        try { const all = loadTasks(); if (all[taskId]) { all[taskId].status = 'rejected'; all[taskId].updatedAt = new Date().toISOString(); saveTasks(all); } } catch {}
        res.end(JSON.stringify({ task: taskId, status: 'rejected' }));
      } catch (err) {
        console.error('Error rejecting task:', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }


  // SETTINGS, MODELS, LEDGER
  if (pathname === '/api/settings') {
    if (method === 'POST') {
      try {
        const b = await readJsonBody(req);
        const st = loadSettings();
        if (typeof b.baseUrl === 'string' && /^https?:\/\/\S+$/.test(b.baseUrl.trim())) st.baseUrl = b.baseUrl.trim();
        if (typeof b.model === 'string' && b.model.trim()) st.model = b.model.trim();
        if (PROVIDERS[b.provider]) st.provider = b.provider;
        if (typeof b.workspace === 'string' && b.workspace.trim()) st.workspace = path.resolve(b.workspace.trim());
        if (typeof b.modelsDir === 'string' && b.modelsDir.trim()) st.modelsDir = path.resolve(b.modelsDir.trim());
        if (typeof b.autoApply === 'boolean') st.autoApply = b.autoApply;
        if (typeof b.setupDone === 'boolean') st.setupDone = b.setupDone;
        if (Number.isInteger(b.attempts) && b.attempts >= 1 && b.attempts <= 10) st.attempts = b.attempts;
        if (Number.isInteger(b.requestTimeoutSec) && b.requestTimeoutSec >= 30 && b.requestTimeoutSec <= 3600) st.requestTimeoutSec = b.requestTimeoutSec;
        if (typeof b.gitCommit === 'boolean') st.gitCommit = b.gitCommit;
        if (Array.isArray(b.machines)) st.machines = b.machines.slice(0, 20).map(m => ({ name: String(m.name || '').trim().slice(0, 40) || 'Machine', baseUrl: cleanServerUrl(m.baseUrl) })).filter(m => m.baseUrl);
        if (typeof b.pythonPath === 'string' && b.pythonPath.length <= 300 && !/[\r\n]/.test(b.pythonPath)) st.pythonPath = b.pythonPath.trim();
        if (typeof b.temperature === 'number' && b.temperature >= 0 && b.temperature <= 2) st.temperature = b.temperature;
        if (Number.isInteger(b.maxTokens) && b.maxTokens >= 256 && b.maxTokens <= 32768) st.maxTokens = b.maxTokens;
        if (b.permissions && typeof b.permissions === 'object') {
          const pm = { ...st.permissions };
          for (const k of ['readFiles', 'runTests', 'sources', 'internet', 'runScripts']) if (typeof b.permissions[k] === 'boolean') pm[k] = b.permissions[k];
          st.permissions = pm;
        }
        if (b.ui && typeof b.ui === 'object') {
          const u = b.ui, ui = { ...st.ui };
          if (/^#[0-9a-f]{6}$/i.test(u.accent)) ui.accent = u.accent;
          for (const k of ['sounds', 'notifications', 'reduceMotion']) if (typeof u[k] === 'boolean') ui[k] = u[k];
          if (typeof u.scale === 'number' && u.scale >= 0.8 && u.scale <= 1.5) ui.scale = u.scale;
          if (['relaxed', 'normal', 'fast', 'off'].includes(u.pace)) ui.pace = u.pace;
          if (['system', 'light', 'dark'].includes(u.theme)) ui.theme = u.theme;
          if (typeof u.seenVersion === 'string' && u.seenVersion.length < 20) ui.seenVersion = u.seenVersion;
          st.ui = ui;
        }
        if (b.roleConfig && typeof b.roleConfig === 'object') {
          const num = (v, lo, hi) => (typeof v === 'number' && v >= lo && v <= hi ? v : undefined);
          st.roleConfig = {};
          for (const r of ['planner', 'builder', 'reviewer']) {
            const c = b.roleConfig[r] || {};
            const clean = {
              provider: PROVIDERS[c.provider] ? c.provider : undefined,
              model: typeof c.model === 'string' && c.model.trim() ? c.model.trim().slice(0, 200) : undefined,
              temperature: num(c.temperature, 0, 2),
              topP: num(c.topP, 0, 1),
              maxTokens: Number.isInteger(c.maxTokens) ? num(c.maxTokens, 256, 200000) : undefined,
              instructions: typeof c.instructions === 'string' && c.instructions.trim() ? c.instructions.trim().slice(0, 4000) : undefined,
              baseUrl: cleanServerUrl(c.baseUrl) || undefined
            };
            st.roleConfig[r] = JSON.parse(JSON.stringify(clean)); // drops undefined
          }
        }
        if (b.roleModels && typeof b.roleModels === 'object')
          st.roleModels = Object.fromEntries(Object.entries(b.roleModels).filter(([k, v]) => ['planner', 'builder', 'reviewer'].includes(k) && typeof v === 'string' && v));
        writeJsonAtomic(SETTINGS_FILE, st);
        res.writeHead(200); return res.end(JSON.stringify(publicSettings(st)));
      } catch (err) { res.writeHead(400); return res.end(JSON.stringify({ error: err.message })); }
    }
    res.writeHead(200); return res.end(JSON.stringify(publicSettings(loadSettings())));
  }

  if (pathname === '/api/models') {
    const st = loadSettings();
    const base = providerBase(st);
    try {
      let models = null;
      if (st.provider === 'local') {
        // LM Studio's native API also reports which models are loaded; Ollama falls through to /v1/models.
        try {
          const r = await fetch(base.replace(/\/v1$/, '') + '/api/v0/models');
          if (r.ok) models = ((await r.json()).data || []).filter(m => m.type !== 'embeddings').map(m => ({ id: m.id, state: m.state || null }));
        } catch {}
      }
      if (!models) {
        const key = st.provider === 'local' ? '' : getKey(st.provider);
        if (!key && st.provider !== 'local' && st.provider !== 'custom') throw new Error('add your API key first');
        const headers = st.provider === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : key ? { Authorization: `Bearer ${key}` } : {};
        const r = await fetch(base + '/models' + (st.provider === 'anthropic' ? '?limit=100' : ''), { headers });
        if (!r.ok) throw new Error(`the server returned ${r.status}`);
        const d = await r.json();
        models = (d.data || d.models || []).map(m => ({ id: String(m.id || m.name || '').replace(/^models\//, ''), state: null })).filter(m => m.id);
      }
      res.writeHead(200); res.end(JSON.stringify({ baseUrl: base, models }));
    } catch (err) {
      res.writeHead(502); res.end(JSON.stringify({ error: `Cannot list models from ${PROVIDERS[st.provider].label} (${err.message}).` }));
    }
    return;
  }

  if (pathname === '/api/keys' && method === 'POST') {
    try {
      const { provider, key } = await readJsonBody(req);
      if ((!PROVIDERS[provider] && provider !== 'apify') || provider === 'local') throw new Error('Unknown provider');
      if (typeof key !== 'string' || key.length > 500 || /\s/.test(key.trim())) throw new Error('That does not look like an API key.');
      setKey(provider, key.trim());
      res.writeHead(200); return res.end(JSON.stringify(publicSettings(loadSettings())));
    } catch (err) { res.writeHead(400); return res.end(JSON.stringify({ error: err.message })); }
  }

  if (pathname === '/api/ledger') {
    const sum = { calls: 0, prompt_tokens: 0, completion_tokens: 0, ms: 0, byRole: {} };
    for (const r of readLedger()) {
      sum.calls++; sum.prompt_tokens += r.prompt_tokens || 0; sum.completion_tokens += r.completion_tokens || 0; sum.ms += r.ms || 0;
      const b = sum.byRole[r.role] || (sum.byRole[r.role] = { calls: 0, tokens: 0, ms: 0 });
      b.calls++; b.tokens += (r.prompt_tokens || 0) + (r.completion_tokens || 0); b.ms += r.ms || 0;
    }
    res.writeHead(200); return res.end(JSON.stringify(sum));
  }

  // SETUP + MODEL DOWNLOADS
  if (pathname === '/api/detect') {
    const probe = u => fetch(u, { signal: AbortSignal.timeout(1500) }).then(r => r.ok).catch(() => false);
    const [lmstudio, ollama] = await Promise.all([probe('http://127.0.0.1:1234/v1/models'), probe('http://127.0.0.1:11434/api/tags')]);
    res.writeHead(200); return res.end(JSON.stringify({ lmstudio, ollama }));
  }

  if (pathname === '/api/downloads') {
    const dir = loadSettings().modelsDir;
    res.writeHead(200); return res.end(JSON.stringify({ modelsDir: dir, downloads, local: listGguf(dir) }));
  }

  if (pathname === '/api/download' && method === 'POST') {
    try {
      const { url: link } = await readJsonBody(req);
      const m = /^https:\/\/huggingface\.co\/([\w.-]+)\/([\w.-]+)\/(?:resolve|blob)\/([\w.-]+)\/((?:[\w.-]+\/)*[\w.-]+\.gguf)(?:\?.*)?$/i.exec(String(link || '').trim());
      if (!m) throw new Error('Paste a Hugging Face link to a .gguf file, like https://huggingface.co/owner/repo/blob/main/model-Q4_K_M.gguf');
      const [, owner, repo, rev, file] = m;
      const root = path.resolve(loadSettings().modelsDir);
      const dest = path.resolve(root, owner, repo, path.basename(file));
      if (!dest.startsWith(root + path.sep)) throw new Error('Invalid model path');
      startDownload(`https://huggingface.co/${owner}/${repo}/resolve/${rev}/${file}`, dest);
      res.writeHead(202); return res.end(JSON.stringify({ ok: true }));
    } catch (err) { res.writeHead(400); return res.end(JSON.stringify({ error: err.message })); }
  }

  if (pathname === '/api/ollama-pull' && method === 'POST') {
    try {
      const { name } = await readJsonBody(req);
      if (!/^[\w.\/:-]+$/.test(String(name || ''))) throw new Error('Enter a model name like qwen2.5-coder:7b');
      pullOllama(name);
      res.writeHead(202); return res.end(JSON.stringify({ ok: true }));
    } catch (err) { res.writeHead(400); return res.end(JSON.stringify({ error: err.message })); }
  }

  if (pathname === '/api/open-folder' && method === 'POST') {
    const { which } = await readJsonBody(req).catch(() => ({}));
    const dir = { models: loadSettings().modelsDir, workspace: WORKSPACE_DIR, data: DATA_DIR, skills: SKILLS_DIR, logs: path.join(DATA_DIR, 'logs') }[which];
    if (!dir) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Unknown folder' })); }
    fs.mkdirSync(dir, { recursive: true });
    const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(opener, [dir], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, dir }));
  }

  // STAGED PROPOSALS + WORKSPACE FILES
  if (pathname === '/api/proposals') {
    const tasks = loadTasks();
    const list = fs.readdirSync(PROPOSALS_DIR).filter(f => /^proposal_.*\.json$/.test(f)).map(f => {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(PROPOSALS_DIR, f), 'utf8'));
        const taskId = String(p.proposal_id || '').replace(/_\d+$/, '');
        const target = path.resolve(WORKSPACE_DIR, p.file_path || '');
        const before = target.startsWith(WORKSPACE_DIR + path.sep) && safeFileExists(target) ? fs.readFileSync(target, 'utf8') : '';
        return { proposal_id: p.proposal_id, task_id: taskId, file_path: p.file_path, goal: (tasks[taskId] || {}).goal || '',
                 test: p.test && p.test.status, verdict: p.review && p.review.verdict, diff: generateDiff(before, p.content || '') };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => String(b.proposal_id).localeCompare(String(a.proposal_id)));
    res.writeHead(200); return res.end(JSON.stringify(list));
  }

  if (pathname === '/api/proposals/clear' && method === 'POST') {
    let cleared = 0;
    for (const f of fs.readdirSync(PROPOSALS_DIR)) if (/^proposal_.*\.json$/.test(f)) { fs.unlinkSync(path.join(PROPOSALS_DIR, f)); cleared++; }
    res.writeHead(200); return res.end(JSON.stringify({ cleared }));
  }

  if (pathname === '/api/changelog') {
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
    try { return res.end(fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8')); } catch { return res.end(''); }
  }

  if (pathname === '/api/files') {
    res.writeHead(200); return res.end(JSON.stringify(listWorkspace()));
  }

  if (pathname === '/api/file') {
    try {
      const full = path.resolve(WORKSPACE_DIR, String(parsedUrl.query.path || ''));
      // realpath on both sides so a symlink inside the workspace can't point the viewer outside it
      if (!fs.realpathSync(full).startsWith(fs.realpathSync(WORKSPACE_DIR) + path.sep) || !fs.statSync(full).isFile()) throw new Error();
      res.writeHead(200); return res.end(JSON.stringify({ path: parsedUrl.query.path, content: fs.readFileSync(full, 'utf8').slice(0, 262144) }));
    } catch { res.writeHead(404); return res.end(JSON.stringify({ error: 'File not found in workspace' })); }
  }

  // WATCHERS: poll devices and APIs the user sets up (miners, services, prices) and alert on rules
  if (pathname === '/api/watchers' && method === 'GET') {
    res.writeHead(200); return res.end(JSON.stringify({ watchers: watchers.list(), alerts: watchers.alerts() }));
  }
  if (pathname.startsWith('/api/watchers') && method === 'POST') {
    try {
      const b = await readJsonBody(req);
      let out;
      if (pathname === '/api/watchers') out = watchers.upsert(b);
      else if (pathname === '/api/watchers/delete') { watchers.remove(String(b.id || '')); out = { ok: true }; }
      else if (pathname === '/api/watchers/test') out = await watchers.test(b);
      else { res.writeHead(404); return res.end(JSON.stringify({ error: 'Not found' })); }
      res.writeHead(200); return res.end(JSON.stringify(out));
    } catch (e) { res.writeHead(400); return res.end(JSON.stringify({ error: e.message })); }
  }

  // LAN FOUNDRY: find model servers on the local network, list a machine's models
  if (pathname === '/api/machines/scan' && method === 'GET') {
    try { const found = await require('./lan').scan(); res.writeHead(200); return res.end(JSON.stringify({ subnets: require('./lan').localSubnets(), found })); }
    catch (e) { res.writeHead(500); return res.end(JSON.stringify({ error: e.message })); }
  }
  if (pathname === '/api/machines/models' && method === 'GET') {
    const url = cleanServerUrl(parsedUrl.query.url);
    if (!url) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Give a server address like http://192.168.1.20:1234' })); }
    try { const models = await require('./lan').listModels(url); res.writeHead(200); return res.end(JSON.stringify({ baseUrl: url, models })); }
    catch (e) { res.writeHead(502); return res.end(JSON.stringify({ error: `No model server answered at ${url} (${e.name === 'TimeoutError' ? 'timed out' : e.message}). On that machine, turn on "Serve on local network" in LM Studio, or set OLLAMA_HOST=0.0.0.0 for Ollama.` })); }
  }

  // TRAINING BAY: run an approved .py file from the workspace (only when the user clicks Run)
  if (pathname === '/api/run' && method === 'GET') {
    res.writeHead(200); return res.end(JSON.stringify(scriptRun ? { ...scriptRun, output: scriptRun.output.slice(-20000), child: undefined } : null));
  }
  if (pathname === '/api/run' && method === 'POST') {
    try {
      if (!perms().runScripts) throw new Error('Turn on "Run Python scripts" in Settings > Permissions first.');
      if (scriptRun && scriptRun.status === 'running') throw new Error('A script is already running. Stop it first.');
      const b = await readJsonBody(req);
      const full = path.resolve(WORKSPACE_DIR, String(b.path || ''));
      if (path.extname(full).toLowerCase() !== '.py' || !fs.existsSync(full) || !fs.realpathSync(full).startsWith(fs.realpathSync(WORKSPACE_DIR) + path.sep)) throw new Error('Only .py files in the workspace can be run.');
      const run = { path: b.path, status: 'running', output: '', exitCode: null, startedAt: new Date().toISOString() };
      const child = spawn(pythonCmd(), ['-u', path.basename(full)], { cwd: path.dirname(full), windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
      const add = d => { run.output = (run.output + d).slice(-200000); };
      child.stdout.on('data', add); child.stderr.on('data', add);
      child.on('error', e => { add(`\n${e.code === 'ENOENT' ? `Python was not found (${pythonCmd()}). Install Python, or set its path in Settings.` : e.message}\n`); run.status = 'failed'; });
      child.on('close', code => { run.exitCode = code; if (run.status === 'running') run.status = code === 0 ? 'done' : (run.stopped ? 'stopped' : 'failed'); });
      Object.defineProperty(run, 'child', { value: child, enumerable: false });
      scriptRun = run;
      res.writeHead(200); return res.end(JSON.stringify({ ok: true }));
    } catch (e) { res.writeHead(400); return res.end(JSON.stringify({ error: e.message })); }
  }
  if (pathname === '/api/run/stop' && method === 'POST') {
    if (scriptRun && scriptRun.status === 'running') { scriptRun.stopped = true; scriptRun.child.kill(); }
    res.writeHead(200); return res.end(JSON.stringify({ ok: true }));
  }

  // SKILLS
  if (pathname === '/api/skills') {
    if (method !== 'POST') { res.writeHead(200); return res.end(JSON.stringify(loadSkills())); }
    try {
      const b = await readJsonBody(req);
      const id = b.id || String(b.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(id)) throw new Error('Give the skill a name (letters and numbers).');
      if (!String(b.body || '').trim()) throw new Error('A skill needs instructions.');
      const dir = path.join(SKILLS_DIR, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), formatSkill(b));
      res.writeHead(200); return res.end(JSON.stringify({ ok: true, id }));
    } catch (err) { res.writeHead(400); return res.end(JSON.stringify({ error: err.message })); }
  }

  if (pathname === '/api/skills/delete' && method === 'POST') {
    const { id } = await readJsonBody(req).catch(() => ({}));
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(String(id))) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Bad skill id' })); }
    fs.rmSync(path.join(SKILLS_DIR, id), { recursive: true, force: true });
    res.writeHead(200); return res.end(JSON.stringify({ ok: true }));
  }

  // SOURCES: reference material the Planner and Builder read
  if (pathname === '/api/sources') {
    if (method !== 'POST') { res.writeHead(200); return res.end(JSON.stringify(readSources())); }
    try {
      const b = await readJsonBody(req, 3 * 1024 * 1024);
      let name = String(b.name || '').slice(0, 120), text = b.text, url = null;
      if (b.url) {
        if (!perms().internet) throw new Error('Turn on internet access in Settings → Permissions to add web pages.');
        url = String(b.url).trim();
        text = await fetchPageText(url);
        name = name || url;
      }
      if (typeof text !== 'string' || !text.trim()) throw new Error('That source is empty.');
      if (text.includes('\u0000')) throw new Error('Only text files can be added (txt, md, csv, json, code, html).');
      if (text.length > 2 * 1024 * 1024) throw new Error('That file is over 2 MB.');
      const id = 'src_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      fs.mkdirSync(SOURCES_DIR, { recursive: true });
      fs.writeFileSync(path.join(SOURCES_DIR, id + '.txt'), text);
      const list = readSources();
      list.unshift({ id, name: name || 'Untitled', url, chars: text.length, enabled: true, added: new Date().toISOString() });
      writeSources(list);
      res.writeHead(200); return res.end(JSON.stringify(list));
    } catch (err) { res.writeHead(400); return res.end(JSON.stringify({ error: err.message })); }
  }

  if (pathname === '/api/sources/update' && method === 'POST') {
    const b = await readJsonBody(req).catch(() => ({}));
    let list = readSources();
    if (b.remove) {
      list = list.filter(x => x.id !== b.id);
      if (/^src_[a-z0-9]+$/.test(String(b.id))) fs.rmSync(path.join(SOURCES_DIR, b.id + '.txt'), { force: true });
    } else list.forEach(x => { if (x.id === b.id && typeof b.enabled === 'boolean') x.enabled = b.enabled; });
    writeSources(list);
    res.writeHead(200); return res.end(JSON.stringify(list));
  }

  // SHIP: publish a workspace folder to the Apify Store as an Actor
  if (pathname === '/api/folders') {
    let dirs = [];
    try { dirs = fs.readdirSync(WORKSPACE_DIR, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map(e => e.name); } catch {}
    res.writeHead(200); return res.end(JSON.stringify(dirs));
  }

  if (pathname === '/api/publish/apify' && method === 'POST') {
    try {
      const b = await readJsonBody(req);
      const token = getKey('apify');
      if (!token) throw new Error('Save your Apify API token first.');
      const folder = path.resolve(WORKSPACE_DIR, String(b.folder || ''));
      if (!folder.startsWith(WORKSPACE_DIR + path.sep) || !fs.existsSync(folder)) throw new Error('Pick a folder from your workspace.');
      const name = String(b.name || path.basename(folder)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
      if (!name) throw new Error('Give the Actor a name.');
      const files = collectFiles(folder);
      if (!files.some(f => f.name === 'package.json')) throw new Error('The folder needs a package.json (use the "Apify Actor project" blueprint).');
      res.writeHead(200); return res.end(JSON.stringify(await publishToApify(token, name, files)));
    } catch (err) { res.writeHead(400); return res.end(JSON.stringify({ error: err.message })); }
  }

  // TESTER and REVIEWER
  if (pathname.startsWith('/api/tasks/') && (pathname.endsWith('/test') || pathname.endsWith('/review'))) {
    if (method !== 'POST') { res.writeHead(405); return res.end(JSON.stringify({ error: 'Method not allowed' })); }
    const taskId = pathname.split('/')[3];
    const isTest = pathname.endsWith('/test');
    try {
      const data = await readJsonBody(req);
      const task = loadTasks()[taskId];
      const found = task && getProposal(taskId, data.proposal_id);
      if (!found) { res.writeHead(404); return res.end(JSON.stringify({ error: 'Task or proposal not found' })); }
      if (isTest) found.data.test = await testProposal(found.data, task);
      else found.data.review = await reviewProposal(task, found.data);
      fs.writeFileSync(found.file, JSON.stringify(found.data, null, 2));
      res.writeHead(200);
      res.end(JSON.stringify(isTest ? found.data.test : found.data.review));
    } catch (err) {
      console.error(isTest ? 'Test error:' : 'Review error:', err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Serve the Freeze Foundry frontend
  if (method === 'GET' || method === 'HEAD') {
    let requested;
    try {
      requested = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    const publicRoot = path.resolve(__dirname, 'public');
    const target = path.resolve(publicRoot, '.' + requested);

    if (target !== publicRoot &&
        !target.startsWith(publicRoot + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    try {
      const stat = fs.statSync(target);
      if (stat.isFile()) {
        const types = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.ico': 'image/x-icon'
        };
        res.writeHead(200, {
          'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff'
        });
        if (method === 'HEAD') return res.end();
        return fs.createReadStream(target).pipe(res);
      }
    } catch {}
  }

  // Default response for unknown routes
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.log(`Port ${PORT} is already in use; Freeze Foundry is probably already running.`);
  else console.error('Server error:', err.message);
});

const watchers = require('./watchers').createWatchers(path.join(DATA_DIR, 'watchers.json'), {
  // Optional: ask the model to explain an alert, using the latest reading.
  onAlert(alert, w, st) {
    if (!w.aiPrompt) return;
    callLMStudio([
      { role: 'system', content: 'You monitor devices and services for the user. Answer in 2-4 short sentences: what is happening and what to check first. Do not invent numbers.' },
      { role: 'user', content: `${w.aiPrompt}\n\nAlert: ${alert.message}\nLatest reading (JSON): ${String(st.raw || '').slice(0, 3000)}` }
    ], 'default').then(t => { alert.ai = t.replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, 1500); }).catch(e => { alert.ai = `AI check failed: ${e.message}`; });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Freeze Foundry server running at http://${HOST}:${PORT}`);
  console.log(`LM Studio model: ${MODEL_NAME}`);
  console.log(`Workspace directory: ${WORKSPACE_DIR}`);
  console.log(`Data directory: ${DATA_DIR}`);
});

// Line diff via longest common subsequence: unchanged lines keep a leading space, - removed, + added.
function generateDiff(before, after) {
  const a = (before || '').replace(/^\uFEFF/, '').split('\n');
  const b = (after || '').replace(/^\uFEFF/, '').split('\n');
  if (!before) return b.map(l => '+' + l).join('\n');
  if (!after) return a.map(l => '-' + l).join('\n');
  if (a.length * b.length > 4000000) return a.map(l => '-' + l).concat(b.map(l => '+' + l)).join('\n');
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(' ' + a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push('-' + a[i++]);
    else out.push('+' + b[j++]);
  }
  while (i < n) out.push('-' + a[i++]);
  while (j < m) out.push('+' + b[j++]);
  return out.join('\n');
}

// ---------- Tester / Reviewer ----------

// Look up a proposal by its exact ID; returns { file, data } or null.
function getProposal(taskId, proposalId) {
  if (typeof proposalId !== 'string' || !/^[\w-]+$/.test(proposalId) || !proposalId.startsWith(`${taskId}_`)) return null;
  const file = path.join(PROPOSALS_DIR, `proposal_${proposalId}.json`);
  if (!fs.existsSync(file)) return null;
  return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function readJsonBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > limit) reject(new Error('Request body too large'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); }
    });
  });
}

// Run one fixed command (never model-written) and record exactly what happened.
function runCheck(command, args, cwd, useShell) {
  return new Promise(resolve => {
    const started = Date.now();
    let output = '';
    // ELECTRON_RUN_AS_NODE lets the desktop app's own binary act as node for `node --check`.
    const child = spawn(command, args, { cwd, shell: useShell, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    const timer = setTimeout(() => { output += '\n[killed: timed out after 60s]'; child.kill(); }, 60000);
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    child.on('error', e => { output += '\n' + e.message; });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({
        command: [command === process.execPath ? 'node' : command, ...args].join(' '),
        exitCode: code,
        durationMs: Date.now() - started,
        output: output.slice(-8000)
      });
    });
  });
}

// Test a proposal in a throwaway copy of the workspace; the real workspace is never touched.
async function testProposal(proposal, task) {
  const runDir = path.join(DATA_DIR, 'testruns', `run_${Date.now()}`);
  fs.cpSync(WORKSPACE_DIR, runDir, { recursive: true });
  try {
    const target = path.resolve(runDir, proposal.file_path || '');
    if (!target.startsWith(runDir + path.sep)) throw new Error('Invalid file path in proposal');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, proposal.content || '', 'utf8');

    const checks = [];
    const rel = path.relative(runDir, target).split(path.sep).join('/');
    if (task && fs.existsSync(path.join(WORKSPACE_DIR, rel)) && !String(task.goal || '').toLowerCase().includes(path.basename(rel).toLowerCase()))
      checks.push({ command: 'scope check', exitCode: 1, output: `This rewrites the existing file ${rel}, but the goal never mentions it. Write a new file instead (or the user must name ${rel} in the goal).` });
    const ext = path.extname(target).toLowerCase();
    if (['.js', '.cjs', '.mjs'].includes(ext)) {
      checks.push(await runCheck(process.execPath, ['--check', path.relative(runDir, target)], runDir, false));
    } else if (ext === '.py') {
      const c = await runCheck(pythonCmd(), ['-m', 'py_compile', path.relative(runDir, target)], runDir, false);
      if (!/ENOENT/.test(c.output)) checks.push(c); // no Python installed: skip rather than fail the work
    } else if (ext === '.json') {
      try { JSON.parse(proposal.content); checks.push({ command: 'JSON.parse', exitCode: 0, output: 'valid JSON' }); }
      catch (e) { checks.push({ command: 'JSON.parse', exitCode: 1, output: e.message }); }
    }

    // npm test only if the APPROVED workspace package.json defines it, so the model can't inject a test command.
    const pkgPath = path.join(WORKSPACE_DIR, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8').replace(/^\uFEFF/, ''));
      if (pkg.scripts && pkg.scripts.test && perms().runTests) checks.push(await runCheck('npm', ['test'], runDir, true));
    }

    const status = checks.length === 0 ? 'no_checks' : (checks.every(c => c.exitCode === 0) ? 'passed' : 'failed');
    return { status, checks, ranAt: new Date().toISOString() };
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}

async function reviewProposal(task, proposal) {
  const existing = path.resolve(WORKSPACE_DIR, proposal.file_path || '');
  const before = existing.startsWith(WORKSPACE_DIR + path.sep) && safeFileExists(existing) ? fs.readFileSync(existing, 'utf8') : '';
  const diff = generateDiff(before, proposal.content || '');
  const t = proposal.test;
  const testSummary = t
    ? `Status: ${t.status}\n` + t.checks.map(c => `$ ${c.command} -> exit ${c.exitCode}\n${c.output}`).join('\n')
    : 'Tests were not run.';

  const raw = await callLMStudio(withSkills([
    { role: 'system', content: 'You are a code reviewer. Choose "revise" ONLY for blocking defects: wrong file, broken code or failed tests, the goal not met, invented or false content, or a real security problem. Judge only this one file: the other files of a project are built by separate tasks, so never ask for files outside this goal. Style tweaks and nice-to-haves go in "notes" and must not block approval. Output ONLY JSON: {"verdict": "approve" or "revise", "issues": ["blocking problems only"], "notes": ["optional suggestions"]}' },
    { role: 'user', content: `Goal: ${task.goal}\n\n${workspaceContext('')}\n\nFile: ${proposal.file_path}\n\nNew file content (judge THIS):\n${String(proposal.content || '').slice(0, 12000)}\n\nDiff against the current file (context only; '-' removed, '+' added):\n${diff.slice(0, 8000)}\n\nTest results:\n${testSummary.slice(0, 4000)}` }
  ], skillsFor('reviewer', task.goal)), 'reviewer', task.id);

  let verdict = 'unknown';
  let issues = [];
  let notes = [];
  try {
    const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
    const j = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (j.verdict === 'approve' || j.verdict === 'revise') verdict = j.verdict;
    if (Array.isArray(j.issues)) issues = j.issues.map(String);
    if (Array.isArray(j.notes)) notes = j.notes.map(String);
  } catch {}
  // A failed test always blocks approval, whatever the model says.
  if (t && t.status === 'failed') verdict = 'revise';

  return { verdict, issues, notes, diff, raw: verdict === 'unknown' ? raw.slice(0, 4000) : undefined, reviewedAt: new Date().toISOString() };
}

// Workspace file list, plus the contents of any file the goal names (so the Builder edits instead of inventing).
function listWorkspace(dir = WORKSPACE_DIR, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= 200) break;
    if (e.name === 'node_modules' || e.name.startsWith('.') || e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listWorkspace(full, out);
    else out.push(path.relative(WORKSPACE_DIR, full).split(path.sep).join('/'));
  }
  return out;
}

function workspaceContext(goal) {
  const files = listWorkspace();
  const g = String(goal || '').toLowerCase();
  let ctx = 'Existing workspace files:\n' + (files.length ? files.join('\n') : '(empty)');
  let budget = 24000;
  for (const f of files) {
    if (!perms().readFiles || !g || !g.includes(path.basename(f).toLowerCase())) continue;
    const text = fs.readFileSync(path.join(WORKSPACE_DIR, f), 'utf8').replace(/^\uFEFF/, '').slice(0, 12000);
    if (text.length > budget) break;
    budget -= text.length;
    ctx += `\n\nCurrent contents of ${f}:\n${text}`;
  }
  return ctx;
}

// ---------- Settings and usage ledger ----------
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.jsonl');
const DEFAULT_SETTINGS = {
  provider: 'local', baseUrl: 'http://127.0.0.1:1234/v1', model: MODEL_NAME, roleModels: {}, roleConfig: {},
  modelsDir: path.join(os.homedir(), '.lmstudio', 'models'), attempts: 3, autoApply: true, setupDone: false,
  temperature: 0.7, maxTokens: 4096, requestTimeoutSec: 600, gitCommit: false, permissions: { readFiles: true, runTests: true, sources: true, internet: false, runScripts: false }, ui: { accent: '#a855f7', theme: 'system', pace: 'normal', sounds: true, notifications: true, reduceMotion: false, scale: 1 }
};

const APP_VERSION = require('./package.json').version;

function publicSettings(st) {
  return { ...st, version: APP_VERSION, root: ROOT_DIR, dataDir: DATA_DIR, workspace: st.workspace || WORKSPACE_DIR, keysSet: Object.fromEntries(Object.keys(readKeys()).map(k => [k, true])) };
}

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}

function logUsage(row) {
  try { fs.appendFileSync(LEDGER_FILE, JSON.stringify(row) + '\n'); } catch {}
}

function readLedger() {
  try { return fs.readFileSync(LEDGER_FILE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); }
  catch { return []; }
}

// ---------- Model downloads ----------
const downloads = [];

// Streams a file to <dest>.part, then renames it, so LM Studio never sees a half-written model.
function startDownload(src, dest) {
  const d = { name: path.basename(dest), status: 'downloading', received: 0, total: 0 };
  downloads.unshift(d);
  (async () => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Hugging Face returned ${res.status}`);
    d.total = Number(res.headers.get('content-length')) || 0;
    const part = dest + '.part';
    const out = fs.createWriteStream(part);
    try {
      for await (const chunk of res.body) {
        d.received += chunk.length;
        if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
      }
    } finally { await new Promise(r => out.end(r)); }
    fs.renameSync(part, dest);
    d.status = 'done';
  })().catch(err => { d.status = 'failed'; d.error = err.message; });
}

// shortcut: always talks to Ollama on its default port; read the port from settings if users move it.
function pullOllama(name) {
  const d = { name: 'ollama: ' + name, status: 'downloading', received: 0, total: 0 };
  downloads.unshift(d);
  (async () => {
    const r = await fetch('http://127.0.0.1:11434/api/pull', { method: 'POST', body: JSON.stringify({ name, stream: true }) });
    if (!r.ok) throw new Error(`Ollama returned ${r.status}`);
    let buf = '';
    for await (const chunk of r.body) {
      buf += Buffer.from(chunk).toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        const j = JSON.parse(line);
        if (j.error) throw new Error(j.error);
        if (j.total) { d.total = j.total; d.received = j.completed || 0; }
      }
    }
    d.status = 'done';
  })().catch(err => { d.status = 'failed'; d.error = err.message.includes('fetch failed') ? 'Ollama is not running' : err.message; });
}

function listGguf(dir, base = dir, out = [], depth = 0) {
  if (depth > 4 || out.length > 300) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listGguf(full, base, out, depth + 1);
    else if (e.name.toLowerCase().endsWith('.gguf')) out.push({ path: path.relative(base, full), size: fs.statSync(full).size });
  }
  return out;
}

// ---------- Skills ----------
// Agent Skills format: skills/<id>/SKILL.md with a YAML-style header. `triggers` (keywords) and `roles`
// are optional: no triggers means always on, no roles means every worker.
const SKILLS_DIR = path.join(ROOT_DIR, 'skills');
{
  // Copy each starter skill once (file by file so it works inside the packaged app). .starters remembers
  // which were offered, so a starter added in an update arrives but one the user deleted stays deleted.
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  const src = path.join(__dirname, 'starter-skills');
  const seenFile = path.join(SKILLS_DIR, '.starters');
  let seen = [];
  try { seen = JSON.parse(fs.readFileSync(seenFile, 'utf8')); } catch {}
  for (const id of fs.existsSync(src) ? fs.readdirSync(src) : []) {
    if (seen.includes(id)) continue;
    if (!fs.existsSync(path.join(SKILLS_DIR, id))) {
      fs.mkdirSync(path.join(SKILLS_DIR, id), { recursive: true });
      fs.writeFileSync(path.join(SKILLS_DIR, id, 'SKILL.md'), fs.readFileSync(path.join(src, id, 'SKILL.md')));
    }
    seen.push(id);
  }
  fs.writeFileSync(seenFile, JSON.stringify(seen));
}

function parseSkill(id, text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const meta = {};
  for (const line of (m ? m[1] : '').split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const v = kv[2].trim();
    meta[kv[1]] = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : v.replace(/^['"]|['"]$/g, '');
  }
  const list = v => (Array.isArray(v) ? v : v ? String(v).split(',').map(x => x.trim()).filter(Boolean) : []);
  return {
    id, name: meta.name || id, description: meta.description || '',
    triggers: list(meta.triggers).map(t => t.toLowerCase()), roles: list(meta.roles).map(r => r.toLowerCase()),
    enabled: meta.enabled !== 'false', body: (m ? m[2] : text).trim()
  };
}

function formatSkill(b) {
  const list = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(x => String(x).trim()).filter(Boolean);
  const one = v => String(v || '').replace(/[\r\n]+/g, ' ').trim();
  return `---\nname: ${one(b.name)}\ndescription: ${one(b.description)}\ntriggers: [${list(b.triggers).join(', ')}]\nroles: [${list(b.roles).join(', ')}]\nenabled: ${b.enabled !== false}\n---\n\n${String(b.body).trim()}\n`;
}

function loadSkills() {
  let ids = [];
  try { ids = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch {}
  return ids.map(id => {
    try { return parseSkill(id, fs.readFileSync(path.join(SKILLS_DIR, id, 'SKILL.md'), 'utf8')); } catch { return null; }
  }).filter(Boolean);
}

function skillsFor(role, goal) {
  const g = String(goal || '').toLowerCase();
  return loadSkills().filter(k => k.enabled && (!k.roles.length || k.roles.includes(role)) && (!k.triggers.length || k.triggers.some(t => g.includes(t))));
}

function withSkills(messages, skills) {
  if (!skills.length) return messages;
  const extra = '\n\nFollow these skills:\n' + skills.map(k => `## ${k.name}\n${k.body.slice(0, 4000)}`).join('\n\n');
  return [{ ...messages[0], content: messages[0].content + extra }, ...messages.slice(1)];
}

// ---------- Model providers and API keys ----------
const PROVIDERS = {
  local: { label: 'Local model (LM Studio / Ollama)' },
  anthropic: { label: 'Claude (Anthropic)', base: 'https://api.anthropic.com/v1' },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1' },
  gemini: { label: 'Gemini (Google)', base: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1' },
  custom: { label: 'Custom OpenAI-compatible server' }
};

function providerBase(st) { return (PROVIDERS[st.provider] && PROVIDERS[st.provider].base) || String(st.baseUrl).replace(/\/$/, ''); }

// Keys are encrypted with the OS keychain (Electron safeStorage) when the desktop app runs the server;
// plain `node server.js` keeps them in a file only this user can read. They are never sent to the UI.
const KEYS_FILE = path.join(DATA_DIR, 'keys.json');
let safeStorage = null;
try { const e = require('electron'); if (e && typeof e === 'object' && e.safeStorage) safeStorage = e.safeStorage; } catch {}

function readKeys() { try { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); } catch { return {}; } }

function getKey(provider) {
  const v = readKeys()[provider];
  if (!v) return '';
  if (v.enc) { try { return safeStorage.decryptString(Buffer.from(v.enc, 'base64')); } catch { return ''; } }
  return v.plain || '';
}

function setKey(provider, key) {
  const all = readKeys();
  if (!key) delete all[provider];
  else if (safeStorage && safeStorage.isEncryptionAvailable()) all[provider] = { enc: safeStorage.encryptString(key).toString('base64') };
  else all[provider] = { plain: key };
  writeJsonAtomic(KEYS_FILE, all, { mode: 0o600 });
}

// ---------- Permissions, sources, web pages ----------
function perms() { return loadSettings().permissions; }

// A model server address for LAN Foundry: http(s), ending in /v1, no credentials or query.
function cleanServerUrl(u) {
  try {
    const x = new URL(String(u || '').trim());
    if (!['http:', 'https:'].includes(x.protocol) || x.username || x.password) return null;
    return `${x.protocol}//${x.host}${x.pathname.replace(/\/+$/, '').replace(/(\/v1)?$/, '/v1')}`;
  } catch { return null; }
}

function isLocalHost(host) {
  return host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}` || host === `[::1]:${PORT}`;
}

async function builderMessages(task, feedback = '', previous = '') {
  return withSkills([
    { role: 'system', content: 'You are a code generator. Output ONLY valid JSON, no markdown blocks. Format: {"file_path": "<relative path inside the workspace>", "content": "<complete file contents>"}. To change an existing file, use its exact path from the file list. Base everything on the goal and the existing files shown. Never invent features, technologies, URLs, or contact details that are not given.' },
    { role: 'user', content: 'Goal: ' + task.goal + (task.project ? `\n\nThis file is order ${task.project.index + 1} of ${task.project.orders.length} in the project "${task.project.name}". The whole project, in build order (earlier files already exist in the workspace):\n` + task.project.orders.map((o, i) => `${i + 1}. ${o}`).join('\n') + '\nMatch the names, exports and formats the other orders describe.' : '') + (task.plan ? '\n\nPlan:\n' + task.plan : '') + '\n\n' + workspaceContext(task.goal + ' ' + (task.project ? task.project.orders.join(' ') : '')) + (await extraContext(task.goal)) + previous + (feedback ? '\n\nYour previous draft was rejected. Fix these problems and return the corrected complete file:\n' + feedback : '') }
  ], skillsFor('builder', task.goal));
}

function parseBuilderOutput(response) {
  response = response.replace(/<think>[\s\S]*?<\/think>/g, '');
  const parsed = { file_path: 'untitled.md', content: response };
  try {
    const a = response.indexOf('{'), b = response.lastIndexOf('}');
    if (a > -1 && b > -1) {
      let temp = JSON.parse(response.substring(a, b + 1));
      if (temp.files && temp.files.length > 0) temp = temp.files[0];
      if (temp.file_path || temp.path) parsed.file_path = temp.file_path || temp.path;
      if (temp.content || temp.code) parsed.content = temp.content || temp.code;
    }
  } catch { console.log('JSON parsing skipped, using raw response as content.'); }
  return parsed;
}

function cleanProject(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.orders)) return undefined;
  const orders = p.orders.map(o => String(o).slice(0, 1000)).slice(0, 8);
  const index = Number.isInteger(p.index) && p.index >= 0 && p.index < orders.length ? p.index : 0;
  return { id: /^[\w-]{1,40}$/.test(p.id || '') ? p.id : 'proj_' + Date.now().toString(36), name: String(p.name || 'Project').slice(0, 80), index, orders };
}

function sha1(buf) { return require('crypto').createHash('sha1').update(buf).digest('hex'); }

// Optional: commit each applied change when the workspace is a git repo. Fixed git arguments, never a shell.
function gitCommit(relPath, goal) {
  const { execFileSync } = require('child_process');
  const git = (...args) => execFileSync('git', ['-C', WORKSPACE_DIR, ...args], { timeout: 15000, stdio: 'pipe', windowsHide: true }).toString().trim();
  try {
    if (git('rev-parse', '--is-inside-work-tree') !== 'true') return null;
    git('add', '--', relPath);
    const msg = `Freeze Foundry: ${String(goal || relPath).replace(/\s+/g, ' ').slice(0, 72)}`;
    try { git('commit', '-m', msg, '--', relPath); }
    catch { git('-c', 'user.name=Freeze Foundry', '-c', 'user.email=factory@freezefoundry.local', 'commit', '-m', msg, '--', relPath); } // no git identity set
    return git('rev-parse', '--short', 'HEAD');
  } catch (e) { console.warn('git commit skipped:', e.message.split('\n')[0]); return null; }
}

// Tasks saved before statuses were tracked stay "pending" forever; mark them once so queue recovery ignores them.
(() => {
  try {
    const st = loadSettings();
    if (st.taskStatusV2) return;
    const tasks = loadTasks();
    for (const t of Object.values(tasks)) if (t.status === 'pending') t.status = 'unknown';
    saveTasks(tasks);
    writeJsonAtomic(SETTINGS_FILE, { ...st, taskStatusV2: true });
  } catch (e) { console.warn('task migration skipped:', e.message); }
})();

let scriptRun = null;
// shortcut: uses Python from PATH (or the pythonPath setting); no virtualenv picker yet.
function pythonCmd() {
  const p = loadSettings().pythonPath;
  return typeof p === 'string' && p.trim() ? p.trim() : (process.platform === 'win32' ? 'python' : 'python3');
}

const SOURCES_DIR = path.join(DATA_DIR, 'sources');
const SOURCES_FILE = path.join(SOURCES_DIR, 'sources.json');
function readSources() { try { return JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')); } catch { return []; } }
function writeSources(list) { fs.mkdirSync(SOURCES_DIR, { recursive: true }); writeJsonAtomic(SOURCES_FILE, list); }

async function fetchPageText(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http and https links can be fetched.');
  const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'FreezeFoundry/1.0 (+local app)' } });
  if (!r.ok) throw new Error(`The page returned ${r.status}.`);
  const raw = (await r.text()).slice(0, 3 * 1024 * 1024);
  return /<html|<body|<div/i.test(raw)
    ? raw.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
    : raw;
}

const pageCache = new Map();
// Sources the user turned on, plus pages linked in the goal when internet access is allowed.
async function extraContext(goal) {
  const p = perms();
  let out = '', budget = 24000;
  if (p.sources) for (const src of readSources().filter(x => x.enabled)) {
    if (budget <= 0) break;
    let text = '';
    try { text = fs.readFileSync(path.join(SOURCES_DIR, src.id + '.txt'), 'utf8').slice(0, Math.min(8000, budget)); } catch { continue; }
    budget -= text.length;
    out += `\n\n### Source: ${src.name}\n${text}`;
  }
  if (p.internet) for (const url of [...new Set(String(goal || '').match(/https?:\/\/[^\s)'"<>]+/g) || [])].slice(0, 3)) {
    try {
      if (!pageCache.has(url)) pageCache.set(url, (await fetchPageText(url)).slice(0, 8000));
      out += `\n\n### Web page: ${url}\n${pageCache.get(url)}`;
    } catch (err) { out += `\n\n### Web page: ${url}\n(could not load: ${err.message})`; }
  }
  return out ? '\n\nReference material from the user (use it when relevant):' + out : '';
}

// Text files of a project folder, dotfolders like .actor included.
function collectFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(e.name) || e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectFiles(full, base, out);
    else if (fs.statSync(full).size < 1024 * 1024) {
      const content = fs.readFileSync(full, 'utf8');
      if (!content.includes('\u0000')) out.push({ name: path.relative(base, full).split(path.sep).join('/'), format: 'TEXT', content });
    }
    if (out.length > 200) break;
  }
  return out;
}

async function publishToApify(token, name, sourceFiles) {
  const api = (p, opts = {}) => fetch('https://api.apify.com/v2' + p, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
    .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok && r.status !== 404) throw new Error((d.error && d.error.message) || `Apify returned ${r.status}`); return r.status === 404 ? null : d.data; });
  const me = await api('/users/me');
  const id = `${me.username}~${name}`;
  const version = { versionNumber: '0.1', sourceType: 'SOURCE_FILES', sourceFiles };
  let actor = await api(`/actors/${id}`);
  if (actor) await api(`/actors/${actor.id}/versions/0.1`, { method: 'PUT', body: JSON.stringify(version) });
  else actor = await api('/actors', { method: 'POST', body: JSON.stringify({ name, isPublic: false, versions: [version] }) });
  const build = await api(`/actors/${actor.id}/builds?version=0.1`, { method: 'POST' });
  return { actorId: actor.id, name, files: sourceFiles.length, build: build && build.status, url: `https://console.apify.com/actors/${actor.id}` };
}
