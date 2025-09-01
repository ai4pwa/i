(function () {
  console.log("l.js: Loader started...");

  // Find this script tag in the DOM
  const currentScript = document.currentScript;
  const scriptSrc = currentScript ? currentScript.src : "";
  const uniqueId = new URL(scriptSrc).searchParams.get("unique_id");

  console.log("l.js: unique_id =", uniqueId);

  if (!uniqueId) {
    console.error("l.js: No unique_id provided in script src.");
    return;
  }

  const url =
    "https://app.base44.com/api/apps/6812ad73a9594a183279deba/entities/DataRecord" +
    "?user_id=user_jveo8b35q_1748241619184" +
    "&payload.unique_id=" +
    uniqueId;

  console.log("l.js: Fetching", url);

  fetch(url, {
    headers: {
      api_key: "69315aa5aa7f4b6fa99c7a420da68bdd",
      "Content-Type": "application/json",
    },
  })
    .then((res) => res.json())
    .then((records) => {
      console.log("l.js: Records response", records);
      if (!records.length) {
        console.error("l.js: Script not found for ID", uniqueId);
        return;
      }

      const file = records[0].payload;
      let decoded;
      try {
        decoded = atob(file.file_content);
      } catch (e) {
        console.error("l.js: Failed to decode script content.", e);
        return;
      }

      try {
        new Function(decoded)();
        console.log("l.js: Script executed successfully.");
      } catch (e) {
        console.error("l.js: Error executing script ->", e);
      }
    })
    .catch((err) => {
      console.error("l.js: Failed to fetch script.", err);
    });
})();
