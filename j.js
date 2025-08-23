(function () {
  // Inject loader and hide style synchronously (like document.write but safer)
  document.head.insertAdjacentHTML("beforeend",
    '<style id="css-proxy-hide">body > *:not(#css-loader){display:none !important;}</style>'
  );
  document.documentElement.insertAdjacentHTML("beforeend",
    '<body><div id="css-loader">Loading page...</div></body>'
  );

  // Get ?page=... param from this script src
  const currentScript = document.currentScript;
  const cssFile = currentScript ? new URL(currentScript.src).searchParams.get("page") : null;
  if (!cssFile) return cleanup();

  const cssUrl = `https://base44.app/api/apps/686424824d7b61721eac3e29/files/${cssFile}`;

  // Load CSS using <link>
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = cssUrl;
  link.onload = cleanup;
  link.onerror = () => { console.error("❌ CSS load failed"); cleanup(); };
  document.head.appendChild(link);

  // Remove loader and unhide content
  function cleanup() {
    document.getElementById("css-proxy-hide")?.remove();
    document.getElementById("css-loader")?.remove();
  }
})();
