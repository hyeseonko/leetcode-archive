import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweep } from '../src/background/poller.js';
import { createStore, memoryArea } from '../src/lib/store.js';
import { markSynced } from '../src/lib/ledger.js';

const SUBMISSIONS = [
  { id: 1, lang: 'python3', statusDisplay: 'Accepted', runtime: '1 ms', memory: '1 MB', title: 'Two Sum', titleSlug: 'two-sum' },
  { id: 2, lang: 'python3', statusDisplay: 'Wrong Answer', runtime: null, memory: null, title: 'Two Sum', titleSlug: 'two-sum' },
  { id: 3, lang: 'cpp', statusDisplay: 'Accepted', runtime: '4 ms', memory: '9 MB', title: 'Add Two Numbers', titleSlug: 'add-two-numbers' },
];

test('archives accepted submissions the hook did not catch', async () => {
  const store = createStore(memoryArea());
  const archived = [];
  const count = await sweep({ store, csrfToken: 't', fetchRecent: async () => SUBMISSIONS, archive: async (job) => { archived.push(job); } });

  assert.equal(count, 2);
  assert.deepEqual(archived.map((j) => j.verdict.submissionId), ['1', '3']);
  assert.deepEqual(archived[0].verdict, { submissionId: '1', lang: 'python3', runtime: '1 ms', memory: '1 MB', questionId: null });
  assert.equal(archived[0].titleSlug, 'two-sum');
  assert.equal(archived[0].title, 'Two Sum');
});

test('leaves alone anything already in the ledger', async () => {
  const store = createStore(memoryArea());
  await markSynced(store, '1');
  const archived = [];
  const count = await sweep({ store, csrfToken: 't', fetchRecent: async () => SUBMISSIONS, archive: async (job) => archived.push(job) });
  assert.equal(count, 1);
  assert.deepEqual(archived.map((j) => j.verdict.submissionId), ['3']);
});

test('one failing submission does not stop the sweep', async () => {
  const store = createStore(memoryArea());
  const archived = [];
  const count = await sweep({
    store, csrfToken: 't',
    fetchRecent: async () => SUBMISSIONS,
    archive: async (job) => {
      if (job.verdict.submissionId === '1') throw new Error('network down');
      archived.push(job);
    },
  });
  assert.equal(count, 1);
  assert.deepEqual(archived.map((j) => j.verdict.submissionId), ['3']);
});
