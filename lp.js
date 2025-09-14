// lp.js
(function () {
  "use strict";

  const PYODIDE_VERSION = "v0.23.4";
  const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;

  // Ensure a JS array exists to hold proxies (must be a real JS Array so .push works from Pyodide)
  if (!Array.isArray(window._auto_py_proxies)) {
    window._auto_py_proxies = [];
  }

  // On unload: destroy any tracked proxies to avoid leaks
  function destroyAllAutoProxies() {
    try {
      if (!Array.isArray(window._auto_py_proxies)) {
        window._auto_py_proxies = [];
        return;
      }
      for (const p of window._auto_py_proxies) {
        try {
          if (p && typeof p.destroy === "function") {
            p.destroy();
          }
        } catch (e) {
          console.warn("lp.js: failed to destroy proxy", e);
        }
      }
    } catch (e) {
      console.error("lp.js: destroyAllAutoProxies failed:", e);
    } finally {
      window._auto_py_proxies = [];
    }
  }
  window.addEventListener("beforeunload", destroyAllAutoProxies, { passive: true });
  window.addEventListener("pagehide", destroyAllAutoProxies, { passive: true });
  window.addEventListener("unload", destroyAllAutoProxies, { passive: true });

  // ---------------- DOM helpers (no inline styles) ----------------
  function findCurrentScript() {
    // prefer document.currentScript; fallback to last script matching filename
    if (document.currentScript) return document.currentScript;
    const scripts = document.getElementsByTagName("script");
    for (let i = scripts.length - 1; i >= 0; --i) {
      const s = scripts[i];
      if ((s.src || "").indexOf("/lp.js") !== -1) return s;
    }
    return null;
  }

  function getUniqueIdFromScript(scriptEl) {
    if (!scriptEl) return null;
    try {
      const url = new URL(scriptEl.src, location.href);
      const q = url.searchParams.get("unique_id");
      if (q) return q;
    } catch (e) {
      // ignore
    }
    return scriptEl.getAttribute("data-unique-id") || scriptEl.dataset.uniqueId || null;
  }

  // create or reuse root container (semantic class names only)
  function ensureRootDiv(uniqueId, targetSelector) {
    const safeId = String(uniqueId).replace(/[^\w\-]/g, "-");
    const id = `py-root-${safeId}`;
    let root = document.getElementById(id);
    if (root) return root;

    root = document.createElement("div");
    root.id = id;
    root.className = "py-root";

    // structural children (semantic classes)
    const header = document.createElement("div");
    header.className = "py-header";
    header.textContent = "Python runner (client)";

    const status = document.createElement("div");
    status.className = "py-status";
    status.textContent = "Initializing...";

    const output = document.createElement("pre");
    output.className = "py-output";
    output.setAttribute("aria-live", "polite");

    root.appendChild(header);
    root.appendChild(status);
    root.appendChild(output);

    if (targetSelector) {
      try {
        const parent = document.querySelector(targetSelector);
        if (parent) {
          parent.appendChild(root);
          return root;
        }
      } catch (e) {
        // invalid selector => fallback to body
      }
    }
    document.body.appendChild(root);
    return root;
  }

  function makeConsoleRefs(root) {
    return {
      header: root.querySelector(".py-header"),
      status: root.querySelector(".py-status"),
      output: root.querySelector(".py-output"),
    };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve(s);
      s.onerror = (e) => reject(new Error("Failed to load script: " + src));
      document.head.appendChild(s);
    });
  }

  function base64ToString(b64) {
    try {
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const decoder = new TextDecoder("utf-8");
      return decoder.decode(bytes);
    } catch (e) {
      // fallback to plain atob
      return atob(b64);
    }
  }

  // ---------------- read unique id & target ----------------
  const scriptEl = findCurrentScript();
  const uniqueId = getUniqueIdFromScript(scriptEl);
  if (!uniqueId) {
    console.error("lp.js: No unique_id provided (use ?unique_id=... or data-unique-id). Aborting.");
    return;
  }
  const targetSelector = scriptEl ? (scriptEl.getAttribute("data-target") || scriptEl.dataset.target) : null;

  // backend API URL (same pattern your app uses)
  const apiUrl =
    "https://app.base44.com/api/apps/6812ad73a9594a183279deba/entities/DataRecord" +
    "?user_id=user_jveo8b35q_1748241619184" +
    "&payload.unique_id=" +
    encodeURIComponent(uniqueId);

  // ---------------- runner ----------------
  (async function run() {
    const root = ensureRootDiv(uniqueId, targetSelector);
    const refs = makeConsoleRefs(root);
    function setStatus(s) { try { refs.status.textContent = s; } catch (e) {} console.log("lp.js status:", s); }
    function logOut(line) {
      try {
        refs.output.textContent += line + "\n";
        refs.output.scrollTop = refs.output.scrollHeight;
      } catch (e) {}
      console.log("lp.js:", line);
    }

    try {
      setStatus("Fetching Python...");
      const res = await fetch(apiUrl, {
        headers: {
          api_key: "69315aa5aa7f4b6fa99c7a420da68bdd",
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error("Fetch failed: " + res.status + " " + res.statusText);
      const records = await res.json();
      if (!records || !records.length) throw new Error("Python file not found for ID " + uniqueId);

      const file = records[0].payload;
      if (!file || !file.file_content) throw new Error("No file_content in payload");

      const decoded = base64ToString(file.file_content);
      setStatus("Preparing Pyodide...");

      // load pyodide if needed
      if (typeof loadPyodide === "undefined" || !window.pyodide) {
        setStatus("Loading Pyodide runtime...");
        await loadScript(PYODIDE_BASE + "pyodide.js");
        try {
          window.pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });
        } catch (e) {
          throw new Error("loadPyodide() failed: " + (e && e.message ? e.message : e));
        }
      } else {
        logOut("Using cached Pyodide instance");
      }

      setStatus("Installing proxy-tracker...");

      // ensure window._auto_py_proxies is a JS array
      if (!Array.isArray(window._auto_py_proxies)) window._auto_py_proxies = [];

      // Monkey-patch create_proxy and create_once_callable from Python side.
      // This runs BEFORE user's Python code so user imports will get the wrapped functions.
      const proxyPatchCode = `
import pyodide.ffi as _ffi
from js import window

_orig_create_proxy = getattr(_ffi, "create_proxy", None)
_orig_create_once = getattr(_ffi, "create_once_callable", None)

def _auto_create_proxy(fn, *args, **kwargs):
    p = _orig_create_proxy(fn, *args, **kwargs)
    try:
        window._auto_py_proxies.push(p)
    except Exception:
        try:
            window._auto_py_proxies.append(p)
        except Exception:
            pass
    return p

if _orig_create_proxy is not None:
    _ffi.create_proxy = _auto_create_proxy

if _orig_create_once is not None:
    def _auto_create_once(fn, *args, **kwargs):
        p = _orig_create_once(fn, *args, **kwargs)
        try:
            window._auto_py_proxies.push(p)
        except Exception:
            try:
                window._auto_py_proxies.append(p)
            except Exception:
                pass
        return p
    _ffi.create_once_callable = _auto_create_once

# helper: destruction from Python/JS
def _destroy_tracked():
    try:
        for p in list(window._auto_py_proxies):
            try:
                p.destroy()
            except Exception:
                pass
        window._auto_py_proxies = []
    except Exception:
        pass

window.destroy_tracked_proxies = _destroy_tracked
`;
      await window.pyodide.runPythonAsync(proxyPatchCode);
      logOut("Proxy tracker installed.");

      // look for "# requirements: ..." header (install packages if present)
      setStatus("Checking requirements...");
      const reqPattern = /^\s*#\s*requirements\s*:\s*(.*)$/im;
      const m = decoded.match(reqPattern);
      if (m && m[1]) {
        const reqs = m[1].split(",").map(s => s.trim()).filter(Boolean);
        if (reqs.length) {
          setStatus("Installing packages: " + reqs.join(", "));
          logOut("Installing packages: " + reqs.join(", "));
          try {
            await window.pyodide.loadPackage(reqs);
            logOut("Packages installed: " + reqs.join(", "));
          } catch (e) {
            logOut("Package install failed: " + String(e));
          }
        }
      }

      // capture stdout/stderr into the UI via small shim
      await window.pyodide.runPythonAsync(`
import sys
__orig_stdout__ = sys.stdout
__orig_stderr__ = sys.stderr
`);
      window._py_log = function (s) {
        try {
          const txt = (typeof s === "string") ? s : JSON.stringify(s);
          logOut("[py] " + txt);
        } catch (e) {
          logOut("[py] (log error) " + String(s));
        }
      };
      await window.pyodide.runPythonAsync(`
import sys
from js import _py_log
class StdOutCatch:
    def write(self, s):
        if s is None: return
        _py_log(s)
    def flush(self): pass
sys.stdout = StdOutCatch()
sys.stderr = StdOutCatch()
`);

      // run user's Python code
      setStatus("Running Python...");
      try {
        const result = await window.pyodide.runPythonAsync(decoded);
        if (typeof result !== "undefined" && result !== null) {
          logOut("[py] <result> " + String(result));
        } else {
          logOut("[py] Program finished (no return).");
        }
        setStatus("Python finished successfully.");
      } catch (pyErr) {
        console.error("lp.js: Python runtime error:", pyErr);
        logOut("[py error] " + (pyErr && pyErr.message ? pyErr.message : String(pyErr)));
        setStatus("Python execution error (see output).");
      } finally {
        // restore stdout/stderr
        await window.pyodide.runPythonAsync(`
import sys
try:
    sys.stdout = __orig_stdout__
    sys.stderr = __orig_stderr__
except Exception:
    pass
del __orig_stdout__, __orig_stderr__
`);
      }
    } catch (err) {
      console.error("lp.js: Loader error:", err);
      setStatus("Failed to load/run Python: " + ((err && err.message) ? err.message : String(err)));
      try {
        const out = root.querySelector(".py-output");
        if (out) out.textContent += "\n[loader] " + String(err) + "\n";
      } catch (e) {}
    }
  })();

})();
