// Runs in the page's MAIN world so it can see the page's own fetch/XHR traffic.
// It reports a submission verdict and nothing else across the world boundary.
(() => {
  const { matchVerdict } = globalThis.LCA_VERDICT;
  const seen = new Set();

  function report(text) {
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return; // not JSON; nothing here describes a submission
    }
    const verdict = matchVerdict(body);
    // The page polls the same verdict several times; report each submission once.
    if (!verdict || seen.has(verdict.submissionId)) return;
    seen.add(verdict.submissionId);
    window.postMessage({ source: 'leetcode-archive', verdict }, window.location.origin);
  }

  const nativeFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await nativeFetch.apply(this, args);
    // Read from a clone so the page still gets an unconsumed body.
    response.clone().text().then(report).catch(() => {});
    return response;
  };

  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      if (typeof this.responseText === 'string') report(this.responseText);
    });
    return nativeSend.apply(this, args);
  };
})();
