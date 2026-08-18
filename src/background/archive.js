import { hasSynced, markSynced } from '../lib/ledger.js';
import { solutionPath, readmePath } from '../lib/paths.js';
import { commitMessage, readmeContent, solutionContent } from '../lib/render.js';

// `deps` is injected rather than imported so the pipeline can be tested without a
// browser, a network, or a GitHub account.
export async function archiveSubmission({ verdict, titleSlug, title }, deps) {
  const { store, repo, token, csrfToken, fetchDetails, fetchStatement, commit } = deps;

  if (await hasSynced(store, verdict.submissionId)) {
    return { status: 'skipped' };
  }

  const details = await fetchDetails(verdict.submissionId, { csrfToken });
  const statement = await fetchStatement(titleSlug, { csrfToken });
  const questionId = verdict.questionId ?? details.questionId;
  if (!questionId) throw new Error(`no question id for submission ${verdict.submissionId}`);

  const record = {
    questionId,
    title: title || titleSlug,
    titleSlug,
    lang: verdict.lang,
    code: details.code,
    runtime: verdict.runtime,
    memory: verdict.memory,
    runtimePercentile: details.runtimePercentile,
    memoryPercentile: details.memoryPercentile,
    statement,
  };

  const { commitSha } = await commit({
    token,
    repo,
    message: commitMessage(record),
    files: [
      { path: solutionPath(questionId, titleSlug, verdict.lang), content: solutionContent(record.code) },
      { path: readmePath(questionId, titleSlug), content: readmeContent(record) },
    ],
  });

  // Only after the commit lands. Recording it earlier would lose the submission if
  // the write failed.
  await markSynced(store, verdict.submissionId);
  return { status: 'committed', commitSha, questionId };
}
