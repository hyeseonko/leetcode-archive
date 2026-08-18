chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'lca:accepted') return;
  console.log('[leetcode-archive] accepted', message.verdict.submissionId, message.titleSlug);
});
