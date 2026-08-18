const KEY = 'synced';
export const LEDGER_CAP = 5000;

export async function hasSynced(store, submissionId) {
  const synced = await store.get(KEY, []);
  return synced.includes(String(submissionId));
}

export async function markSynced(store, submissionId) {
  const id = String(submissionId);
  const synced = await store.get(KEY, []);
  if (synced.includes(id)) return;
  synced.push(id);
  // Oldest first, so slicing from the end keeps the recent ids that matter.
  await store.set(KEY, synced.slice(-LEDGER_CAP));
}
