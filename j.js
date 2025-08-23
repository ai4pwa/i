(function () {
  // Step 1: Hide body immediately with a <style> tag
  const hideStyle = document.createElement("style");
  hideStyle.setAttribute("id", "css-proxy-hide");
  hideStyle.textContent = "body{visibility:hidden !important;}";
  document.head.appendChild(hideStyle);

  // Read ?page=... from script src
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
    document.head.removeChild(hideStyle);
    return;
  }

  const cssUrl = `https://base44.app/api/apps/686424824d7b61721eac3e29/files/${cssFile}`;

  // Step 2: Fetch CSS and apply
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
      // Step 3: Reveal body by removing hide style
      const s = document.getElementById("css-proxy-hide");
      if (s) s.remove();
    });
})();
