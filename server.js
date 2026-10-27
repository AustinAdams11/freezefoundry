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
  const tasksFile = path.join(DATA_DIR, 'tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2), 'utf8');
}

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

// Call the configured OpenAI-compatible model server (LM Studio or Ollama) and record usage in the ledger.
async function callLMStudio(messages, role = 'default', taskId = null) {
  const st = loadSettings();
  const model = (st.roleModels && st.roleModels[role]) || st.model;
  const started = Date.now();
  try {
    const key = st.provider === 'local' ? (process.env.LM_STUDIO_API_KEY || '') : getKey(st.provider);
    if (!key && st.provider !== 'local' && st.provider !== 'custom') throw new Error(`Add your ${PROVIDERS[st.provider].label} API key on the Models page first.`);
    let text, usage;
    if (st.provider === 'anthropic') {
      const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
      const r = await fetch(PROVIDERS.anthropic.base + '/messages', {
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
      const body = st.provider === 'openai' ? { model, messages, max_completion_tokens: st.maxTokens } : { model, messages, temperature: st.temperature, max_tokens: st.maxTokens };
      const r = await fetch(providerBase(st) + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify(body)
      });
      if (!r.ok) throw new Error(`Model error ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const d = await r.json();
      text = d.choices[0].message.content || '';
      usage = d.usage || {};
    }
    logUsage({ ts: new Date().toISOString(), task: taskId, role, provider: st.provider, model, prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, ms: Date.now() - started });
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

  // Static file serving for public directory
  if (pathname.startsWith('/public/')) {
    const filePath = path.join(PUBLIC_DIR, pathname.substring(7));
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        res.setHeader('Content-Type', 'text/html');
        const indexPath = path.join(filePath, 'index.html');
        if (fs.existsSync(indexPath)) {
          const content = fs.readFileSync(indexPath, 'utf8');
          res.writeHead(200);
          res.end(content);
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      } else if (stat.isFile()) {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Length': content.length });
        res.end(content);
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
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
            const messages = withSkills([
                { role: 'system', content: 'You are a code generator. Output ONLY valid JSON, no markdown blocks. Format: {"file_path": "<relative path inside the workspace>", "content": "<complete file contents>"}. To change an existing file, use its exact path from the file list. Base everything on the goal and the existing files shown. Never invent features, technologies, URLs, or contact details that are not given.' },
                { role: 'user', content: 'Goal: ' + task.goal + (task.plan ? '\n\nPlan:\n' + task.plan : '') + '\n\n' + workspaceContext(task.goal) + (await extraContext(task.goal)) + previous + (feedback ? '\n\nYour previous draft was rejected. Fix these problems and return the corrected complete file:\n' + feedback : '') }
            ], skillsFor('builder', task.goal));

            let response = await callLMStudio(messages, 'builder', taskId);
            response = response.replace(/<think>[\s\S]*?<\/think>/g, '');
            let parsed = { file_path: 'untitled.md', content: response };
            
            try {
                let s_idx = response.indexOf('{');
                let e_idx = response.lastIndexOf('}');
                if (s_idx > -1 && e_idx > -1) {
                    let temp = JSON.parse(response.substring(s_idx, e_idx + 1));
                    if (temp.files && temp.files.length > 0) temp = temp.files[0];
                    if (temp.file_path || temp.path) parsed.file_path = temp.file_path || temp.path;
                    if (temp.content || temp.code) parsed.content = temp.content || temp.code;
                }
            } catch(e) {
                console.log("JSON parsing skipped, using raw response as content.");
            }

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
        backupFile(targetPath, backupPath);

        // Write new content
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(targetPath, proposal.content, 'utf8');

        // Remove proposal file
        fs.unlinkSync(proposalFile);

        res.writeHead(200);
        res.end(JSON.stringify({ task: taskId, status: 'approved', path: relativePath }));
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
        if (typeof b.temperature === 'number' && b.temperature >= 0 && b.temperature <= 2) st.temperature = b.temperature;
        if (Number.isInteger(b.maxTokens) && b.maxTokens >= 256 && b.maxTokens <= 32768) st.maxTokens = b.maxTokens;
        if (b.permissions && typeof b.permissions === 'object') {
          const pm = { ...st.permissions };
          for (const k of ['readFiles', 'runTests', 'sources', 'internet']) if (typeof b.permissions[k] === 'boolean') pm[k] = b.permissions[k];
          st.permissions = pm;
        }
        if (b.ui && typeof b.ui === 'object') {
          const u = b.ui, ui = { ...st.ui };
          if (/^#[0-9a-f]{6}$/i.test(u.accent)) ui.accent = u.accent;
          for (const k of ['sounds', 'notifications', 'reduceMotion']) if (typeof u[k] === 'boolean') ui[k] = u[k];
          if (typeof u.scale === 'number' && u.scale >= 0.8 && u.scale <= 1.5) ui.scale = u.scale;
          if (['relaxed', 'normal', 'fast', 'off'].includes(u.pace)) ui.pace = u.pace;
          st.ui = ui;
        }
        if (b.roleModels && typeof b.roleModels === 'object')
          st.roleModels = Object.fromEntries(Object.entries(b.roleModels).filter(([k, v]) => ['planner', 'builder', 'reviewer'].includes(k) && typeof v === 'string' && v));
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(st, null, 2));
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
    const dir = { models: loadSettings().modelsDir, workspace: WORKSPACE_DIR, data: DATA_DIR, skills: SKILLS_DIR }[which];
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
    { role: 'system', content: 'You are a code reviewer. Choose "revise" ONLY for blocking defects: wrong file, broken code or failed tests, the goal not met, invented or false content, or a real security problem. Style tweaks and nice-to-haves go in "notes" and must not block approval. Output ONLY JSON: {"verdict": "approve" or "revise", "issues": ["blocking problems only"], "notes": ["optional suggestions"]}' },
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
  provider: 'local', baseUrl: 'http://127.0.0.1:1234/v1', model: MODEL_NAME, roleModels: {},
  modelsDir: path.join(os.homedir(), '.lmstudio', 'models'), attempts: 3, autoApply: true, setupDone: false,
  temperature: 0.7, maxTokens: 4096, permissions: { readFiles: true, runTests: true, sources: true, internet: false }, ui: { accent: '#a855f7', pace: 'normal', sounds: true, notifications: true, reduceMotion: false, scale: 1 }
};

function publicSettings(st) {
  return { ...st, root: ROOT_DIR, dataDir: DATA_DIR, workspace: st.workspace || WORKSPACE_DIR, keysSet: Object.fromEntries(Object.keys(readKeys()).map(k => [k, true])) };
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
if (!fs.existsSync(SKILLS_DIR)) {
  // First run: copy the starter skills (read file by file so it also works from inside the packaged app).
  const src = path.join(__dirname, 'starter-skills');
  for (const id of fs.existsSync(src) ? fs.readdirSync(src) : []) {
    fs.mkdirSync(path.join(SKILLS_DIR, id), { recursive: true });
    fs.writeFileSync(path.join(SKILLS_DIR, id, 'SKILL.md'), fs.readFileSync(path.join(src, id, 'SKILL.md')));
  }
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
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
  fs.writeFileSync(KEYS_FILE, JSON.stringify(all), { mode: 0o600 });
}

// ---------- Permissions, sources, web pages ----------
function perms() { return loadSettings().permissions; }

const SOURCES_DIR = path.join(DATA_DIR, 'sources');
const SOURCES_FILE = path.join(SOURCES_DIR, 'sources.json');
function readSources() { try { return JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')); } catch { return []; } }
function writeSources(list) { fs.mkdirSync(SOURCES_DIR, { recursive: true }); fs.writeFileSync(SOURCES_FILE, JSON.stringify(list, null, 2)); }

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
