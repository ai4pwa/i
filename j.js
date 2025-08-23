(function () {
  // Hide body immediately
  document.write('<style>body{display:none !important;}</style>');
  document.write('<div id="loadingScreen">Loading page...</div>');

  // Get CSS file name from ?page=
  const params = new URLSearchParams(location.search);
  const cssFile = params.get("page");

  if (cssFile) {
    fetch("https://base44.app/api/apps/686424824d7b61721eac3e29/files/" + cssFile)
      .then(r => r.text())
      .then(css => {
        // Inject CSS
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);

        // Remove loader and show page
        document.getElementById("loadingScreen").remove();
        document.body.style.display = "";
      });
  }
})();
