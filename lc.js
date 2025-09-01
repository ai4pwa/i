(function () {
  // Inject loader and hide rule immediately (before paint)
  document.write('<div id="css-loader">Loading page...</div>');
  document.write('<style id="css-proxy-hide">body > *:not(#css-loader){display:none !important;}</style>');

  // Get ?unique_id=... parameter from script src
  function getScriptParam(name) {
    const currentScript = document.currentScript;
    if (!currentScript) return null;
    const src = currentScript.src;
    const url = new URL(src);
    return url.searchParams.get(name);
  }

  const cssFile = getScriptParam("unique_id");
  if (!cssFile) {
    console.error("lc.js: No CSS unique_id specified.");
    cleanup();
    return;
  }

  const apiUrl =
    "https://app.base44.com/api/apps/6812ad73a9594a183279deba/entities/DataRecord" +
    "?user_id=user_jveo8b35q_1748241619184" +
    "&payload.unique_id=" +
    cssFile;

  console.log("lc.js: Fetching CSS from", apiUrl);

  // Fetch CSS file content directly from Base44
  fetch(apiUrl, {
    headers: {
      api_key: "69315aa5aa7f4b6fa99c7a420da68bdd",
      "Content-Type": "application/json",
    },
  })
    .then((res) => res.json())
    .then((records) => {
      if (!records.length) {
        throw new Error("CSS not found for ID " + cssFile);
      }

      const base64Content = records[0].payload.file_content;
      const decodedCss = atob(base64Content);

      const style = document.createElement("style");
      style.textContent = decodedCss;
      document.head.appendChild(style);

      console.log("lc.js: CSS injected successfully.");
    })
    .catch((err) => {
      console.error("lc.js: Error loading CSS:", err);
    })
    .finally(() => {
      cleanup();
    });

  // Remove loader + reveal content
  function cleanup() {
    const h = document.getElementById("css-proxy-hide");
    if (h) h.remove();
    const l = document.getElementById("css-loader");
    if (l) l.remove();
  }
})();
