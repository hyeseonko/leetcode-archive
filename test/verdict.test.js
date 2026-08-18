import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/lib/verdict.js';

const { matchVerdict } = globalThis.LCA_VERDICT;

// The body LeetCode's submission check endpoint returns once judging finishes.
const CHECK_ACCEPTED = {
  state: 'SUCCESS',
  status_code: 10,
  status_msg: 'Accepted',
  submission_id: '829384756',
  question_id: '49',
  lang: 'python3',
  pretty_lang: 'Python3',
  status_runtime: '62 ms',
  status_memory: '13.9 MB',
  memory: 14200000,
  runtime_percentile: 19.26,
  memory_percentile: 57.1,
  total_correct: 116,
  total_testcases: 116,
};

test('recognises an accepted submission check payload', () => {
  assert.deepEqual(matchVerdict(CHECK_ACCEPTED), {
    submissionId: '829384756',
    lang: 'python3',
    runtime: '62 ms',
    memory: '13.9 MB',
    questionId: '49',
  });
});

test('prefers the display string over the raw byte count for memory', () => {
  assert.equal(matchVerdict(CHECK_ACCEPTED).memory, '13.9 MB');
});

test('recognises the GraphQL submission list shape', () => {
  const result = matchVerdict({
    id: 991122,
    statusDisplay: 'Accepted',
    lang: 'cpp',
    runtime: '4 ms',
    memory: '9.1 MB',
    titleSlug: 'two-sum',
  });
  assert.equal(result.submissionId, '991122');
  assert.equal(result.lang, 'cpp');
  assert.equal(result.questionId, null);
});

test('ignores a submission that did not pass', () => {
  assert.equal(matchVerdict({ ...CHECK_ACCEPTED, status_msg: 'Wrong Answer' }), null);
});

test('ignores the pending poll responses that precede the verdict', () => {
  assert.equal(matchVerdict({ state: 'PENDING' }), null);
});

test('ignores an accepted-looking payload with no submission id', () => {
  assert.equal(matchVerdict({ status_msg: 'Accepted' }), null);
});

test('ignores anything that is not an object', () => {
  for (const input of [null, undefined, 'Accepted', 42, []]) {
    assert.equal(matchVerdict(input), null);
  }
});
