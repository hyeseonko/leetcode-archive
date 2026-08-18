const KEY = 'queue';
const FAILED_KEY = 'failed';
export const MAX_ATTEMPTS = 6;

export function backoffMs(attempt) {
  return Math.min(2 ** (attempt + 1), 60) * 1000;
}

export async function enqueue(store, record, now) {
  const queue = await store.get(KEY, []);
  if (queue.some((entry) => entry.submissionId === record.submissionId)) return;
  queue.push({ ...record, attempt: 0, nextAttemptAt: now + backoffMs(0) });
  await store.set(KEY, queue);
}

export async function pending(store, now) {
  const queue = await store.get(KEY, []);
  return queue.filter((entry) => entry.nextAttemptAt <= now);
}

export async function settle(store, record, outcome, now) {
  const queue = await store.get(KEY, []);
  const index = queue.findIndex((entry) => entry.submissionId === record.submissionId);
  if (index === -1) return;

  if (outcome === 'ok') {
    queue.splice(index, 1);
    await store.set(KEY, queue);
    return;
  }

  const attempt = queue[index].attempt + 1;
  if (attempt >= MAX_ATTEMPTS) {
    // Stop pretending it will work. The popup reads `failed` and says so.
    const [dropped] = queue.splice(index, 1);
    const failed = await store.get(FAILED_KEY, []);
    failed.push({ ...dropped, droppedAt: now });
    await store.set(FAILED_KEY, failed.slice(-50));
  } else {
    queue[index] = { ...queue[index], attempt, nextAttemptAt: now + backoffMs(attempt) };
  }
  await store.set(KEY, queue);
}
