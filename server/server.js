// server.js
// Express mediator: Context7 (MCP) -> Gemini (server-side) for your web app.
// Node 18+ assumed (global fetch available). Keep API keys in Render env vars.

import express from 'express';

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------- Configuration from environment ----------
const PORT = Number(process.env.PORT || 3000);

// CORS config: support a comma-separated ALLOWED_ORIGINS or a single ALLOW_ORIGIN.
// Example: ALLOWED_ORIGINS="https://ai4pwa.github.io,https://localhost:3000"
const RAW_ALLOWED = process.env.ALLOWED_ORIGINS || process.env.ALLOW_ORIGIN || '';
const ALLOWED_ORIGINS = RAW_ALLOWED.split(',').map(s => s.trim()).filter(Boolean);

// Context7 MCP endpoint & key
const CONTEXT7_URL = process.env.CONTEXT7_URL || 'https://mcp.context7.com/mcp';
const CONTEXT7_KEY = process.env.CONTEXT7_API_KEY || '';

// Gemini config
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Simple in-memory cache for fetched docs: { key -> { text, ts } }
const docsCache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

function nowId() { return `${Date.now()}`; }

// ---------- CORS middleware (whitelist-aware) ----------
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.length) {
    if (ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } // else: do not set allow-origin; browser will block
  } else if (RAW_ALLOWED === '*') {
    // wildcard mode (use only for quick testing)
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  // else: if no allowed origins configured, we omit Access-Control-Allow-Origin (safer)

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- Basic routes ----------
app.get('/', (req, res) => {
  res.send('AI Mediator is running. Use /health for JSON status and POST /api/ai/chat for the API.');
});

app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ---------- Context7 MCP helper ----------
async function callContext7Tool(toolName, args = {}) {
  const body = {
    jsonrpc: "2.0",
    id: nowId(),
    method: "tools/call",
    params: { name: toolName, arguments: args }
  };

  const headers = { 'Content-Type': 'application/json' };
  if (CONTEXT7_KEY) headers['CONTEXT7_API_KEY'] = CONTEXT7_KEY;

  const resp = await fetch(CONTEXT7_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Context7 HTTP ${resp.status}: ${txt}`);
  }
  const j = await resp.json().catch(() => null);
  if (!j) throw new Error('Context7 returned non-JSON response');
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

async function fetchDocsForLibrary(libraryName, topic = null, tokenLimit = 8000) {
  const cacheKey = `${libraryName}|${topic || ''}`;
  const cached = docsCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) return cached.text;

  // 1) resolve library id
  const resolved = await callContext7Tool('resolve-library-id', { libraryName });
  let libraryId = libraryName;
  if (resolved) {
    if (resolved.structuredContent && resolved.structuredContent.id) {
      libraryId = resolved.structuredContent.id;
    } else if (Array.isArray(resolved.content) && resolved.content.length && resolved.content[0].text) {
      libraryId = resolved.content[0].text.trim().split('\n')[0] || libraryName;
    }
  }

  // 2) get docs
  const docsRes = await callContext7Tool('get-library-docs', {
    context7CompatibleLibraryID: libraryId,
    topic: topic || undefined,
    tokens: tokenLimit
  });

  const docsText = extractTextFromMcpResult(docsRes);
  docsCache.set(cacheKey, { text: docsText, ts: Date.now() });
  return docsText;
}

// ---------- Gemini call helper (use only allowed roles: 'user' and optional 'model') ----------
async function callGemini(prompt) {
  if (!GEMINI_KEY) throw new Error('No GEMINI_API_KEY set on server');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;

  // The endpoint accepts only 'user' and 'model' roles for 'contents' — put the preamble inside the user text.
  const systemPreamble = "You are an expert coding assistant. Use the documentation below as authoritative.";
  const combinedText = `${systemPreamble}\n\n${prompt}`;

  const body = {
    contents: [
      { role: 'user', parts: [{ text: combinedText }] }
    ]
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    const txt = await resp.text().catch(() => '');
    throw new Error('Failed to parse Gemini response: ' + (txt || e.message));
  }

  // 1) old-style candidates
  if (data?.candidates && Array.isArray(data.candidates) && data.candidates.length) {
    const c = data.candidates[0];
    let text = '';
    if (Array.isArray(c.content)) {
      for (const block of c.content) {
        if (Array.isArray(block.parts)) {
          for (const p of block.parts) {
            if (typeof p.text === 'string') text += p.text;
          }
        } else if (typeof block.text === 'string') {
          text += block.text;
        }
      }
    }
    if (!text && typeof c.outputText === 'string') text = c.outputText;
    if (text) return text;
  }

  // 2) top-level outputText
  if (typeof data.outputText === 'string' && data.outputText.trim()) return data.outputText;

  // 3) try other likely shapes
  try {
    if (data?.output) {
      if (typeof data.output === 'string' && data.output.trim()) return data.output;
      if (Array.isArray(data.output)) {
        for (const o of data.output) {
          if (typeof o === 'string' && o.trim()) return o;
          if (o?.content && Array.isArray(o.content)) {
            let acc = '';
            for (const blk of o.content) {
              if (blk?.text) acc += blk.text;
              if (Array.isArray(blk?.parts)) {
                for (const p of blk.parts) if (p?.text) acc += p.text;
              }
            }
            if (acc.trim()) return acc;
          }
        }
      }
    }
  } catch (e) {
    // fallthrough
  }

  // final fallback: show full response for debugging
  throw new Error('Gemini returned unexpected shape: ' + JSON.stringify(data || {}));
}

// ---------- Main API endpoint ----------
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
        console.error('Context7 fetch error:', e?.message || e);
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
    console.error('AI chat error:', err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`Mediator listening on port ${PORT}`);
  console.log(`Allowed origins: ${RAW_ALLOWED || '(none configured)'} | Context7 URL: ${CONTEXT7_URL}`);
});
