'use strict';

/**
 * modelRouter.cjs — Multi-model AI routing engine.
 * Routes tasks to the optimal model based on task type, availability, and cost.
 * Supports: OpenAI, Anthropic, Gemini, Mistral, Groq, Together.ai, Ollama (local).
 * Auto-fallback chain if primary model fails.
 */

const { getCredential } = require('./credentialVault.cjs');
const net = require('../lib/http.cjs');

// ─── Model registry ────────────────────────────────────────────────────────────
const MODEL_REGISTRY = {
  // Cloud models
  'gpt-4o':            { provider: 'openai',    credKey: 'OPENAI_API_KEY',    type: 'cloud', ctxK: 128,  costTier: 3, caps: ['general','code','vision','long'] },
  'gpt-4o-mini':       { provider: 'openai',    credKey: 'OPENAI_API_KEY',    type: 'cloud', ctxK: 128,  costTier: 1, caps: ['general','code','fast'] },
  'claude-3-5-sonnet': { provider: 'anthropic', credKey: 'ANTHROPIC_API_KEY', type: 'cloud', ctxK: 200,  costTier: 3, caps: ['general','long','code','analysis'] },
  'claude-3-haiku':    { provider: 'anthropic', credKey: 'ANTHROPIC_API_KEY', type: 'cloud', ctxK: 200,  costTier: 1, caps: ['general','fast'] },
  'gemini-1.5-pro':    { provider: 'gemini',    credKey: 'GEMINI_API_KEY',    type: 'cloud', ctxK: 1000, costTier: 2, caps: ['general','long','vision','code'] },
  'gemini-1.5-flash':  { provider: 'gemini',    credKey: 'GEMINI_API_KEY',    type: 'cloud', ctxK: 1000, costTier: 1, caps: ['general','fast'] },
  'mistral-large':     { provider: 'mistral',   credKey: 'MISTRAL_API_KEY',   type: 'cloud', ctxK: 128,  costTier: 2, caps: ['general','code'] },
  'llama-3.1-70b-groq':{ provider: 'groq',      credKey: 'GROQ_API_KEY',      type: 'cloud', ctxK: 128,  costTier: 1, caps: ['general','fast','code'] },
  // Local Ollama models (detected at runtime)
  'ollama/llama3.2':   { provider: 'ollama',    credKey: null,                type: 'local', ctxK: 128,  costTier: 0, caps: ['general','offline'] },
  'ollama/codellama':  { provider: 'ollama',    credKey: null,                type: 'local', ctxK: 16,   costTier: 0, caps: ['code','offline'] },
  'ollama/mistral':    { provider: 'ollama',    credKey: null,                type: 'local', ctxK: 32,   costTier: 0, caps: ['general','offline'] },
  'ollama/phi3':       { provider: 'ollama',    credKey: null,                type: 'local', ctxK: 128,  costTier: 0, caps: ['general','fast','offline'] },
};

// Task → preferred model capabilities
const TASK_ROUTING = {
  general:    ['general'],
  code:       ['code'],
  long:       ['long'],
  fast:       ['fast'],
  vision:     ['vision'],
  analysis:   ['analysis'],
  offline:    ['offline'],
  stock:      ['general'],   // Stock analysis routes to StockMind Python, not LLM
};

// Fallback chain (in order)
const FALLBACK_CHAIN = [
  'gpt-4o',
  'claude-3-5-sonnet',
  'gemini-1.5-pro',
  'llama-3.1-70b-groq',
  'mistral-large',
  'ollama/llama3.2',
  'ollama/phi3',
];

// ─── State ────────────────────────────────────────────────────────────────────
let detectedOllamaModels  = [];
let primaryModel          = 'gpt-4o';
let ollamaBaseUrl         = 'http://localhost:11434';

// ─── Register IPC ─────────────────────────────────────────────────────────────
function register(ipcMain) {

  // ── List available models ─────────────────────────────────────────────────
  ipcMain.handle('models:list', async () => {
    await refreshOllamaModels();
    const available = Object.entries(MODEL_REGISTRY).map(([id, info]) => ({
      id,
      ...info,
      available: checkAvailable(id),
    }));
    return { ok: true, data: available, ollama: detectedOllamaModels };
  });

  // ── Set primary model ─────────────────────────────────────────────────────
  ipcMain.handle('models:set-primary', async (_e, modelId) => {
    primaryModel = modelId;
    return { ok: true };
  });

  // ── Get primary model ─────────────────────────────────────────────────────
  ipcMain.handle('models:get-primary', async () => {
    return { ok: true, model: primaryModel };
  });

  // ── Route a task to best model ────────────────────────────────────────────
  ipcMain.handle('models:route', async (_e, taskType) => {
    const model = selectModel(taskType);
    return { ok: true, model };
  });

  // ── Chat completion (routes to correct provider) ───────────────────────────
  ipcMain.handle('models:chat', async (_e, { messages, model, taskType, stream = false }) => {
    const targetModel = model || selectModel(taskType || 'general');
    try {
      const result = await chatCompletion(messages, targetModel);
      return { ok: true, ...result, model: targetModel };
    } catch (err) {
      // Try fallback chain
      for (const fallback of FALLBACK_CHAIN) {
        if (fallback === targetModel) continue;
        if (!checkAvailable(fallback))  continue;
        try {
          const result = await chatCompletion(messages, fallback);
          return { ok: true, ...result, model: fallback, fallbackFrom: targetModel };
        } catch { continue; }
      }
      return { ok: false, error: `All models failed. Last error: ${err.message}` };
    }
  });

  // ── Pull Ollama model ─────────────────────────────────────────────────────
  ipcMain.handle('models:ollama-pull', async (event, modelName) => {
    return new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost',
        port:     11434,
        path:     '/api/pull',
        method:   'POST',
        headers:  { 'Content-Type': 'application/json' },
      }, (res) => {
        res.on('data', (chunk) => {
          try {
            const data = JSON.parse(chunk.toString());
            event.sender.send('models:ollama-pull-progress', data);
          } catch { /* chunked */ }
        });
        res.on('end', () => {
          resolve({ ok: true });
        });
      });
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.write(JSON.stringify({ name: modelName, stream: true }));
      req.end();
    });
  });

  // ── List Ollama models ────────────────────────────────────────────────────
  ipcMain.handle('models:ollama-list', async () => {
    await refreshOllamaModels();
    return { ok: true, data: detectedOllamaModels };
  });

  // ── Detect what credentials are available ─────────────────────────────────
  ipcMain.handle('models:check-credentials', async () => {
    const status = {};
    for (const [id, info] of Object.entries(MODEL_REGISTRY)) {
      if (!info.credKey) {
        status[id] = 'local';
      } else {
        status[id] = getCredential(info.credKey) ? 'available' : 'missing-key';
      }
    }
    return { ok: true, data: status };
  });

  // ── Ask Rāma what credentials it needs for a task ────────────────────────
  ipcMain.handle('models:needs-for-task', async (_e, taskDescription) => {
    const needs = analyzeCredentialNeeds(taskDescription);
    return { ok: true, data: needs };
  });
}

// ─── Model selection logic ────────────────────────────────────────────────────
function selectModel(taskType) {
  const caps = TASK_ROUTING[taskType] || ['general'];

  // If offline task — prefer local
  if (caps.includes('offline')) {
    const local = FALLBACK_CHAIN.find(m => MODEL_REGISTRY[m]?.type === 'local' && checkAvailable(m));
    if (local) return local;
  }

  // Find best available model with needed capability
  for (const modelId of FALLBACK_CHAIN) {
    const info = MODEL_REGISTRY[modelId];
    if (!info) continue;
    if (!checkAvailable(modelId)) continue;
    if (caps.some(cap => info.caps.includes(cap))) return modelId;
  }

  return primaryModel;
}

function checkAvailable(modelId) {
  const info = MODEL_REGISTRY[modelId];
  if (!info) return false;
  if (info.type === 'local') {
    const name = modelId.replace('ollama/', '');
    return detectedOllamaModels.some(m => m.name?.includes(name) || m.model?.includes(name));
  }
  if (!info.credKey) return true;
  return !!getCredential(info.credKey);
}

async function refreshOllamaModels() {
  try {
    const data = await httpGet('http://localhost:11434/api/tags');
    const parsed = JSON.parse(data);
    detectedOllamaModels = parsed.models || [];
  } catch {
    detectedOllamaModels = [];
  }
}

// ─── Chat completion per provider ─────────────────────────────────────────────
async function chatCompletion(messages, modelId) {
  const info = MODEL_REGISTRY[modelId];
  if (!info) throw new Error(`Unknown model: ${modelId}`);

  switch (info.provider) {
    case 'openai':    return openaiChat(messages, modelId, info);
    case 'anthropic': return anthropicChat(messages, modelId, info);
    case 'gemini':    return geminiChat(messages, modelId, info);
    case 'mistral':   return mistralChat(messages, modelId, info);
    case 'groq':      return groqChat(messages, modelId, info);
    case 'ollama':    return ollamaChat(messages, modelId.replace('ollama/', ''));
    default:          throw new Error(`Unsupported provider: ${info.provider}`);
  }
}

async function openaiChat(messages, modelId, info) {
  const apiKey = getCredential(info.credKey);
  if (!apiKey) throw new Error('OpenAI API key not set');
  const body = JSON.stringify({ model: modelId, messages, max_tokens: 4096 });
  const data = await httpsPost('api.openai.com', '/v1/chat/completions', body, {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type':  'application/json',
  });
  const parsed = JSON.parse(data);
  if (parsed.error) throw new Error(parsed.error.message);
  return { content: parsed.choices[0].message.content, usage: parsed.usage };
}

async function anthropicChat(messages, modelId, info) {
  const apiKey = getCredential(info.credKey);
  if (!apiKey) throw new Error('Anthropic API key not set');
  // Convert OpenAI format to Anthropic format
  const system  = messages.find(m => m.role === 'system')?.content || '';
  const msgs    = messages.filter(m => m.role !== 'system');
  const body    = JSON.stringify({ model: modelId, system, messages: msgs, max_tokens: 4096 });
  const data    = await httpsPost('api.anthropic.com', '/v1/messages', body, {
    'x-api-key':        apiKey,
    'anthropic-version':'2023-06-01',
    'Content-Type':     'application/json',
  });
  const parsed = JSON.parse(data);
  if (parsed.error) throw new Error(parsed.error.message);
  return { content: parsed.content[0].text, usage: parsed.usage };
}

async function geminiChat(messages, modelId, info) {
  const apiKey = getCredential(info.credKey);
  if (!apiKey) throw new Error('Gemini API key not set');
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body = JSON.stringify({ contents });
  const data = await httpsPost(
    'generativelanguage.googleapis.com',
    `/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
    body,
    { 'Content-Type': 'application/json' }
  );
  const parsed = JSON.parse(data);
  if (parsed.error) throw new Error(parsed.error.message);
  return { content: parsed.candidates[0].content.parts[0].text };
}

async function mistralChat(messages, modelId, info) {
  const apiKey = getCredential(info.credKey);
  if (!apiKey) throw new Error('Mistral API key not set');
  const body = JSON.stringify({ model: modelId, messages });
  const data = await httpsPost('api.mistral.ai', '/v1/chat/completions', body, {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type':  'application/json',
  });
  const parsed = JSON.parse(data);
  if (parsed.error) throw new Error(parsed.error.message || JSON.stringify(parsed.error));
  return { content: parsed.choices[0].message.content };
}

async function groqChat(messages, modelId, info) {
  const apiKey = getCredential(info.credKey);
  if (!apiKey) throw new Error('Groq API key not set');
  const groqModel = modelId.replace('-groq', '');
  const body = JSON.stringify({ model: groqModel, messages });
  const data = await httpsPost('api.groq.com', '/openai/v1/chat/completions', body, {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type':  'application/json',
  });
  const parsed = JSON.parse(data);
  if (parsed.error) throw new Error(parsed.error.message);
  return { content: parsed.choices[0].message.content };
}

async function ollamaChat(messages, modelName) {
  const body = JSON.stringify({ model: modelName, messages, stream: false });
  const data = await httpPost('localhost', 11434, '/api/chat', body);
  const parsed = JSON.parse(data);
  if (parsed.error) throw new Error(parsed.error);
  return { content: parsed.message?.content || '' };
}

// ─── Credential need analysis ─────────────────────────────────────────────────
function analyzeCredentialNeeds(taskDescription) {
  const desc  = taskDescription.toLowerCase();
  const needs = [];

  if ((desc.includes('search') || desc.includes('web') || desc.includes('internet')) && !getCredential('OPENAI_API_KEY')) {
    needs.push({ service: 'OPENAI_API_KEY', label: 'OpenAI API Key', url: 'https://platform.openai.com/api-keys', reason: 'AI-powered web result analysis' });
  }
  if (desc.includes('news') && !getCredential('NEWSAPI_KEY')) {
    needs.push({ service: 'NEWSAPI_KEY', label: 'NewsAPI Key', url: 'https://newsapi.org/register', reason: 'Real-time news articles' });
  }
  if ((desc.includes('stock') || desc.includes('market') || desc.includes('finance')) && !getCredential('ALPHA_VANTAGE_KEY')) {
    needs.push({ service: 'ALPHA_VANTAGE_KEY', label: 'Alpha Vantage API Key', url: 'https://www.alphavantage.co/support/#api-key', reason: 'Stock market data' });
  }
  if (desc.includes('github') && !getCredential('GITHUB_TOKEN')) {
    needs.push({ service: 'GITHUB_TOKEN', label: 'GitHub Personal Access Token', url: 'https://github.com/settings/tokens', reason: 'GitHub repository operations' });
  }
  if (desc.includes('email') && !getCredential('GMAIL_REFRESH_TOKEN')) {
    needs.push({ service: 'GMAIL_REFRESH_TOKEN', label: 'Gmail OAuth Token', url: 'https://console.cloud.google.com/', reason: 'Email access and management' });
  }

  return needs;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
// Thin adapters over electron/lib/http.cjs — the single main-process HTTP client
// (circuit breaker, retry/backoff, 429 handling, 10MB response cap).
// Signatures are unchanged so provider functions above stay untouched.

/** POST to an HTTPS provider endpoint. Returns the raw response body string. */
async function httpsPost(hostname, path, body, headers) {
  const res = await net.request(`https://${hostname}${path}`, {
    method: 'POST', body, headers, timeout: 60000, retries: 1,
  });
  // Providers return structured error JSON on 4xx — pass the body through so the
  // caller can surface the real provider message instead of a bare status code.
  if (res.body) return res.body;
  throw new Error(res.error || `HTTP ${res.status}`);
}

/** POST to a local (plain HTTP) endpoint — Ollama. Long timeout, no retry. */
async function httpPost(hostname, port, path, body) {
  const res = await net.request(`http://${hostname}:${port}${path}`, {
    method: 'POST', body, timeout: 120000, retries: 0,
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.body) return res.body;
  throw new Error(res.error || `Ollama HTTP ${res.status}`);
}

/** GET a local endpoint — Ollama model discovery. Fast fail, no retry. */
async function httpGet(url) {
  const res = await net.get(url, { timeout: 5000, retries: 0 });
  if (res.ok) return res.body;
  throw new Error(res.error || `HTTP ${res.status}`);
}

module.exports = { register, selectModel, chatCompletion, checkAvailable, MODEL_REGISTRY };
