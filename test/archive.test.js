import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveSubmission } from '../src/background/archive.js';
import { createStore, memoryArea } from '../src/lib/store.js';

const VERDICT = { submissionId: '829384756', lang: 'python3', runtime: '62 ms', memory: '13.9 MB', questionId: '49' };
const JOB = { verdict: VERDICT, titleSlug: 'group-anagrams', title: 'Group Anagrams' };

function deps(overrides = {}) {
  return {
    store: createStore(memoryArea()),
    repo: { owner: 'hyeseonko', name: 'LeetCode', branch: 'main' },
    token: 'gho',
    csrfToken: 'csrf',
    fetchDetails: async () => ({ code: 'class Solution:\n    pass', runtimePercentile: 19.26, memoryPercentile: 57.1, questionId: '49' }),
    fetchStatement: async () => '<p>Group them.</p>',
    commit: async () => ({ commitSha: 'abc123' }),
    ...overrides,
  };
}

test('commits the solution and the statement in one commit', async () => {
  const committed = [];
  const d = deps({ commit: async (args) => { committed.push(args); return { commitSha: 'abc123' }; } });
  const result = await archiveSubmission(JOB, d);

  assert.deepEqual(result, { status: 'committed', commitSha: 'abc123', questionId: '49' });
  assert.equal(committed.length, 1);
  assert.deepEqual(committed[0].files.map((f) => f.path), [
    '0049-group-anagrams/0049-group-anagrams.py',
    '0049-group-anagrams/README.md',
  ]);
  assert.equal(committed[0].message, 'solve: 49. Group Anagrams — Time 62 ms (19.26%), Space 13.9 MB (57.10%)');
});

test('skips a submission already in the ledger', async () => {
  const store = createStore(memoryArea());

  const first = await archiveSubmission(JOB, deps({ store }));
  assert.equal(first.status, 'committed');

  // The poller and the hook both see the same submission. The second one must not
  // reach GitHub at all.
  const second = await archiveSubmission(JOB, deps({
    store,
    commit: async () => { throw new Error('should not have committed twice'); },
  }));
  assert.equal(second.status, 'skipped');
});

test('does not record a submission it failed to commit', async () => {
  const store = createStore(memoryArea());
  const d = deps({ store, commit: async () => { throw new Error('network down'); } });
  await assert.rejects(() => archiveSubmission(JOB, d));
  assert.deepEqual(await store.get('synced', []), []);
});

test('still archives the solution when the statement is Premium-locked', async () => {
  const committed = [];
  const d = deps({ fetchStatement: async () => null, commit: async (args) => { committed.push(args); return { commitSha: 'x' }; } });
  const result = await archiveSubmission(JOB, d);
  assert.equal(result.status, 'committed');
  assert.match(committed[0].files[1].content, /not available/i);
});

test('takes the question id from the details when the verdict omits it', async () => {
  const committed = [];
  const d = deps({ commit: async (args) => { committed.push(args); return { commitSha: 'x' }; } });
  const result = await archiveSubmission({ ...JOB, verdict: { ...VERDICT, questionId: null } }, d);
  assert.match(committed[0].files[0].path, /^0049-group-anagrams\//);
  assert.equal(result.questionId, '49');
});
