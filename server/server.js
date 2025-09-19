// server.js — Express mediator for Context7 -> Gemini
import express from 'express';

const app = express();
app.use(express.json({ limit: '1mb' }));

// CONFIG (set these in Render env variables)
const PORT = Number(process.env.PORT || 3000);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || 'https://ai4pwa.github.io/i'; // change if you use a custom GH pages URL
const CONTEXT7_URL = process.env.CONTEXT7_URL || 'https://mcp.context7.com/mcp';
const CONTEXT7_KEY = process.env.CONTEXT7_API_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Simple CORS (allow only your GitHub Pages origin)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Health endpoint (use for uptime pings)
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Simple in-memory cache for Context7 docs: { key -> { text, ts } }
const docsCache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

function nowId(){ return `${Date.now()}`; }

async function callContext7Tool(toolName, args = {}) {
  const body = {
    jsonrpc: "2.0",
    id: nowId(),
    method: "tools/call",
    params: { name: toolName, arguments: args }
  };

  const resp = await fetch(CONTEXT7_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Context7 hosted endpoint recognizes this header for auth (set in Render env)
      'CONTEXT7_API_KEY': CONTEXT7_KEY
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Context7 HTTP ${resp.status}: ${txt}`);
  }
  const j = await resp.json();
  if (j.error) throw new Error(`Context7 error: ${JSON.stringify(j.error)}`);
  return j.result;
}

function extractTextFromMcpResult(result) {
  if (!result) return '';
  if (result.structuredContent) {
    try { return JSON.stringify(result.structuredContent, null, 2); } catch {}
  }
  const parts = (result.content || []).map(c => (c && c.text) ? c.text : (typeof c === 'string' ? c : ''));
  return parts.join('\n\n');
}

async function fetchDocsForLibrary(libraryName, topic=null, tokenLimit=8000) {
  const cacheKey = `${libraryName}|${topic||''}`;
  const cached = docsCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) return cached.text;

  // 1) Resolve library id
  const r = await callContext7Tool('resolve-library-id', { libraryName });
  // attempt to extract id if available
  let libraryId = null;
  if (r.structuredContent && r.structuredContent.id) libraryId = r.structuredContent.id;
  else if (r.content && r.content.length && r.content[0].text) {
    libraryId = r.content[0].text.trim().split('\n')[0];
  } else {
    libraryId = libraryName;
  }

  // 2) fetch docs
  const docsRes = await callContext7Tool('get-library-docs', {
    context7CompatibleLibraryID: libraryId,
    topic: topic || undefined,
    tokens: tokenLimit
  });
  const docsText = extractTextFromMcpResult(docsRes);
  docsCache.set(cacheKey, { text: docsText, ts: Date.now() });
  return docsText;
}

async function callGemini(prompt) {
  if (!GEMINI_KEY) throw new Error('No GEMINI_API_KEY set on server');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
  const body = {
    contents: [
      { role: 'system', parts: [{ text: "You are an expert coding assistant. Use the documentation below as authoritative." }] },
      { role: 'user', parts: [{ text: prompt }] }
    ],
    temperature: 0.0,
    maxOutputTokens: 1024
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await resp.json();
  if (data?.candidates && data.candidates.length) {
    const c = data.candidates[0];
    let text = '';
    if (c?.content && Array.isArray(c.content)) {
      for (const block of c.content) {
        if (block?.parts && Array.isArray(block.parts)) {
          for (const p of block.parts) {
            if (p?.text) text += p.text;
          }
        } else if (block?.text) {
          text += block.text;
        }
      }
    }
    if (!text && c?.outputText) text = c.outputText;
    if (text) return text;
  }
  if (data?.outputText) return data.outputText;
  throw new Error('Gemini returned unexpected shape: ' + JSON.stringify(data).slice(0, 1000));
}

// Main API: browser posts here
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message, projectContext = '', libraries = [], topic } = req.body || {};
    if (!message) return res.status(400).json({ error: 'missing message' });

    let docsBlock = '';
    if (Array.isArray(libraries) && libraries.length) {
      try {
        const lib = libraries[0];
        const docsText = await fetchDocsForLibrary(lib, topic || null, 10000);
        if (docsText && docsText.trim().length) {
          docsBlock = `=== CONTEXT7 DOCS FOR ${lib} ===\n${docsText}\n=== END DOCS ===\n\n`;
        }
      } catch (e) {
        console.error('Context7 fetch error', e?.message || e);
      }
    }

    const finalPrompt = [
      docsBlock,
      '=== PROJECT CONTEXT ===',
      projectContext || '(no project context provided)',
      '\n=== USER QUESTION ===',
      message
    ].join('\n\n');

    const reply = await callGemini(finalPrompt);
    return res.json({ reply });
  } catch (err) {
    console.error('AI chat error', err?.message || err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`Mediator listening on port ${PORT} (ALLOW_ORIGIN=${ALLOW_ORIGIN})`);
});
