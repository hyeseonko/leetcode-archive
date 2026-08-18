import { archiveSubmission } from './archive.js';
import { commitFiles, AuthError } from './github.js';
import { requestDeviceCode, pollForToken, DeviceFlowError } from './oauth.js';
import { sweep } from './poller.js';
import { enqueue, pending, settle } from './queue.js';
import { fetchSubmissionDetails, fetchQuestionStatement, fetchRecentSubmissions } from '../lib/leetcode.js';
import { createStore } from '../lib/store.js';
import { notesPath } from '../lib/paths.js';
import { notesContent } from '../lib/render.js';

const store = createStore(chrome.storage.local);
const DEFAULT_REPO = { owner: 'hyeseonko', name: 'LeetCode', branch: 'main' };

async function csrfToken() {
  const cookie = await chrome.cookies.get({ url: 'https://leetcode.com', name: 'csrftoken' });
  return cookie?.value ?? '';
}

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  if (color) await chrome.action.setBadgeBackgroundColor({ color });
}

async function repo() {
  return store.get('repo', DEFAULT_REPO);
}

async function rememberFailure(job, now) {
  const id = job.verdict.submissionId;
  const queued = await store.get('queue', []);
  if (queued.some((entry) => entry.submissionId === id)) {
    await settle(store, { submissionId: id }, 'retry', now);
  } else {
    await enqueue(store, { submissionId: id, job }, now);
  }
}

async function run(job) {
  const token = await store.get('token');
  if (!token) {
    await setBadge('!', '#d29922');
    return { status: 'unauthenticated' };
  }

  try {
    const result = await archiveSubmission(job, {
      store,
      repo: await repo(),
      token,
      csrfToken: await csrfToken(),
      fetchDetails: fetchSubmissionDetails,
      fetchStatement: fetchQuestionStatement,
      commit: commitFiles,
    });

    await setBadge('');
    await settle(store, { submissionId: job.verdict.submissionId }, 'ok', Date.now());

    if (result.status === 'committed') {
      // questionId travels with the broadcast so a note commit can find the directory.
      const enriched = { ...job, questionId: result.questionId };
      chrome.runtime.sendMessage({ type: 'lca:committed', job: enriched, result }).catch(() => {});
    }
    return result;
  } catch (error) {
    if (error instanceof AuthError) {
      await store.remove('token');
      await setBadge('!', '#d29922');
      return { status: 'unauthenticated' };
    }
    await rememberFailure(job, Date.now());
    await setBadge('!', '#f85149');
    console.error('[leetcode-archive]', error);
    return { status: 'error', message: String(error.message || error) };
  }
}

async function status() {
  return {
    signedIn: Boolean(await store.get('token')),
    repo: await repo(),
    queued: (await store.get('queue', [])).length,
    failed: (await store.get('failed', [])).length,
  };
}

async function startAuth() {
  try {
    const device = await requestDeviceCode({});
    // Polling continues after the popup closes, which is why it runs here.
    pollForToken(device)
      .then(async (token) => {
        await store.set('token', token);
        await setBadge('');
        chrome.runtime.sendMessage({ type: 'lca:auth-done' }).catch(() => {});
      })
      .catch((error) => {
        const reason = error instanceof DeviceFlowError ? error.code : String(error);
        console.error('[leetcode-archive] device flow failed:', reason);
      });
    return { userCode: device.userCode, verificationUri: device.verificationUri };
  } catch (error) {
    return { error: String(error.message || error) };
  }
}

async function saveNote({ job, note }) {
  const token = await store.get('token');
  if (!token) return { status: 'unauthenticated' };

  // Not job.verdict.questionId: that is null whenever the poller found the
  // submission. archive.js resolves the real id and sends it back in the broadcast.
  const { questionId } = job;
  if (!questionId) return { status: 'skipped' };

  await commitFiles({
    token,
    repo: await repo(),
    message: `notes: ${Number(questionId)}. ${job.title || job.titleSlug}`,
    files: [{ path: notesPath(questionId, job.titleSlug), content: notesContent(note) }],
  });
  return { status: 'committed' };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'lca:accepted') {
    run({ verdict: message.verdict, titleSlug: message.titleSlug, title: message.title }).then(sendResponse);
    return true; // keep the channel open for the async reply
  }
  if (message?.type === 'lca:status') {
    status().then(sendResponse);
    return true;
  }
  if (message?.type === 'lca:auth-start') {
    startAuth().then(sendResponse);
    return true;
  }
  if (message?.type === 'lca:note') {
    saveNote(message).then(sendResponse).catch((error) => sendResponse({ status: 'error', message: String(error) }));
    return true;
  }
  return undefined;
});

chrome.alarms.create('lca:drain', { periodInMinutes: 1 });
chrome.alarms.create('lca:sweep', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'lca:drain') {
    for (const entry of await pending(store, Date.now())) {
      await run(entry.job);
    }
    return;
  }
  if (alarm.name === 'lca:sweep' && (await store.get('token'))) {
    await sweep({
      store,
      csrfToken: await csrfToken(),
      fetchRecent: fetchRecentSubmissions,
      archive: run,
    });
  }
});
