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
    console.error("No CSS file specified in lc.js src (?unique_id=...)");
    cleanup();
    return;
  }

  const cssUrl = `https://ai4pwa.github.io/i/l.html?unique_id=${cssFile}`;

  // Fetch and inject CSS
  fetch(cssUrl)
    .then(res => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    })
    .then(cssText => {
      const style = document.createElement("style");
      style.textContent = cssText;
      document.head.appendChild(style);
    })
    .catch(err => {
      console.error("Error loading CSS:", err);
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
