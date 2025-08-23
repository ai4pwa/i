(function () {
  // Step 1: Add loader immediately
  const loader = document.createElement("div");
  loader.id = "css-loader";
  loader.textContent = "Loading page...";
  Object.assign(loader.style, {
  });
  document.body.appendChild(loader);

  // Step 2: Hide body content (except loader)
  const hideStyle = document.createElement("style");
  hideStyle.setAttribute("id", "css-proxy-hide");
  hideStyle.textContent = "body > *:not(#css-loader){display:none !important;}";
  document.head.appendChild(hideStyle);

  // Helper: read ?page=... from script src
  function getScriptParam(name) {
    const currentScript = document.currentScript;
    if (!currentScript) return null;
    const src = currentScript.src;
    const url = new URL(src);
    return url.searchParams.get(name);
  }

  const cssFile = getScriptParam("page");
  if (!cssFile) {
    console.error("❌ No CSS file specified in j.js src (?page=...)");
    cleanup();
    return;
  }

  const cssUrl = `https://base44.app/api/apps/686424824d7b61721eac3e29/files/${cssFile}`;

  // Step 3: Fetch CSS
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
      console.error("❌ Error loading CSS:", err);
    })
    .finally(() => {
      cleanup();
    });

  // Cleanup: remove loader + reveal content
  function cleanup() {
    const s = document.getElementById("css-proxy-hide");
    if (s) s.remove();
    if (loader && loader.parentNode) loader.remove();
  }
})();
