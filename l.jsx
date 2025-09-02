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

  // Utility: load external script
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

  // Ensure React, ReactDOM, Babel
  async function ensureReactEnv() {
    if (
      typeof React !== "undefined" &&
      typeof ReactDOM !== "undefined" &&
      typeof Babel !== "undefined"
    ) {
      return;
    }
    await loadScript("https://unpkg.com/react@18/umd/react.development.js");
    await loadScript("https://unpkg.com/react-dom@18/umd/react-dom.development.js");
    await loadScript("https://unpkg.com/@babel/standalone/babel.min.js");
  }

  // Ensure #root exists
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

  // Main runner
  async function run() {
    try {
      await ensureReactEnv();
      ensureRootDiv();

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
      const transpiled = Babel.transform(decoded, { presets: ["react"] }).code;

      // Execute transpiled code
      new Function("React", "ReactDOM", transpiled)(React, ReactDOM);

      console.log("l.jsx: JSX executed successfully.");
    } catch (err) {
      console.error("l.jsx: Error ->", err);
    }
  }

  run();
})();
