// server.js
// Express mediator: Context7 (v1 REST search + docs, with MCP fallback) -> Gemini (server-side)
// Node 18+ assumed (global fetch available). Keep API keys in Render env vars.

import express from 'express';

const app = express();
app.use(express.json({ limit: '2mb' }));

// ---------- Configuration ----------
const PORT = Number(process.env.PORT || 3000);

// CORS: use ALLOWED_ORIGINS (comma-separated) or ALLOW_ORIGIN single value; for quick testing set RAW_ALLOWED='*'
const RAW_ALLOWED = process.env.ALLOWED_ORIGINS || process.env.ALLOW_ORIGIN || '';
const ALLOWED_ORIGINS = RAW_ALLOWED.split(',').map(s => s.trim()).filter(Boolean);

// Context7 config
const CONTEXT7_API_BASE = process.env.CONTEXT7_API_BASE || 'https://context7.com/api/v1';
const CONTEXT7_MCP_URL = process.env.CONTEXT7_MCP_URL || 'https://mcp.context7.com/mcp';
const CONTEXT7_KEY = process.env.CONTEXT7_API_KEY || '';

// Gemini config
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Cache for docs: cacheKey => { text, ts }
const docsCache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

function nowId() { return `${Date.now()}`; }

// ---------- CORS middleware ----------
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.length) {
    if (ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  } else if (RAW_ALLOWED === '*') {
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

// ---------- Context7 v1 REST helpers (search + get docs) ----------
async function searchContext7Library(query) {
  const url = `${CONTEXT7_API_BASE}/search?query=${encodeURIComponent(query)}`;
  const headers = { 'Accept': 'application/json' };
  if (CONTEXT7_KEY) headers['Authorization'] = `Bearer ${CONTEXT7_KEY}`;

  const resp = await fetch(url, { method: 'GET', headers });
  const text = await resp.text().catch(() => '');
  if (!resp.ok) {
    console.error('Context7 /search failed', { status: resp.status, bodyPreview: text.slice(0, 2000) });
    throw new Error(`Context7 search failed ${resp.status}: ${text.slice(0,1000)}`);
  }
  try {
    const j = JSON.parse(text);
    return j.results || [];
  } catch (e) {
    console.error('Context7 /search returned non-JSON', { bodyPreview: text.slice(0,2000) });
    throw new Error('Context7 search returned non-JSON response');
  }
}

async function getContext7DocsById(id, { type = 'txt', topic = null, tokens = 5000 } = {}) {
  let path = String(id || '').trim();
  if (!path) throw new Error('Invalid Context7 id');
  path = path.replace(/\/documentation$/, '');
  if (!path.startsWith('/')) path = '/' + path;

  const params = new URLSearchParams();
  params.set('type', type);
  if (topic) params.set('topic', topic);
  if (tokens) params.set('tokens', String(tokens));

  const url = `${CONTEXT7_API_BASE}${path}?${params.toString()}`;
  const headers = { 'Accept': type === 'txt' ? 'text/plain, application/json' : 'application/json' };
  if (CONTEXT7_KEY) headers['Authorization'] = `Bearer ${CONTEXT7_KEY}`;

  const resp = await fetch(url, { method: 'GET', headers });
  const bodyText = await resp.text().catch(() => '');
  if (!resp.ok) {
    console.error('Context7 docs fetch failed', { url, status: resp.status, bodyPreview: bodyText.slice(0, 2000) });
    throw new Error(`Context7 docs fetch failed ${resp.status}: ${bodyText.slice(0, 1000)}`);
  }

  if (type === 'txt') {
    return bodyText || '';
  } else {
    try {
      return JSON.parse(bodyText);
    } catch (e) {
      console.error('Context7 docs returned non-JSON for json type', { url, bodyPreview: bodyText.slice(0,2000) });
      throw new Error('Context7 docs returned non-JSON body for json type');
    }
  }
}

// ---------- MCP RPC fallback helper (robust: handles JSON and SSE) ----------
async function callContext7Tool(toolName, args = {}) {
  const body = {
    jsonrpc: "2.0",
    id: nowId(),
    method: "tools/call",
    params: { name: toolName, arguments: args }
  };

  const resp = await fetch(process.env.CONTEXT7_MCP_URL || CONTEXT7_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...(CONTEXT7_KEY ? { 'CONTEXT7_API_KEY': CONTEXT7_KEY } : {})
    },
    body: JSON.stringify(body)
  });

  const contentType = (resp.headers.get('content-type') || '').toLowerCase();

  if (!resp.ok) {
    let respText = '';
    try { respText = await resp.text(); } catch (e) { respText = `<failed to read body: ${e.message}>`; }
    const respHeaders = {};
    try { for (const [k, v] of resp.headers.entries()) respHeaders[k] = v; } catch (e) { respHeaders._err = e.message; }

    console.error('Context7 MCP call failed', {
      url: process.env.CONTEXT7_MCP_URL || CONTEXT7_MCP_URL,
      status: resp.status,
      statusText: resp.statusText,
      requestHeaders: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      responseHeaders: respHeaders,
      responseBodyPreview: typeof respText === 'string' ? respText.slice(0, 4000) : String(respText)
    });

    throw new Error(`Context7 MCP HTTP ${resp.status}: ${String(respText).slice(0, 2000)}`);
  }

  if (contentType.includes('application/json')) {
    const j = await resp.json().catch(() => null);
    if (!j) {
      const txt = await resp.text().catch(() => '');
      console.error('Context7 MCP returned non-JSON despite JSON content-type', { bodyPreview: txt.slice(0, 2000) });
      throw new Error('Context7 MCP returned non-JSON response');
    }
    if (j.error) {
      console.error('Context7 MCP returned error payload (200):', j.error);
      throw new Error(`Context7 MCP error: ${JSON.stringify(j.error)}`);
    }
    return j.result;
  }

  if (contentType.includes('text/event-stream')) {
    const txt = await resp.text().catch(() => '');
    const events = txt.split(/\n\n+/);
    let lastData = null;
    for (const ev of events) {
      const lines = ev.split(/\n/);
      for (const line of lines) {
        const m = line.match(/^data:\s?(.*)$/);
        if (m) lastData = (lastData ? lastData + '\n' : '') + m[1];
      }
    }
    if (!lastData) {
      console.error('Context7 MCP SSE returned but no data lines', { preview: txt.slice(0,2000) });
      throw new Error('Context7 MCP returned event-stream with no data');
    }
    try {
      const parsed = JSON.parse(lastData);
      if (parsed.error) {
        console.error('Context7 MCP SSE data contained error', parsed.error);
        throw new Error(`Context7 MCP error (SSE): ${JSON.stringify(parsed.error)}`);
      }
      return parsed.result || parsed;
    } catch (e) {
      console.error('Context7 MCP SSE data is not valid JSON', { dataPreview: lastData.slice(0,2000), parseError: e.message });
      throw new Error('Context7 MCP returned event-stream whose data is not parseable JSON');
    }
  }

  const txt = await resp.text().catch(() => '');
  try {
    const j = JSON.parse(txt);
    if (j.error) {
      console.error('Context7 MCP fallback returned error object', j.error);
      throw new Error(`Context7 MCP error: ${JSON.stringify(j.error)}`);
    }
    return j.result;
  } catch (e) {
    console.error('Context7 MCP returned unknown content-type and non-JSON body', { contentType, bodyPreview: txt.slice(0,2000) });
    throw new Error('Context7 MCP returned non-JSON response');
  }
}

// ---------- fetchDocsForLibrary: try v1 REST API first; fallback to MCP RPC ----------
async function fetchDocsForLibrary(libraryName, topic = null, tokenLimit = 8000) {
  const cacheKey = `${libraryName}|${topic || ''}`;
  const cached = docsCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) return cached.text;

  // 1) Try v1 REST API: search -> pick best result -> fetch docs (txt)
  try {
    console.log('Context7: searching for library via v1 API:', libraryName);
    const results = await searchContext7Library(libraryName);
    if (Array.isArray(results) && results.length) {
      let chosen = results[0];
      const lower = libraryName.toLowerCase();
      const found = results.find(r =>
        (r.id && r.id.toLowerCase().includes(lower)) ||
        (r.title && r.title.toLowerCase().includes(lower))
      );
      if (found) chosen = found;

      const libId = chosen.id;
      try {
        console.log('Context7: fetching docs for id via v1 API:', libId);
        const docsText = await getContext7DocsById(libId, { type: 'txt', topic, tokens: tokenLimit });
        if (docsText && docsText.trim()) {
          docsCache.set(cacheKey, { text: docsText, ts: Date.now() });
          return docsText;
        } else {
          console.log('Context7 v1 returned empty docs text for', libId);
        }
      } catch (e) {
        console.error('Context7 v1 docs fetch error for', libId, e?.message || e);
      }
    } else {
      console.log('Context7 v1 search returned no results for', libraryName);
    }
  } catch (e) {
    console.error('Context7 v1 search error:', e?.message || e);
  }

  // 2) Fallback to MCP RPC (resolve-library-id + get-library-docs)
  try {
    console.log('Context7: attempting MCP fallback for library:', libraryName);
    const resolved = await callContext7Tool('resolve-library-id', { libraryName });
    let libraryId = libraryName;
    if (resolved) {
      if (resolved.structuredContent && resolved.structuredContent.id) {
        libraryId = resolved.structuredContent.id;
      } else if (Array.isArray(resolved.content) && resolved.content.length && resolved.content[0].text) {
        libraryId = resolved.content[0].text.trim().split('\n')[0] || libraryName;
      }
    }

    const docsRes = await callContext7Tool('get-library-docs', {
      context7CompatibleLibraryID: libraryId,
      topic: topic || undefined,
      tokens: tokenLimit
    });

    const docsText = (function extractTextFromMcpResult(result) {
      if (!result) return '';
      if (result.structuredContent) {
        try { return JSON.stringify(result.structuredContent, null, 2); } catch {}
      }
      const parts = (result.content || []).map(c => (c && typeof c.text === 'string') ? c.text : (typeof c === 'string' ? c : ''));
      return parts.join('\n\n');
    })(docsRes);

    docsCache.set(cacheKey, { text: docsText, ts: Date.now() });
    return docsText;
  } catch (e) {
    console.error('Context7 MCP fallback also failed for', libraryName, e?.message || e);
    return '';
  }
}

// ---------- Gemini helper (robust extractor) ----------
async function callGemini(prompt) {
  if (!GEMINI_KEY) throw new Error('No GEMINI_API_KEY set on server');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;

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
  try { data = await resp.json(); } catch (e) {
    const txt = await resp.text().catch(() => '');
    throw new Error('Failed to parse Gemini response: ' + (txt || e.message));
  }

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

  if (Array.isArray(data?.candidates) && data.candidates.length) {
    const c = data.candidates[0];
    const txt = extractTextFromCandidate(c);
    if (txt) return txt;
  }
  if (typeof data.outputText === 'string' && data.outputText.trim()) return data.outputText;
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
  throw new Error('Gemini returned unexpected shape: ' + JSON.stringify(data || {}));
}

// ---------- API endpoint (with per-request auto-search + debug) ----------
app.post('/api/ai/chat', async (req, res) => {
  try {
    // NOTE: libraries is let because we may replace it with auto-selected ids
    let {
      message,
      projectContext = '',
      libraries = [],
      // auto-search controls — client can send autoSearch:true or autoSearchQuery to trigger auto-search
      autoSearch = false,
      autoSearchQuery = null,
      autoSearchTop = 3,
      topic,
      systemInstructions = '',
      debug = false,
      docTokens // optional: client may pass desired token budget for docs
    } = req.body || {};

    if (!message) return res.status(400).json({ error: 'missing message' });

    // debug container
    const debugInfo = { docsUsed: [], docsSnippet: null, promptSent: null, context7Error: null, autoSelected: null };

    // ---------- AUTO-SEARCH: when libraries not provided, and autoSearch requested ----------
    if ((!Array.isArray(libraries) || libraries.length === 0) && (autoSearch || autoSearchQuery)) {
      const q = (typeof autoSearchQuery === 'string' && autoSearchQuery.trim()) ? autoSearchQuery.trim() : message;
      try {
        const results = await searchContext7Library(q);
        if (Array.isArray(results) && results.length) {
          // pick top N ids (filter truthy ids)
          const topIds = results.slice(0, Math.max(1, Number(autoSearchTop) || 3)).map(r => r.id).filter(Boolean);
          if (topIds.length) {
            libraries = topIds;
            debugInfo.autoSelected = topIds;
            console.log('Context7 auto-selected libraries for query:', q, topIds);
          } else {
            console.log('Context7 auto-search returned results but no ids for query:', q);
          }
        } else {
          console.log('Context7 auto-search returned no results for query:', q);
        }
      } catch (e) {
        console.error('Context7 auto-search failed:', e?.message || e);
        if (debug) debugInfo.context7Error = String(e?.message || e);
      }
    }

    // 1) fetch docs if requested (v1 + fallback)
    let docsBlock = '';
    if (Array.isArray(libraries) && libraries.length) {
      for (const lib of libraries) {
        try {
          // pass docTokens if provided; otherwise default tokenLimit
          const docsText = await fetchDocsForLibrary(lib, topic || null, docTokens || 10000);
          if (docsText && docsText.trim()) {
            docsBlock += `=== CONTEXT7 DOCS FOR ${lib} ===\n${docsText}\n=== END DOCS ===\n\n`;
            debugInfo.docsUsed.push(lib);
            if (!debugInfo.docsSnippet) debugInfo.docsSnippet = docsText.slice(0, 2000);
            console.log(`Context7: attached docs for '${lib}' (chars=${docsText.length})`);
          } else {
            console.log(`Context7: no docs returned for '${lib}'`);
          }
        } catch (e) {
          console.error(`Context7 fetch error for ${lib}:`, e?.message || e);
          if (debug) debugInfo.context7Error = String(e?.message || e);
        }
      }
    }

    // 2) Build prompt
    const promptParts = [];
    if (systemInstructions && String(systemInstructions).trim()) {
      promptParts.push('=== SYSTEM INSTRUCTIONS ===\n' + String(systemInstructions).trim() + '\n=== END SYSTEM ===');
    }
    if (docsBlock) promptParts.push(docsBlock);
    promptParts.push('=== PROJECT CONTEXT ===', projectContext || '(no project context provided)');
    promptParts.push('\n=== USER QUESTION ===', message);
    const finalPrompt = promptParts.join('\n\n');

    if (debug) debugInfo.promptSent = finalPrompt.slice(0, 3000);

    // 3) call Gemini
    const reply = await callGemini(finalPrompt);

    const response = { reply };
    if (debug) response.debug = debugInfo;
    return res.json(response);

  } catch (err) {
    console.error('AI chat error:', err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

// Optional: expose cached docs for debugging
app.get('/api/docs', (req, res) => {
  const lib = req.query.lib;
  if (!lib) return res.status(400).send('missing lib query');
  const prefix = `${lib}|`;
  for (const [k, v] of docsCache.entries()) {
    if (k.startsWith(prefix)) return res.type('text').send(v.text);
  }
  return res.status(404).send('no cached docs for ' + lib);
});

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`Mediator listening on port ${PORT}`);
  console.log(`Allowed origins: ${RAW_ALLOWED || '(none configured)'} | Context7 API base: ${CONTEXT7_API_BASE}`);
});
