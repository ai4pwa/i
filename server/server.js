// server.js
// Express mediator: Context7 (MCP) -> Gemini (server-side) for your web app.
// Node 18+ assumed (global fetch available). Keep API keys in Render env vars.

import express from 'express';

const app = express();
app.use(express.json({ limit: '2mb' }));

// ---------- Configuration ----------
const PORT = Number(process.env.PORT || 3000);

// CORS: use ALLOWED_ORIGINS (comma-separated) or ALLOW_ORIGIN single value; for quick testing RAW_ALLOWED='*'
const RAW_ALLOWED = process.env.ALLOWED_ORIGINS || process.env.ALLOW_ORIGIN || '';
const ALLOWED_ORIGINS = RAW_ALLOWED.split(',').map(s => s.trim()).filter(Boolean);

// Context7
const CONTEXT7_URL = process.env.CONTEXT7_URL || 'https://mcp.context7.com/mcp';
const CONTEXT7_KEY = process.env.CONTEXT7_API_KEY || '';

// Gemini
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Cache for docs: cacheKey => { text, ts }
const docsCache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

function nowId() {
  return `${Date.now()}`;
}

// ---------- CORS middleware (whitelist-aware) ----------
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.length) {
    if (ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    // else: omit header -> browser will block
  } else if (RAW_ALLOWED === '*') {
    // wildcard (only for testing)
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- Basic routes ----------
app.get('/', (req, res) => {
  res.send('AI Mediator is running. Use /health for JSON status and POST /api/ai/chat for the API.');
});
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---------- Context7 helpers ----------
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
  const parts = (result.content || []).map(c => {
    if (c && typeof c.text === 'string') return c.text;
    if (typeof c === 'string') return c;
    return '';
  });
  return parts.join('\n\n');
}

async function fetchDocsForLibrary(libraryName, topic = null, tokenLimit = 8000) {
  const cacheKey = `${libraryName}|${topic || ''}`;
  const cached = docsCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.text;
  }

  // Resolve library id
  const resolved = await callContext7Tool('resolve-library-id', { libraryName });
  let libraryId = libraryName;
  if (resolved) {
    if (resolved.structuredContent && resolved.structuredContent.id) libraryId = resolved.structuredContent.id;
    else if (Array.isArray(resolved.content) && resolved.content.length && resolved.content[0].text) libraryId = resolved.content[0].text.trim().split('\n')[0] || libraryName;
  }

  // Get docs
  const docsRes = await callContext7Tool('get-library-docs', {
    context7CompatibleLibraryID: libraryId,
    topic: topic || undefined,
    tokens: tokenLimit
  });

  const docsText = extractTextFromMcpResult(docsRes);
  docsCache.set(cacheKey, { text: docsText, ts: Date.now() });
  return docsText;
}

// Optional endpoint to inspect cached docs (read-only)
// GET /api/docs?lib=<libraryName>
app.get('/api/docs', (req, res) => {
  const lib = req.query.lib;
  if (!lib) return res.status(400).send('missing lib query');
  const prefix = `${lib}|`;
  for (const [k, v] of docsCache.entries()) {
    if (k.startsWith(prefix)) {
      res.type('text').send(v.text);
      return;
    }
  }
  res.status(404).send('no cached docs for ' + lib);
});

// ---------- Gemini helper (robust extractor) ----------
async function callGemini(prompt) {
  if (!GEMINI_KEY) throw new Error('No GEMINI_API_KEY set on server');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;

  // Put preamble into user role (endpoint accepts only user/model)
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

  // Helper: extract text from many possible candidate shapes
  function extractTextFromCandidate(c) {
    if (!c) return '';

    if (typeof c.outputText === 'string' && c.outputText.trim()) return c.outputText;

    if (Array.isArray(c.content)) {
      let acc = '';
      for (const block of c.content) {
        if (typeof block === 'string') acc += block;
        else if (block && Array.isArray(block.parts)) for (const p of block.parts) if (p && typeof p.text === 'string') acc += p.text;
        else if (block && typeof block.text === 'string') acc += block.text;
      }
      if (acc.trim()) return acc;
    }

    if (c.content && typeof c.content === 'object') {
      if (Array.isArray(c.content.parts)) {
        let acc = '';
        for (const p of c.content.parts) if (p && typeof p.text === 'string') acc += p.text;
        if (acc.trim()) return acc;
      }
      if (Array.isArray(c.content.content)) {
        let acc = '';
        for (const blk of c.content.content) {
          if (Array.isArray(blk.parts)) for (const p of blk.parts) if (p && typeof p.text === 'string') acc += p.text;
          else if (typeof blk.text === 'string') acc += blk.text;
        }
        if (acc.trim()) return acc;
      }
      if (typeof c.content.text === 'string' && c.content.text.trim()) return c.content.text;
    }

    if (c.output) {
      if (typeof c.output === 'string' && c.output.trim()) return c.output;
      if (Array.isArray(c.output)) {
        for (const o of c.output) {
          if (typeof o === 'string' && o.trim()) return o;
          if (o && Array.isArray(o.parts)) {
            let acc = '';
            for (const p of o.parts) if (p && typeof p.text === 'string') acc += p.text;
            if (acc.trim()) return acc;
          }
        }
      }
    }

    return '';
  }

  // 1) candidates
  if (Array.isArray(data?.candidates) && data.candidates.length) {
    const c = data.candidates[0];
    const txt = extractTextFromCandidate(c);
    if (txt) return txt;
  }

  // 2) top-level outputText
  if (typeof data.outputText === 'string' && data.outputText.trim()) return data.outputText;

  // 3) data.output fallback
  if (data?.output) {
    if (typeof data.output === 'string' && data.output.trim()) return data.output;
    if (Array.isArray(data.output)) {
      for (const o of data.output) {
        if (typeof o === 'string' && o.trim()) return o;
        if (o && Array.isArray(o.parts)) {
          let acc = '';
          for (const p of o.parts) if (p && typeof p.text === 'string') acc += p.text;
          if (acc.trim()) return acc;
        }
        if (o && typeof o.text === 'string' && o.text.trim()) return o.text;
      }
    }
  }

  // nothing matched
  throw new Error('Gemini returned unexpected shape: ' + JSON.stringify(data || {}));
}

// ---------- Main API endpoint (with per-request debug) ----------
app.post('/api/ai/chat', async (req, res) => {
  try {
    const {
      message,
      projectContext = '',
      libraries = [],
      topic,
      systemInstructions = '',
      debug = false
    } = req.body || {};

    if (!message) return res.status(400).json({ error: 'missing message' });

    // debug container
    const debugInfo = { docsUsed: [], docsSnippet: null, promptSent: null, context7Error: null };

    // 1) fetch docs for each requested library (append all to prompt)
    let docsBlock = '';
    if (Array.isArray(libraries) && libraries.length) {
      for (const lib of libraries) {
        try {
          console.log(`Context7: attempting to fetch library '${lib}'`);
          const docsText = await fetchDocsForLibrary(lib, topic || null, 10000);
          if (docsText && docsText.trim()) {
            docsBlock += `=== CONTEXT7 DOCS FOR ${lib} ===\n${docsText}\n=== END DOCS ===\n\n`;
            debugInfo.docsUsed.push(lib);
            if (!debugInfo.docsSnippet) debugInfo.docsSnippet = docsText.slice(0, 2000);
            console.log(`Context7: fetched library '${lib}' (chars=${docsText.length})`);
          } else {
            console.log(`Context7: library '${lib}' returned empty docs`);
          }
        } catch (e) {
          console.error(`Context7 fetch error for ${lib}:`, e?.message || e);
          if (debug) debugInfo.context7Error = String(e?.message || e);
        }
      }
    }

    // 2) Build final prompt: systemInstructions first, then docs, then project context, then user question
    const promptParts = [];
    if (systemInstructions && String(systemInstructions).trim()) {
      promptParts.push('=== SYSTEM INSTRUCTIONS ===\n' + String(systemInstructions).trim() + '\n=== END SYSTEM ===');
    }
    if (docsBlock) promptParts.push(docsBlock);
    promptParts.push('=== PROJECT CONTEXT ===', projectContext || '(no project context provided)');
    promptParts.push('\n=== USER QUESTION ===', message);
    const finalPrompt = promptParts.join('\n\n');

    if (debug) debugInfo.promptSent = finalPrompt.slice(0, 3000); // truncated preview

    // 3) call Gemini
    const reply = await callGemini(finalPrompt);

    // 4) respond; include debug info when requested
    const response = { reply };
    if (debug) response.debug = debugInfo;

    return res.json(response);
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
