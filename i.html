<!DOCTYPE html>
<html>
<head>
  <title>Loading...</title>
</head>
<body>
  <div id="app">Loading page...</div>

  <script>
    const params = new URLSearchParams(window.location.search);
    const id = params.get('page_id');

    if (!id) {
      document.getElementById('app').innerText = "No page ID given!";
    } else {
      fetch(`https://app.base44.com/api/apps/6812ad73a9594a183279deba/entities/DataRecord?_id=${id}`, {
        headers: {
          'api_key': '69315aa5aa7f4b6fa99c7a420da68bdd',
          'Content-Type': 'application/json'
        }
      })
      .then(res => res.json())
      .then(data => {
        const payload = data.payload;
        document.title = payload.title || 'Untitled Page';
        document.getElementById('app').innerHTML = payload.body || '<p>No content.</p>';
      })
      .catch(() => {
        document.getElementById('app').innerText = "Failed to load page data.";
      });
    }
  </script>
</body>
</html>
