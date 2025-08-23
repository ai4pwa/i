(function () {
  // Read ?page=... parameter from script src
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
    return;
  }

  const cssUrl = `https://base44.app/api/apps/686424824d7b61721eac3e29/files/${cssFile}`;

  // Hide page initially
  document.addEventListener("DOMContentLoaded", async () => {
    document.body.style.visibility = "hidden";

    try {
      const res = await fetch(cssUrl);
      if (!res.ok) throw new Error("HTTP " + res.status);

      const cssText = await res.text();
      const style = document.createElement("style");
      style.textContent = cssText;
      document.head.appendChild(style);

      // ✅ Reveal page when CSS ready
      document.body.style.visibility = "visible";
    } catch (err) {
      console.error("❌ Error loading CSS:", err);
      // Fallback: still reveal page
      document.body.style.visibility = "visible";
    }
  });
})();
