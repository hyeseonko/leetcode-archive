// Published on a global rather than exported: Chrome MV3 does not support ES modules
// in manifest-declared content scripts, and this file runs in the page's MAIN world.
globalThis.LCA_VERDICT = (() => {
  function firstString(...values) {
    for (const value of values) {
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return null;
  }

  // Matches on payload shape, not on URL. LeetCode has moved the submission check
  // endpoint before and will again; what stays stable is that the body names a
  // verdict and a submission.
  function matchVerdict(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

    const verdict = firstString(body.status_msg, body.statusDisplay);
    if (verdict !== 'Accepted') return null;

    const rawId = body.submission_id ?? body.submissionId ?? body.id;
    if (rawId === undefined || rawId === null || rawId === '') return null;

    return {
      submissionId: String(rawId),
      lang: firstString(body.lang, body.pretty_lang),
      // `status_memory` is "13.9 MB"; `memory` is 14200000 in the same payload but a
      // display string in the GraphQL one. Taking the first string handles both.
      runtime: firstString(body.status_runtime, body.runtime),
      memory: firstString(body.status_memory, body.memory),
      questionId: firstString(body.question_id, body.questionId),
    };
  }

  return { matchVerdict };
})();
