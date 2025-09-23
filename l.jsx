(function () {
  console.log("l.jsx: Loader started...");

  // Get unique_id from script src
  const currentScript = document.currentScript;
  const src = currentScript ? currentScript.src : "";
  const uniqueId = new URL(src).searchParams.get("unique_id");

  if (!uniqueId) {
    console.error("l.jsx: No unique_id provided in script src.");
    return;
  }

  const apiUrl =
    "https://app.base44.com/api/apps/6812ad73a9594a183279deba/entities/DataRecord" +
    "?user_id=user_jveo8b35q_1748241619184" +
    "&payload.unique_id=" +
    uniqueId;

  console.log("l.jsx: Fetching JSX from", apiUrl);

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function ensureReactEnv() {
    if (
      typeof React !== "undefined" &&
      typeof ReactDOM !== "undefined" &&
      typeof Babel !== "undefined"
    ) {
      // ensure compatibility alias if loader or generated code expect bare createRoot
      if (typeof window.createRoot === 'undefined' && typeof ReactDOM !== 'undefined' && typeof ReactDOM.createRoot === 'function') {
        try { window.createRoot = ReactDOM.createRoot.bind(ReactDOM); } catch (e) { /* ignore */ }
      }
      return;
    }
    await loadScript("https://unpkg.com/react@18/umd/react.development.js");
    await loadScript("https://unpkg.com/react-dom@18/umd/react-dom.development.js");
    await loadScript("https://unpkg.com/@babel/standalone/babel.min.js");

    // After loading, create compatibility alias so code using bare createRoot works.
    try {
      if (typeof window.createRoot === 'undefined' && typeof ReactDOM !== 'undefined' && typeof ReactDOM.createRoot === 'function') {
        window.createRoot = ReactDOM.createRoot.bind(ReactDOM);
      }
    } catch (e) {
      // fail-safe: do not crash the loader
    }
  }

  function ensureRootDiv() {
    let root = document.getElementById("root");
    if (!root) {
      root = document.createElement("div");
      root.id = "root";
      document.body.appendChild(root);
      console.log("l.jsx: <div id='root'> created automatically.");
    }
    return root;
  }

  async function run() {
    try {
      await ensureReactEnv();
      const root = ensureRootDiv();

      // Show placeholder while loading
      root.innerText = "Loading page...";

      const res = await fetch(apiUrl, {
        headers: {
          api_key: "69315aa5aa7f4b6fa99c7a420da68bdd",
          "Content-Type": "application/json",
        },
      });
      const records = await res.json();
      if (!records.length) throw new Error("JSX not found for ID " + uniqueId);

      const file = records[0].payload;
      const decoded = atob(file.file_content);

      // Transpile JSX → JS
      const transpiled = Babel.transform(decoded, { presets: ["react"], sourceType: "script" }).code;

      // Execute transpiled code (will overwrite placeholder)
      new Function("React", "ReactDOM", transpiled)(React, ReactDOM);

      console.log("l.jsx: JSX executed successfully.");
    } catch (err) {
      console.error("l.jsx: Error ->", err);
      const root = document.getElementById("root");
      if (root) root.innerText = "Failed to load page.";
    }
  }

  run();
})();
