// The MAIN world cannot reach chrome.runtime, and the isolated world cannot see the
// page's fetch. This is the seam between them, and it forwards nothing else.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'leetcode-archive' || !data.verdict) return;

  const match = window.location.pathname.match(/\/problems\/([^/]+)/);
  chrome.runtime.sendMessage({
    type: 'lca:accepted',
    verdict: data.verdict,
    titleSlug: match ? match[1] : null,
  });
});
