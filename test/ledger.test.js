import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryArea } from '../src/lib/store.js';
import { hasSynced, markSynced, LEDGER_CAP } from '../src/lib/ledger.js';

test('remembers a submission so the hook and the poller do not both commit it', async () => {
  const store = createStore(memoryArea());
  assert.equal(await hasSynced(store, '123'), false);
  await markSynced(store, '123');
  assert.equal(await hasSynced(store, '123'), true);
});

test('marking the same submission twice does not grow the ledger', async () => {
  const store = createStore(memoryArea());
  await markSynced(store, '123');
  await markSynced(store, '123');
  assert.deepEqual(await store.get('synced'), ['123']);
});

test('drops the oldest ids once the ledger is full', async () => {
  const store = createStore(memoryArea());
  for (let i = 0; i < LEDGER_CAP + 10; i += 1) await markSynced(store, String(i));
  const synced = await store.get('synced');
  assert.equal(synced.length, LEDGER_CAP);
  assert.equal(await hasSynced(store, '0'), false);
  assert.equal(await hasSynced(store, String(LEDGER_CAP + 9)), true);
});
