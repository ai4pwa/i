(function () {
  // Inject loader and hide rule immediately (before paint)
  document.write('<div id="css-loader">Loading page...</div>');
  document.write('<style id="css-proxy-hide">body > *:not(#css-loader){display:none !important;}</style>');

  // Get ?page=... parameter from script src
  function getScriptParam(name) {
    const currentScript = document.currentScript;
    const src = currentScript.src;
    const url = new URL(src);
    return url.searchParams.get(name);
  }

  const cssFile = getScriptParam("page");
  const cssUrl = `https://base44.app/api/apps/686424824d7b61721eac3e29/files/${cssFile}`;

  // Fetch and inject CSS
  fetch(cssUrl)
    .then(res => {
      return res.text();
    })
    .then(cssText => {
      const style = document.createElement("style");
      style.textContent = cssText;
      document.head.appendChild(style);
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
