import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryArea } from '../src/lib/store.js';
import { enqueue, pending, settle, backoffMs, MAX_ATTEMPTS } from '../src/background/queue.js';

const RECORD = { submissionId: '123', titleSlug: 'two-sum' };

test('backs off exponentially and then holds at a minute', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(backoffMs), [2000, 4000, 8000, 16000, 32000, 60000, 60000]);
});

test('holds a queued record until its backoff elapses', async () => {
  const store = createStore(memoryArea());
  await enqueue(store, RECORD, 1000);
  assert.deepEqual(await pending(store, 1500), []);
  assert.deepEqual((await pending(store, 3500)).map((r) => r.submissionId), ['123']);
});

test('clears a record once it succeeds', async () => {
  const store = createStore(memoryArea());
  await enqueue(store, RECORD, 0);
  await settle(store, RECORD, 'ok', 0);
  assert.deepEqual(await store.get('queue'), []);
});

test('re-arms a record with a longer wait when it fails', async () => {
  const store = createStore(memoryArea());
  await enqueue(store, RECORD, 0);
  await settle(store, RECORD, 'retry', 0);
  const [queued] = await store.get('queue');
  assert.equal(queued.attempt, 1);
  assert.equal(queued.nextAttemptAt, 4000);
});

test('gives up after the attempt limit rather than retrying forever', async () => {
  const store = createStore(memoryArea());
  await enqueue(store, RECORD, 0);
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) await settle(store, RECORD, 'retry', 0);
  assert.deepEqual(await store.get('queue'), []);
  assert.equal((await store.get('failed', [])).length, 1);
});
