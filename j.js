(function () {
  // Loader + hide
  const loader = document.createElement("div");
  loader.id = "css-loader";
  loader.textContent = "Loading page...";
  document.body.appendChild(loader);

  const hide = document.createElement("style");
  hide.id = "css-proxy-hide";
  hide.textContent = "body > *:not(#css-loader){display:none !important;}";
  document.head.appendChild(hide);

  // Get ?page=... param
  const currentScript = document.currentScript;
  const cssFile = currentScript ? new URL(currentScript.src).searchParams.get("page") : null;
  if (!cssFile) return cleanup();

  const cssUrl = `https://base44.app/api/apps/686424824d7b61721eac3e29/files/${cssFile}`;

  // Load CSS with <link>
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = cssUrl;
  link.onload = cleanup;
  link.onerror = () => { console.error("CSS load failed"); cleanup(); };
  document.head.appendChild(link);

  function cleanup() {
    hide?.remove();
    loader?.remove();
  }
})();
