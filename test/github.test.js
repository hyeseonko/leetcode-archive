import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitFiles, AuthError, GitHubError } from '../src/background/github.js';

const REPO = { owner: 'hyeseonko', name: 'LeetCode', branch: 'main' };

// Returns a fetch stub that records every call and replies from `routes`, matched by
// "METHOD /path". A route may be a value or a function of the call index.
function stubFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = url.replace('https://api.github.com', '');
    const key = `${method} ${path}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const route = routes[key];
    if (!route) throw new Error(`unstubbed request: ${key}`);
    const reply = typeof route === 'function' ? route(calls.length) : route;
    return {
      ok: reply.status < 400,
      status: reply.status,
      statusText: String(reply.status),
      text: async () => JSON.stringify(reply.body ?? {}),
    };
  };
  impl.calls = calls;
  return impl;
}

const HAPPY = {
  'GET /repos/hyeseonko/LeetCode/git/ref/heads/main': { status: 200, body: { object: { sha: 'headsha' } } },
  'GET /repos/hyeseonko/LeetCode/git/commits/headsha': { status: 200, body: { tree: { sha: 'treesha' } } },
  'POST /repos/hyeseonko/LeetCode/git/blobs': { status: 201, body: { sha: 'blobsha' } },
  'POST /repos/hyeseonko/LeetCode/git/trees': { status: 201, body: { sha: 'newtree' } },
  'POST /repos/hyeseonko/LeetCode/git/commits': { status: 201, body: { sha: 'newcommit' } },
  'PATCH /repos/hyeseonko/LeetCode/git/refs/heads/main': { status: 200, body: {} },
};

const FILES = [
  { path: '0049-group-anagrams/0049-group-anagrams.py', content: 'pass\n' },
  { path: '0049-group-anagrams/README.md', content: '<h2>49</h2>\n' },
];

test('writes every file into a single commit and moves the branch', async () => {
  const fetchImpl = stubFetch(HAPPY);
  const result = await commitFiles({ token: 't', repo: REPO, message: 'solve: 49', files: FILES, fetchImpl });

  assert.equal(result.commitSha, 'newcommit');
  assert.deepEqual(fetchImpl.calls.map((c) => c.key), [
    'GET /repos/hyeseonko/LeetCode/git/ref/heads/main',
    'GET /repos/hyeseonko/LeetCode/git/commits/headsha',
    'POST /repos/hyeseonko/LeetCode/git/blobs',
    'POST /repos/hyeseonko/LeetCode/git/blobs',
    'POST /repos/hyeseonko/LeetCode/git/trees',
    'POST /repos/hyeseonko/LeetCode/git/commits',
    'PATCH /repos/hyeseonko/LeetCode/git/refs/heads/main',
  ]);

  const tree = fetchImpl.calls.find((c) => c.key.endsWith('/git/trees')).body;
  assert.equal(tree.base_tree, 'treesha');
  assert.deepEqual(tree.tree, FILES.map((f) => ({ path: f.path, mode: '100644', type: 'blob', sha: 'blobsha' })));

  const commit = fetchImpl.calls.find((c) => c.key.endsWith('/git/commits')).body;
  assert.deepEqual(commit.parents, ['headsha']);
});

test('sends the token as a bearer credential', async () => {
  const fetchImpl = stubFetch(HAPPY);
  await commitFiles({ token: 'secret', repo: REPO, message: 'm', files: FILES, fetchImpl });
  assert.equal(fetchImpl.calls[0].headers.Authorization, 'Bearer secret');
});

test('replays against the new head when someone pushes underneath it', async () => {
  const fetchImpl = stubFetch({
    ...HAPPY,
    // First attempt loses the race, second wins.
    'PATCH /repos/hyeseonko/LeetCode/git/refs/heads/main': (n) =>
      n === 7 ? { status: 422, body: { message: 'Update is not a fast forward' } } : { status: 200, body: {} },
  });
  const result = await commitFiles({ token: 't', repo: REPO, message: 'm', files: FILES, fetchImpl });
  assert.equal(result.commitSha, 'newcommit');
  assert.equal(fetchImpl.calls.filter((c) => c.key.startsWith('PATCH')).length, 2);
});

test('raises AuthError on 401 so the caller can clear the token', async () => {
  const fetchImpl = stubFetch({
    'GET /repos/hyeseonko/LeetCode/git/ref/heads/main': { status: 401, body: { message: 'Bad credentials' } },
  });
  await assert.rejects(
    () => commitFiles({ token: 'stale', repo: REPO, message: 'm', files: FILES, fetchImpl }),
    (error) => error instanceof AuthError && error.status === 401
  );
});

test('surfaces the GitHub message on any other failure', async () => {
  const fetchImpl = stubFetch({
    'GET /repos/hyeseonko/LeetCode/git/ref/heads/main': { status: 404, body: { message: 'Not Found' } },
  });
  await assert.rejects(
    () => commitFiles({ token: 't', repo: REPO, message: 'm', files: FILES, fetchImpl }),
    (error) => error instanceof GitHubError && error.status === 404 && /Not Found/.test(error.message)
  );
});
