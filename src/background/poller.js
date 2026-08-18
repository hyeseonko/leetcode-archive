import { hasSynced } from '../lib/ledger.js';

// The hook misses submissions made while the worker was asleep, in another browser,
// or through a UI path that never touches fetch. This is the floor under it.
export async function sweep({ store, csrfToken, fetchRecent, archive }) {
  const submissions = await fetchRecent({ csrfToken });
  let archived = 0;

  for (const submission of submissions) {
    if (submission.statusDisplay !== 'Accepted') continue;
    const submissionId = String(submission.id);
    if (await hasSynced(store, submissionId)) continue;

    try {
      await archive({
        verdict: {
          submissionId,
          lang: submission.lang,
          runtime: submission.runtime ?? null,
          memory: submission.memory ?? null,
          questionId: null,
        },
        titleSlug: submission.titleSlug,
        title: submission.title,
      });
      archived += 1;
    } catch (error) {
      // One bad submission must not strand the rest of the sweep.
      console.error('[leetcode-archive] sweep skipped', submissionId, error);
    }
  }
  return archived;
}
