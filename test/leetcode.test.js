import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSubmissionDetails, fetchQuestionStatement, fetchRecentSubmissions } from '../src/lib/leetcode.js';

function stubFetch(reply, status = 200) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status < 400, status, text: async () => JSON.stringify(reply) };
  };
  impl.calls = calls;
  return impl;
}

test('sends the session-bearing request LeetCode expects', async () => {
  const fetchImpl = stubFetch({ data: { submissionDetails: { code: 'x', runtimePercentile: 1, memoryPercentile: 2, question: { questionId: '49' } } } });
  await fetchSubmissionDetails('123', { fetchImpl, csrfToken: 'tok' });

  const [call] = fetchImpl.calls;
  assert.equal(call.url, 'https://leetcode.com/graphql/');
  assert.equal(call.init.credentials, 'include');
  assert.equal(call.init.headers['x-csrftoken'], 'tok');
  assert.equal(call.init.headers.Referer, 'https://leetcode.com');
  assert.deepEqual(call.body.variables, { submissionId: 123 });
});

test('passes the submission id as a number, which the schema requires', async () => {
  const fetchImpl = stubFetch({ data: { submissionDetails: { code: 'x', runtimePercentile: null, memoryPercentile: null, question: { questionId: '1' } } } });
  await fetchSubmissionDetails('987', { fetchImpl, csrfToken: 't' });
  assert.equal(typeof fetchImpl.calls[0].body.variables.submissionId, 'number');
});

test('flattens the submission details response', async () => {
  const fetchImpl = stubFetch({
    data: { submissionDetails: { code: 'class Solution', runtimePercentile: 19.26, memoryPercentile: 57.1, question: { questionId: '49' } } },
  });
  assert.deepEqual(await fetchSubmissionDetails('123', { fetchImpl, csrfToken: 't' }), {
    code: 'class Solution', runtimePercentile: 19.26, memoryPercentile: 57.1, questionId: '49',
  });
});

test('returns null for a Premium-locked statement instead of throwing', async () => {
  const fetchImpl = stubFetch({ errors: [{ message: 'forbidden' }] }, 403);
  assert.equal(await fetchQuestionStatement('two-sum', { fetchImpl, csrfToken: 't' }), null);
});

test('reads the recent submission list the poller sweeps', async () => {
  const submissions = [{ id: 1, lang: 'python3', timestamp: '100', statusDisplay: 'Accepted', runtime: '1 ms', memory: '1 MB', title: 'Two Sum', titleSlug: 'two-sum' }];
  const fetchImpl = stubFetch({ data: { submissionList: { hasNext: false, submissions } } });
  assert.deepEqual(await fetchRecentSubmissions({ fetchImpl, csrfToken: 't' }), submissions);
  assert.deepEqual(fetchImpl.calls[0].body.variables, { offset: 0, limit: 20, slug: null });
});

test('raises when GraphQL answers with errors and no data', async () => {
  const fetchImpl = stubFetch({ errors: [{ message: 'boom' }] });
  await assert.rejects(() => fetchSubmissionDetails('1', { fetchImpl, csrfToken: 't' }), /boom/);
});
