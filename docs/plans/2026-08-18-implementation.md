# leetcode-archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Manifest V3 Chrome extension that commits an accepted LeetCode submission — source, problem statement, stats, optional note — to a GitHub repository within seconds of it passing.

**Architecture:** A MAIN-world content script hooks `fetch`/`XMLHttpRequest` and recognises an accepted verdict by payload shape; an isolated-world content script fetches the code and problem statement from LeetCode's GraphQL API using the browser's own session; the background service worker writes all files in a single commit through GitHub's Git Data API, authenticated by OAuth device flow. A five-minute poller catches anything the hook missed.

**Tech Stack:** Plain ES2022 JavaScript, no dependencies, no build step. Tests run on `node --test` (Node 18+). Chrome MV3.

**Spec:** `docs/design.md`

## Global Constraints

- **No build step.** The extension loads unpacked straight from the repository root. Nothing may require compilation or bundling.
- **No runtime dependencies.** `package.json` declares no `dependencies` and no `devDependencies`; tests use only `node --test` and `node:assert`.
- **Node 18+** for the test runner (`node --test` with ESM).
- **Background code is ESM.** `manifest.json` sets `"background": { "service_worker": "src/background/service-worker.js", "type": "module" }`, so `src/background/*` and any `src/lib/*` they import use `export`.
- **Content-script code is not ESM.** Chrome MV3 does not support `import` in manifest-declared content scripts. Shared logic they need is published on a global by an IIFE — `globalThis.LCA_<NAME>` — and listed ahead of its consumer in the manifest's `js` array. Tests import the file for its side effect and read the global.
- **GitHub OAuth client id:** `Ov23liCEJVOZnAhTMT4z` (public by design, checked into source).
- **Target repository default:** `hyeseonko/LeetCode`, branch `main`.
- **GraphQL fields are limited to those with production precedent** in `joshcai/leetcode-sync@v1.7`. The schema is unpublished and rejects a query wholesale on an unknown field. Do not add fields.
- **Language:** all source comments, documentation and commit messages in English.
- **Commit style:** imperative subject under 72 characters, body explaining why when the why is not obvious.

---

### Task 1: Project scaffold, language map, path builder

**Files:**
- Create: `package.json`, `LICENSE`, `.gitignore`
- Create: `src/lib/langs.js`
- Create: `src/lib/paths.js`
- Test: `test/langs.test.js`, `test/paths.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `extensionFor(lang: string): string` — `"python3"` → `"py"`; throws `Error` on an unknown language
  - `solutionDir(questionId: string|number, titleSlug: string): string` — `(49, "group-anagrams")` → `"0049-group-anagrams"`
  - `solutionPath(questionId, titleSlug, lang): string` → `"0049-group-anagrams/0049-group-anagrams.py"`
  - `readmePath(questionId, titleSlug): string` → `"0049-group-anagrams/README.md"`
  - `notesPath(questionId, titleSlug): string` → `"0049-group-anagrams/NOTES.md"`

- [ ] **Step 1: Create the scaffold files**

`package.json`:

```json
{
  "name": "leetcode-archive",
  "version": "0.1.0",
  "description": "Archive accepted LeetCode submissions to GitHub the moment they pass",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test test/"
  },
  "license": "MIT",
  "engines": { "node": ">=18" }
}
```

`.gitignore`:

```
node_modules/
.DS_Store
*.zip
```

`LICENSE`: the standard MIT text, copyright `2026 hyeseonko`.

- [ ] **Step 2: Write the failing tests**

`test/langs.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extensionFor } from '../src/lib/langs.js';

test('maps LeetCode language slugs to file extensions', () => {
  assert.equal(extensionFor('python3'), 'py');
  assert.equal(extensionFor('cpp'), 'cpp');
  assert.equal(extensionFor('java'), 'java');
  assert.equal(extensionFor('javascript'), 'js');
  assert.equal(extensionFor('mysql'), 'sql');
});

test('is case-insensitive because the poller and the hook disagree on case', () => {
  assert.equal(extensionFor('Python3'), 'py');
});

test('throws on an unknown language rather than inventing an extension', () => {
  assert.throws(() => extensionFor('brainfuck'), /unknown language/i);
});
```

`test/paths.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solutionDir, solutionPath, readmePath, notesPath } from '../src/lib/paths.js';

test('pads the question number to four digits so directories sort in problem order', () => {
  assert.equal(solutionDir(49, 'group-anagrams'), '0049-group-anagrams');
  assert.equal(solutionDir('1', 'two-sum'), '0001-two-sum');
});

test('does not truncate question numbers above four digits', () => {
  assert.equal(solutionDir(12345, 'some-problem'), '12345-some-problem');
});

test('accepts the question id as a string, which is how GraphQL returns it', () => {
  assert.equal(solutionDir('0049', 'group-anagrams'), '0049-group-anagrams');
});

test('names the solution file after its directory', () => {
  assert.equal(solutionPath(49, 'group-anagrams', 'python3'), '0049-group-anagrams/0049-group-anagrams.py');
});

test('places README and NOTES beside the solution', () => {
  assert.equal(readmePath(49, 'group-anagrams'), '0049-group-anagrams/README.md');
  assert.equal(notesPath(49, 'group-anagrams'), '0049-group-anagrams/NOTES.md');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/langs.js'`

- [ ] **Step 4: Implement `src/lib/langs.js`**

```js
// LeetCode's language slugs as they appear in `submissionList.lang` and in the
// submission verdict payload, mapped to the extension the archive stores them under.
const EXTENSIONS = {
  bash: 'sh',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  dart: 'dart',
  elixir: 'ex',
  erlang: 'erl',
  golang: 'go',
  java: 'java',
  javascript: 'js',
  kotlin: 'kt',
  mssql: 'sql',
  mysql: 'sql',
  objectivec: 'm',
  oraclesql: 'sql',
  php: 'php',
  postgresql: 'sql',
  pythondata: 'py',
  python: 'py',
  python3: 'py',
  racket: 'rkt',
  react: 'jsx',
  ruby: 'rb',
  rust: 'rs',
  scala: 'scala',
  swift: 'swift',
  typescript: 'ts',
};

export function extensionFor(lang) {
  const extension = EXTENSIONS[String(lang).toLowerCase()];
  if (!extension) {
    throw new Error(`unknown language: ${lang}`);
  }
  return extension;
}
```

- [ ] **Step 5: Implement `src/lib/paths.js`**

```js
import { extensionFor } from './langs.js';

// Four digits is what the existing archive settled on. Problems numbered above
// 9999 keep their own width rather than being truncated.
function pad(questionId) {
  return String(Number(questionId)).padStart(4, '0');
}

export function solutionDir(questionId, titleSlug) {
  return `${pad(questionId)}-${titleSlug}`;
}

export function solutionPath(questionId, titleSlug, lang) {
  const dir = solutionDir(questionId, titleSlug);
  return `${dir}/${dir}.${extensionFor(lang)}`;
}

export function readmePath(questionId, titleSlug) {
  return `${solutionDir(questionId, titleSlug)}/README.md`;
}

export function notesPath(questionId, titleSlug) {
  return `${solutionDir(questionId, titleSlug)}/NOTES.md`;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests green

- [ ] **Step 7: Commit**

```bash
git add package.json LICENSE .gitignore src/lib/langs.js src/lib/paths.js test/
git commit -m "Add the language map and archive path builder"
```

---
### Task 2: Verdict matcher

The one piece of logic that runs in the page's own world. It decides whether a JSON
response describes an accepted submission, by shape rather than by URL.

**Files:**
- Create: `src/lib/verdict.js`
- Test: `test/verdict.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `globalThis.LCA_VERDICT.matchVerdict(body: unknown): Verdict | null` where
  `Verdict = { submissionId: string, lang: string|null, runtime: string|null, memory: string|null, questionId: string|null }`

- [ ] **Step 1: Write the failing test**

`test/verdict.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/verdict.js'`

- [ ] **Step 3: Implement `src/lib/verdict.js`**

Note the IIFE-on-a-global shape: this file is loaded as a manifest content script into
the page's MAIN world, where `import` is unavailable. Tests import it for the side
effect and read the global.

```js
// Published on a global rather than exported: Chrome MV3 does not support ES modules
// in manifest-declared content scripts, and this file runs in the page's MAIN world.
globalThis.LCA_VERDICT = (() => {
  function firstString(...values) {
    for (const value of values) {
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return null;
  }

  // Matches on payload shape, not on URL. LeetCode has moved the submission check
  // endpoint before and will again; what stays stable is that the body names a
  // verdict and a submission.
  function matchVerdict(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

    const verdict = firstString(body.status_msg, body.statusDisplay);
    if (verdict !== 'Accepted') return null;

    const rawId = body.submission_id ?? body.submissionId ?? body.id;
    if (rawId === undefined || rawId === null || rawId === '') return null;

    return {
      submissionId: String(rawId),
      lang: firstString(body.lang, body.pretty_lang),
      // `status_memory` is "13.9 MB"; `memory` is 14200000 in the same payload but a
      // display string in the GraphQL one. Taking the first string handles both.
      runtime: firstString(body.status_runtime, body.runtime),
      memory: firstString(body.status_memory, body.memory),
      questionId: firstString(body.question_id, body.questionId),
    };
  }

  return { matchVerdict };
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/lib/verdict.js test/verdict.test.js
git commit -m "Recognise an accepted verdict by payload shape"
```

---

### Task 3: File and commit-message rendering

**Files:**
- Create: `src/lib/render.js`
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: nothing
- Produces, where `Record = { questionId, title, titleSlug, lang, code, runtime, memory, runtimePercentile, memoryPercentile, statement }`:
  - `commitMessage(record): string`
  - `readmeContent(record): string`
  - `notesContent(note: string): string`
  - `solutionContent(code: string): string`

- [ ] **Step 1: Write the failing test**

`test/render.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitMessage, readmeContent, notesContent, solutionContent } from '../src/lib/render.js';

const RECORD = {
  questionId: '49',
  title: 'Group Anagrams',
  titleSlug: 'group-anagrams',
  lang: 'python3',
  code: 'class Solution:\n    pass',
  runtime: '62 ms',
  memory: '13.9 MB',
  runtimePercentile: 19.26,
  memoryPercentile: 57.1,
  statement: '<p>Given an array of strings...</p>',
};

test('states the problem and both measurements in the commit subject', () => {
  assert.equal(
    commitMessage(RECORD),
    'solve: 49. Group Anagrams — Time 62 ms (19.26%), Space 13.9 MB (57.10%)'
  );
});

test('drops the percentiles when LeetCode did not report them', () => {
  assert.equal(
    commitMessage({ ...RECORD, runtimePercentile: null, memoryPercentile: null }),
    'solve: 49. Group Anagrams — Time 62 ms, Space 13.9 MB'
  );
});

test('falls back to the bare problem when there are no measurements at all', () => {
  assert.equal(
    commitMessage({ ...RECORD, runtime: null, memory: null, runtimePercentile: null, memoryPercentile: null }),
    'solve: 49. Group Anagrams'
  );
});

test('heads the README with a link back to the problem', () => {
  const readme = readmeContent(RECORD);
  assert.match(readme, /^<h2><a href="https:\/\/leetcode\.com\/problems\/group-anagrams\/">49\. Group Anagrams<\/a><\/h2>/);
  assert.match(readme, /<p>Given an array of strings\.\.\.<\/p>/);
  assert.match(readme, /\n$/);
});

test('says so rather than writing an empty README when the statement is unavailable', () => {
  const readme = readmeContent({ ...RECORD, statement: null });
  assert.match(readme, /not available/i);
});

test('ends every written file with a newline, as git prefers', () => {
  assert.equal(solutionContent('print(1)'), 'print(1)\n');
  assert.equal(solutionContent('print(1)\n'), 'print(1)\n');
  assert.match(notesContent('  sort the key  '), /^sort the key\n$/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/render.js'`

- [ ] **Step 3: Implement `src/lib/render.js`**

```js
function endWithNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function measurement(label, value, percentile) {
  if (!value) return null;
  if (percentile === null || percentile === undefined) return `${label} ${value}`;
  return `${label} ${value} (${Number(percentile).toFixed(2)}%)`;
}

export function commitMessage(record) {
  const head = `solve: ${Number(record.questionId)}. ${record.title}`;
  const parts = [
    measurement('Time', record.runtime, record.runtimePercentile),
    measurement('Space', record.memory, record.memoryPercentile),
  ].filter(Boolean);
  return parts.length ? `${head} — ${parts.join(', ')}` : head;
}

export function readmeContent(record) {
  const url = `https://leetcode.com/problems/${record.titleSlug}/`;
  const heading = `<h2><a href="${url}">${Number(record.questionId)}. ${record.title}</a></h2><hr>`;
  // A Premium-locked problem returns no statement. Saying so beats an empty file
  // that looks like the archive lost it.
  const body = record.statement || '<p><em>Problem statement not available.</em></p>';
  return endWithNewline(`${heading}${body}`);
}

export function solutionContent(code) {
  return endWithNewline(code);
}

export function notesContent(note) {
  return endWithNewline(note.trim());
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/lib/render.js test/render.test.js
git commit -m "Render the archived files and the commit subject"
```

---
### Task 4: GitHub Git Data API client

One submission is one commit holding up to three files. The Contents API writes one
file per commit, so this walks the Git Data API instead.

**Files:**
- Create: `src/background/github.js`
- Test: `test/github.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `commitFiles({ token, repo: {owner, name, branch}, message, files: [{path, content}], fetchImpl? }): Promise<{commitSha: string}>`
  - `class GitHubError extends Error` with `.status` and `.body`
  - `class AuthError extends GitHubError`

- [ ] **Step 1: Write the failing test**

`test/github.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/background/github.js'`

- [ ] **Step 3: Implement `src/background/github.js`**

```js
const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.body = body;
  }
}

export class AuthError extends GitHubError {
  constructor(message, status, body) {
    super(message, status, body);
    this.name = 'AuthError';
  }
}

async function call(fetchImpl, token, method, path, body) {
  const response = await fetchImpl(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const detail = parsed?.message || response.statusText;
    const message = `${method} ${path} failed: ${detail}`;
    if (response.status === 401) throw new AuthError(message, 401, parsed);
    throw new GitHubError(message, response.status, parsed);
  }
  return parsed;
}

export async function commitFiles({ token, repo, message, files, fetchImpl = fetch }) {
  const base = `/repos/${repo.owner}/${repo.name}`;
  const branch = repo.branch;
  let lastConflict;

  // Two attempts: one to lose a push race, one to win it.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ref = await call(fetchImpl, token, 'GET', `${base}/git/ref/heads/${branch}`);
    const headSha = ref.object.sha;
    const head = await call(fetchImpl, token, 'GET', `${base}/git/commits/${headSha}`);

    const entries = [];
    for (const file of files) {
      const blob = await call(fetchImpl, token, 'POST', `${base}/git/blobs`, {
        content: file.content,
        encoding: 'utf-8',
      });
      entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const tree = await call(fetchImpl, token, 'POST', `${base}/git/trees`, {
      base_tree: head.tree.sha,
      tree: entries,
    });
    const commit = await call(fetchImpl, token, 'POST', `${base}/git/commits`, {
      message,
      tree: tree.sha,
      parents: [headSha],
    });

    try {
      await call(fetchImpl, token, 'PATCH', `${base}/git/refs/heads/${branch}`, { sha: commit.sha });
      return { commitSha: commit.sha };
    } catch (error) {
      // Something else pushed between reading the ref and moving it. Rebuild on the
      // new head rather than forcing, which would throw their commit away.
      if (error.status !== 422 && error.status !== 409) throw error;
      lastConflict = error;
    }
  }
  throw lastConflict;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/background/github.js test/github.test.js
git commit -m "Write a submission as one commit through the Git Data API"
```

---

### Task 5: OAuth device flow

**Files:**
- Create: `src/background/oauth.js`
- Test: `test/oauth.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `CLIENT_ID: string` — `'Ov23liCEJVOZnAhTMT4z'`
  - `requestDeviceCode({ fetchImpl? }): Promise<{ deviceCode, userCode, verificationUri, interval, expiresIn }>`
  - `pollForToken({ deviceCode, interval, expiresIn, fetchImpl?, sleep? }): Promise<string>` — resolves to the access token
  - `class DeviceFlowError extends Error` with `.code` (`'expired_token'`, `'access_denied'`)

- [ ] **Step 1: Write the failing test**

`test/oauth.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestDeviceCode, pollForToken, DeviceFlowError, CLIENT_ID } from '../src/background/oauth.js';

function stubFetch(replies) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const reply = replies[calls.length - 1] ?? replies[replies.length - 1];
    return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
  };
  impl.calls = calls;
  return impl;
}

test('asks GitHub for a device code with the repo scope', async () => {
  const fetchImpl = stubFetch([
    { device_code: 'dev', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 },
  ]);
  const result = await requestDeviceCode({ fetchImpl });

  assert.equal(fetchImpl.calls[0].url, 'https://github.com/login/device/code');
  assert.deepEqual(fetchImpl.calls[0].body, { client_id: CLIENT_ID, scope: 'repo' });
  assert.deepEqual(result, {
    deviceCode: 'dev', userCode: 'ABCD-1234',
    verificationUri: 'https://github.com/login/device', interval: 5, expiresIn: 900,
  });
});

test('waits through authorization_pending until the user approves', async () => {
  const fetchImpl = stubFetch([
    { error: 'authorization_pending' },
    { error: 'authorization_pending' },
    { access_token: 'gho_token' },
  ]);
  const slept = [];
  const token = await pollForToken({
    deviceCode: 'dev', interval: 5, expiresIn: 900, fetchImpl,
    sleep: async (ms) => { slept.push(ms); },
  });

  assert.equal(token, 'gho_token');
  assert.deepEqual(slept, [5000, 5000]);
  assert.deepEqual(fetchImpl.calls[0].body, {
    client_id: CLIENT_ID,
    device_code: 'dev',
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
});

test('backs off by five seconds when GitHub says slow_down', async () => {
  const fetchImpl = stubFetch([{ error: 'slow_down' }, { access_token: 'gho_token' }]);
  const slept = [];
  await pollForToken({ deviceCode: 'dev', interval: 5, expiresIn: 900, fetchImpl, sleep: async (ms) => slept.push(ms) });
  assert.deepEqual(slept, [5000, 10000]);
});

test('gives up when the code expires', async () => {
  const fetchImpl = stubFetch([{ error: 'expired_token' }]);
  await assert.rejects(
    () => pollForToken({ deviceCode: 'dev', interval: 5, expiresIn: 900, fetchImpl, sleep: async () => {} }),
    (error) => error instanceof DeviceFlowError && error.code === 'expired_token'
  );
});

test('gives up when the user declines', async () => {
  const fetchImpl = stubFetch([{ error: 'access_denied' }]);
  await assert.rejects(
    () => pollForToken({ deviceCode: 'dev', interval: 5, expiresIn: 900, fetchImpl, sleep: async () => {} }),
    (error) => error instanceof DeviceFlowError && error.code === 'access_denied'
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/background/oauth.js'`

- [ ] **Step 3: Implement `src/background/oauth.js`**

```js
// Public by design: a device-flow client id carries no secret, which is exactly why
// this extension needs no server of its own.
export const CLIENT_ID = 'Ov23liCEJVOZnAhTMT4z';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export class DeviceFlowError extends Error {
  constructor(code, description) {
    super(description || code);
    this.name = 'DeviceFlowError';
    this.code = code;
  }
}

async function post(fetchImpl, url, body) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return JSON.parse(await response.text());
}

export async function requestDeviceCode({ fetchImpl = fetch } = {}) {
  const data = await post(fetchImpl, DEVICE_CODE_URL, { client_id: CLIENT_ID, scope: 'repo' });
  if (data.error) throw new DeviceFlowError(data.error, data.error_description);
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval,
    expiresIn: data.expires_in,
  };
}

export async function pollForToken({
  deviceCode,
  interval,
  expiresIn,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}) {
  const deadline = now() + expiresIn * 1000;
  let wait = interval;

  while (now() < deadline) {
    await sleep(wait * 1000);
    const data = await post(fetchImpl, ACCESS_TOKEN_URL, {
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    if (data.access_token) return data.access_token;
    if (data.error === 'authorization_pending') continue;
    // GitHub asks for five more seconds each time it says this.
    if (data.error === 'slow_down') { wait += 5; continue; }
    throw new DeviceFlowError(data.error || 'unknown_error', data.error_description);
  }
  throw new DeviceFlowError('expired_token', 'The device code expired before it was approved.');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/background/oauth.js test/oauth.test.js
git commit -m "Authenticate with GitHub through the OAuth device flow"
```

---
### Task 6: Storage adapter, dedupe ledger, retry queue

**Files:**
- Create: `src/lib/store.js`, `src/lib/ledger.js`, `src/background/queue.js`
- Test: `test/ledger.test.js`, `test/queue.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `createStore(area): { get(key, fallback), set(key, value), remove(key) }`
  - `memoryArea(initial?)` — an in-memory stand-in for `chrome.storage.local`, used by tests
  - `hasSynced(store, id): Promise<boolean>`, `markSynced(store, id): Promise<void>` — ledger capped at 5000 ids, oldest dropped first
  - `enqueue(store, record)`, `pending(store, now)`, `settle(store, record, outcome)`, `backoffMs(attempt)`, `MAX_ATTEMPTS`

- [ ] **Step 1: Write the failing tests**

`test/ledger.test.js`:

```js
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
```

`test/queue.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/store.js'`

- [ ] **Step 3: Implement `src/lib/store.js`**

```js
// A two-method view of chrome.storage.local so the rest of the code — and every test —
// never touches a Chrome global directly.
export function createStore(area) {
  return {
    async get(key, fallback = null) {
      const result = await area.get(key);
      return result && key in result ? result[key] : fallback;
    },
    async set(key, value) {
      await area.set({ [key]: value });
    },
    async remove(key) {
      await area.remove(key);
    },
  };
}

export function memoryArea(initial = {}) {
  const data = { ...initial };
  return {
    async get(key) {
      return key in data ? { [key]: data[key] } : {};
    },
    async set(entries) {
      Object.assign(data, entries);
    },
    async remove(key) {
      delete data[key];
    },
  };
}
```

- [ ] **Step 4: Implement `src/lib/ledger.js`**

```js
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
```

- [ ] **Step 5: Implement `src/background/queue.js`**

```js
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests green

- [ ] **Step 7: Commit**

```bash
git add src/lib/store.js src/lib/ledger.js src/background/queue.js test/ledger.test.js test/queue.test.js
git commit -m "Track what has been archived and what needs retrying"
```

---

### Task 7: LeetCode GraphQL client

Both the hook and the poller read LeetCode from the background service worker, so
there is one implementation of these queries rather than two.

**Files:**
- Create: `src/lib/leetcode.js`
- Test: `test/leetcode.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `fetchSubmissionDetails(submissionId, { fetchImpl, csrfToken }): Promise<{ code, runtimePercentile, memoryPercentile, questionId }>`
  - `fetchQuestionStatement(titleSlug, { fetchImpl, csrfToken }): Promise<string|null>` — `null` when Premium-locked
  - `fetchRecentSubmissions({ fetchImpl, csrfToken, limit? }): Promise<Array<{id, lang, timestamp, statusDisplay, runtime, memory, title, titleSlug}>>`
  - `class PremiumLockedError extends Error`

- [ ] **Step 1: Write the failing test**

`test/leetcode.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/leetcode.js'`

- [ ] **Step 3: Implement `src/lib/leetcode.js`**

Every field named here is one `joshcai/leetcode-sync@v1.7` queries in production. The
schema is unpublished and rejects a query wholesale on an unknown field, so do not add
to these selections without evidence they exist.

```js
const ENDPOINT = 'https://leetcode.com/graphql/';

export class PremiumLockedError extends Error {
  constructor(what) {
    super(`${what} is locked behind LeetCode Premium`);
    this.name = 'PremiumLockedError';
  }
}

async function query(operation, variables, { fetchImpl = fetch, csrfToken }) {
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrftoken': csrfToken,
      Referer: 'https://leetcode.com',
    },
    body: JSON.stringify({ query: operation, variables }),
  });

  if (response.status === 403) throw new PremiumLockedError('this problem');
  const payload = JSON.parse(await response.text());
  if (!payload.data) {
    throw new Error(payload.errors?.map((e) => e.message).join('; ') || 'LeetCode returned no data');
  }
  return payload.data;
}

const SUBMISSION_DETAILS = `query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    runtimePercentile
    memoryPercentile
    code
    question { questionId }
  }
}`;

const QUESTION_DETAIL = `query getQuestionDetail($titleSlug: String!) {
  question(titleSlug: $titleSlug) { content }
}`;

const SUBMISSION_LIST = `query recent($offset: Int!, $limit: Int!, $slug: String) {
  submissionList(offset: $offset, limit: $limit, questionSlug: $slug) {
    hasNext
    submissions { id lang timestamp statusDisplay runtime memory title titleSlug }
  }
}`;

export async function fetchSubmissionDetails(submissionId, options) {
  const data = await query(SUBMISSION_DETAILS, { submissionId: Number(submissionId) }, options);
  const details = data.submissionDetails;
  if (!details) throw new Error(`no details for submission ${submissionId}`);
  return {
    code: details.code,
    runtimePercentile: details.runtimePercentile ?? null,
    memoryPercentile: details.memoryPercentile ?? null,
    questionId: details.question?.questionId ?? null,
  };
}

export async function fetchQuestionStatement(titleSlug, options) {
  try {
    const data = await query(QUESTION_DETAIL, { titleSlug }, options);
    return data.question?.content ?? null;
  } catch (error) {
    // A locked problem is a fact about the account, not a failure to retry.
    if (error instanceof PremiumLockedError) return null;
    throw error;
  }
}

export async function fetchRecentSubmissions({ limit = 20, ...options }) {
  const data = await query(SUBMISSION_LIST, { offset: 0, limit, slug: null }, options);
  return data.submissionList?.submissions ?? [];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/lib/leetcode.js test/leetcode.test.js
git commit -m "Read submissions and statements from LeetCode's GraphQL API"
```

---
### Task 8: Manifest, detector, bridge

The first slice that runs in a browser. After this task, submitting an accepted
solution logs a submission id in the service worker console.

**Files:**
- Create: `manifest.json`, `src/content/detector.js`, `src/content/bridge.js`, `src/background/service-worker.js`
- Test: manual (browser)

**Interfaces:**
- Consumes: `globalThis.LCA_VERDICT.matchVerdict` (Task 2)
- Produces: a runtime message `{ type: 'lca:accepted', verdict: Verdict, titleSlug: string }` delivered to the service worker

- [ ] **Step 1: Write `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "LeetCode Archive",
  "version": "0.1.0",
  "description": "Archive accepted LeetCode submissions to GitHub the moment they pass",
  "permissions": ["storage", "cookies", "alarms"],
  "host_permissions": [
    "https://leetcode.com/*",
    "https://api.github.com/*",
    "https://github.com/*"
  ],
  "background": {
    "service_worker": "src/background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://leetcode.com/*"],
      "world": "MAIN",
      "run_at": "document_start",
      "js": ["src/lib/verdict.js", "src/content/detector.js"]
    },
    {
      "matches": ["https://leetcode.com/*"],
      "world": "ISOLATED",
      "run_at": "document_start",
      "js": ["src/content/bridge.js"]
    }
  ],
  "action": { "default_title": "LeetCode Archive" }
}
```

`action.default_popup` and `options_page` are deliberately absent here — Chrome refuses
to load a manifest that names a file which does not exist yet. Task 10 adds the popup
entry and Task 12 adds the options page.

`run_at: "document_start"` matters: the detector has to wrap `fetch` before the page
captures its own reference to it.

- [ ] **Step 2: Write `src/content/detector.js`**

```js
// Runs in the page's MAIN world so it can see the page's own fetch/XHR traffic.
// It reports a submission id and nothing else across the world boundary.
(() => {
  const { matchVerdict } = globalThis.LCA_VERDICT;
  const seen = new Set();

  function report(text) {
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return; // not JSON; nothing here describes a submission
    }
    const verdict = matchVerdict(body);
    // The page polls the same verdict several times; report each submission once.
    if (!verdict || seen.has(verdict.submissionId)) return;
    seen.add(verdict.submissionId);
    window.postMessage({ source: 'leetcode-archive', verdict }, window.location.origin);
  }

  const nativeFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await nativeFetch.apply(this, args);
    // Read from a clone so the page still gets an unconsumed body.
    response.clone().text().then(report).catch(() => {});
    return response;
  };

  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      if (typeof this.responseText === 'string') report(this.responseText);
    });
    return nativeSend.apply(this, args);
  };
})();
```

- [ ] **Step 3: Write `src/content/bridge.js`**

```js
// The MAIN world cannot reach chrome.runtime, and the isolated world cannot see the
// page's fetch. This is the seam between them, and it forwards nothing else.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'leetcode-archive' || !data.verdict) return;

  const match = window.location.pathname.match(/\/problems\/([^/]+)/);
  chrome.runtime.sendMessage({
    type: 'lca:accepted',
    verdict: data.verdict,
    titleSlug: match ? match[1] : null,
  });
});
```

- [ ] **Step 4: Write a minimal `src/background/service-worker.js`**

```js
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'lca:accepted') return;
  console.log('[leetcode-archive] accepted', message.verdict.submissionId, message.titleSlug);
});
```

- [ ] **Step 5: Load and verify in Chrome**

1. `chrome://extensions` → Developer mode on → Load unpacked → select the repository root
2. Open a LeetCode problem, submit a solution that passes
3. On `chrome://extensions`, click the extension's "service worker" link
4. Expected in that console: `[leetcode-archive] accepted <id> <slug>`

If nothing logs, check that the detector loaded at `document_start` — a page that
captured `fetch` before the wrapper installed will bypass it.

- [ ] **Step 6: Commit**

```bash
git add manifest.json src/content/ src/background/service-worker.js
git commit -m "Detect an accepted submission and relay it to the worker"
```

---

### Task 9: Archive pipeline

**Files:**
- Create: `src/background/archive.js`
- Modify: `src/background/service-worker.js`
- Test: `test/archive.test.js`

**Interfaces:**
- Consumes: `fetchSubmissionDetails`, `fetchQuestionStatement` (Task 7); `commitFiles`, `AuthError` (Tasks 4); `hasSynced`, `markSynced` (Task 6); `commitMessage`, `readmeContent`, `solutionContent` (Task 3); `solutionPath`, `readmePath` (Task 1)
- Produces: `archiveSubmission({ verdict, titleSlug, title }, deps): Promise<{ status: 'committed'|'skipped'|'locked', commitSha?: string }>`

- [ ] **Step 1: Write the failing test**

`test/archive.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveSubmission } from '../src/background/archive.js';
import { createStore, memoryArea } from '../src/lib/store.js';

const VERDICT = { submissionId: '829384756', lang: 'python3', runtime: '62 ms', memory: '13.9 MB', questionId: '49' };

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
  const result = await archiveSubmission({ verdict: VERDICT, titleSlug: 'group-anagrams', title: 'Group Anagrams' }, d);

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
  const job = { verdict: VERDICT, titleSlug: 'group-anagrams', title: 'Group Anagrams' };

  const first = await archiveSubmission(job, deps({ store }));
  assert.equal(first.status, 'committed');

  // The poller and the hook both see the same submission. The second one must not
  // reach GitHub at all.
  const second = await archiveSubmission(job, deps({
    store,
    commit: async () => { throw new Error('should not have committed twice'); },
  }));
  assert.equal(second.status, 'skipped');
});

test('does not record a submission it failed to commit', async () => {
  const store = createStore(memoryArea());
  const d = deps({ store, commit: async () => { throw new Error('network down'); } });
  await assert.rejects(() => archiveSubmission({ verdict: VERDICT, titleSlug: 'group-anagrams', title: 'Group Anagrams' }, d));
  assert.deepEqual(await store.get('synced', []), []);
});

test('still archives the solution when the statement is Premium-locked', async () => {
  const committed = [];
  const d = deps({ fetchStatement: async () => null, commit: async (args) => { committed.push(args); return { commitSha: 'x' }; } });
  const result = await archiveSubmission({ verdict: VERDICT, titleSlug: 'group-anagrams', title: 'Group Anagrams' }, d);
  assert.equal(result.status, 'committed');
  assert.match(committed[0].files[1].content, /not available/i);
});

test('takes the question id from the details when the verdict omits it', async () => {
  const committed = [];
  const d = deps({ commit: async (args) => { committed.push(args); return { commitSha: 'x' }; } });
  await archiveSubmission({ verdict: { ...VERDICT, questionId: null }, titleSlug: 'group-anagrams', title: 'Group Anagrams' }, d);
  assert.match(committed[0].files[0].path, /^0049-group-anagrams\//);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/background/archive.js'`

- [ ] **Step 3: Implement `src/background/archive.js`**

```js
import { hasSynced, markSynced } from '../lib/ledger.js';
import { solutionPath, readmePath } from '../lib/paths.js';
import { commitMessage, readmeContent, solutionContent } from '../lib/render.js';

// `deps` is injected rather than imported so the pipeline can be tested without a
// browser, a network, or a GitHub account.
export async function archiveSubmission({ verdict, titleSlug, title }, deps) {
  const { store, repo, token, csrfToken, fetchDetails, fetchStatement, commit } = deps;

  if (await hasSynced(store, verdict.submissionId)) {
    return { status: 'skipped' };
  }

  const details = await fetchDetails(verdict.submissionId, { csrfToken });
  const statement = await fetchStatement(titleSlug, { csrfToken });
  const questionId = verdict.questionId ?? details.questionId;
  if (!questionId) throw new Error(`no question id for submission ${verdict.submissionId}`);

  const record = {
    questionId,
    title: title || titleSlug,
    titleSlug,
    lang: verdict.lang,
    code: details.code,
    runtime: verdict.runtime,
    memory: verdict.memory,
    runtimePercentile: details.runtimePercentile,
    memoryPercentile: details.memoryPercentile,
    statement,
  };

  const { commitSha } = await commit({
    token,
    repo,
    message: commitMessage(record),
    files: [
      { path: solutionPath(questionId, titleSlug, verdict.lang), content: solutionContent(record.code) },
      { path: readmePath(questionId, titleSlug), content: readmeContent(record) },
    ],
  });

  // Only after the commit lands. Recording it earlier would lose the submission if
  // the write failed.
  await markSynced(store, verdict.submissionId);
  return { status: 'committed', commitSha, questionId };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all tests green

- [ ] **Step 5: Wire it into `src/background/service-worker.js`**

```js
import { archiveSubmission } from './archive.js';
import { commitFiles, AuthError } from './github.js';
import { fetchSubmissionDetails, fetchQuestionStatement } from '../lib/leetcode.js';
import { createStore } from '../lib/store.js';
import { enqueue, pending, settle } from './queue.js';

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

async function run(job) {
  const token = await store.get('token');
  if (!token) {
    await setBadge('!', '#d29922');
    return { status: 'unauthenticated' };
  }

  try {
    const result = await archiveSubmission(job, {
      store,
      repo: await store.get('repo', DEFAULT_REPO),
      token,
      csrfToken: await csrfToken(),
      fetchDetails: fetchSubmissionDetails,
      fetchStatement: fetchQuestionStatement,
      commit: commitFiles,
    });
    await setBadge('');
    await settle(store, job.verdict, 'ok', Date.now());
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
    await enqueue(store, { ...job.verdict, job }, Date.now());
    await setBadge('!', '#f85149');
    console.error('[leetcode-archive]', error);
    return { status: 'error' };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'lca:accepted') return undefined;
  run({ verdict: message.verdict, titleSlug: message.titleSlug, title: message.title })
    .then(sendResponse);
  return true; // keep the channel open for the async reply
});

chrome.alarms.create('lca:drain', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'lca:drain') return;
  for (const entry of await pending(store, Date.now())) {
    await run(entry.job);
  }
});
```

- [ ] **Step 6: Verify in Chrome**

Reload the extension, submit an accepted solution, confirm a commit appears in
`hyeseonko/LeetCode` within seconds. Without a token yet the badge shows an amber `!`
— that is Task 10's job.

- [ ] **Step 7: Commit**

```bash
git add src/background/archive.js src/background/service-worker.js test/archive.test.js
git commit -m "Archive an accepted submission end to end"
```

---
### Task 10: Popup — sign in and see status

**Files:**
- Create: `src/popup/popup.html`, `src/popup/popup.js`, `src/popup/popup.css`
- Modify: `src/background/service-worker.js` (handle `lca:auth-start`, `lca:status`)
- Test: manual (browser)

**Interfaces:**
- Consumes: `requestDeviceCode`, `pollForToken`, `DeviceFlowError` (Task 5)
- Produces: runtime messages `{ type: 'lca:auth-start' }` → `{ userCode, verificationUri }`, and `{ type: 'lca:status' }` → `{ signedIn, repo, queued, failed }`

- [ ] **Step 1: Write `src/popup/popup.html`**

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><link rel="stylesheet" href="popup.css" /></head>
  <body>
    <h1>LeetCode Archive</h1>
    <p id="status">Checking…</p>
    <div id="code-box" hidden>
      <p>Enter this code at <a id="verify-link" target="_blank" rel="noreferrer">github.com/login/device</a>:</p>
      <output id="user-code"></output>
    </div>
    <button id="sign-in" hidden>Connect GitHub</button>
    <a href="#" id="open-options">Settings</a>
    <script src="popup.js" type="module"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `src/popup/popup.js`**

```js
const $ = (id) => document.getElementById(id);

async function render() {
  const status = await chrome.runtime.sendMessage({ type: 'lca:status' });
  if (status.signedIn) {
    const queued = status.queued ? `, ${status.queued} waiting to retry` : '';
    const failed = status.failed ? `, ${status.failed} gave up` : '';
    $('status').textContent = `Archiving to ${status.repo.owner}/${status.repo.name}${queued}${failed}`;
    $('sign-in').hidden = true;
  } else {
    $('status').textContent = 'Not connected to GitHub.';
    $('sign-in').hidden = false;
  }
}

$('sign-in').addEventListener('click', async () => {
  $('sign-in').disabled = true;
  $('status').textContent = 'Asking GitHub for a code…';
  const started = await chrome.runtime.sendMessage({ type: 'lca:auth-start' });
  if (started.error) {
    $('status').textContent = `Could not start sign-in: ${started.error}`;
    $('sign-in').disabled = false;
    return;
  }
  $('user-code').textContent = started.userCode;
  $('verify-link').href = started.verificationUri;
  $('code-box').hidden = false;
  $('status').textContent = 'Waiting for approval…';
  // The worker keeps polling even if this popup closes; reopening shows the result.
});

$('open-options').addEventListener('click', (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'lca:auth-done') render();
});

render();
```

- [ ] **Step 3: Write `src/popup/popup.css`**

```css
body { font: 13px/1.5 system-ui, sans-serif; margin: 0; padding: 14px; width: 260px; }
h1 { font-size: 14px; margin: 0 0 8px; }
output { display: block; font: 20px/1.2 ui-monospace, monospace; letter-spacing: 2px; margin: 6px 0; }
button { width: 100%; padding: 6px; margin: 8px 0; }
a { font-size: 12px; }
```

- [ ] **Step 4: Point the toolbar action at the popup in `manifest.json`**

```json
  "action": { "default_title": "LeetCode Archive", "default_popup": "src/popup/popup.html" }
```

- [ ] **Step 5: Add the message handlers to `src/background/service-worker.js`**

Add these imports and extend the existing `onMessage` listener:

```js
import { requestDeviceCode, pollForToken, DeviceFlowError } from './oauth.js';

async function status() {
  return {
    signedIn: Boolean(await store.get('token')),
    repo: await store.get('repo', DEFAULT_REPO),
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
```

and route them:

```js
  if (message?.type === 'lca:status') { status().then(sendResponse); return true; }
  if (message?.type === 'lca:auth-start') { startAuth().then(sendResponse); return true; }
```

- [ ] **Step 5: Verify in Chrome**

Reload, click the extension icon, click Connect GitHub, enter the code at
`github.com/login/device`, approve. Reopen the popup: it should read
`Archiving to hyeseonko/LeetCode`. Then submit an accepted solution and confirm the
commit lands.

- [ ] **Step 6: Commit**

```bash
git add src/popup/ src/background/service-worker.js
git commit -m "Connect a GitHub account from the popup"
```

---

### Task 11: Note panel

**Files:**
- Create: `src/content/note-panel.js`, `src/content/note-panel.css`
- Modify: `manifest.json` (add the panel to the isolated content scripts and its CSS), `src/background/service-worker.js` (handle `lca:note`)
- Test: manual (browser)

**Interfaces:**
- Consumes: the `lca:committed` broadcast from Task 9
- Produces: runtime message `{ type: 'lca:note', job, note }` → commits `NOTES.md` as a follow-up commit

- [ ] **Step 1: Write `src/content/note-panel.js`**

```js
// The solution is already committed by the time this appears. A note is an addition,
// never a gate — ignoring this panel must not cost you the archive entry.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'lca:committed') return;
  show(message.job);
});

function show(job) {
  document.getElementById('lca-note')?.remove();

  const panel = document.createElement('div');
  panel.id = 'lca-note';
  panel.innerHTML = `
    <p>Archived. Anything worth remembering?</p>
    <textarea rows="3" placeholder="e.g. sort the counter into a tuple key"></textarea>
    <div><button data-act="save">Save note</button><button data-act="close">Dismiss</button></div>
  `;

  const close = () => panel.remove();
  panel.querySelector('[data-act="close"]').addEventListener('click', close);
  panel.querySelector('[data-act="save"]').addEventListener('click', () => {
    const note = panel.querySelector('textarea').value.trim();
    if (note) chrome.runtime.sendMessage({ type: 'lca:note', job, note });
    close();
  });

  document.body.appendChild(panel);
  setTimeout(() => { if (!panel.querySelector('textarea').value) close(); }, 60000);
}
```

- [ ] **Step 2: Write `src/content/note-panel.css`**

```css
#lca-note {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  width: 300px; padding: 12px; border-radius: 8px;
  background: #1e1e1e; color: #eee; box-shadow: 0 4px 20px rgba(0,0,0,.4);
  font: 13px/1.4 system-ui, sans-serif;
}
#lca-note p { margin: 0 0 8px; }
#lca-note textarea { width: 100%; box-sizing: border-box; background: #2b2b2b; color: inherit; border: 1px solid #444; border-radius: 4px; }
#lca-note div { display: flex; gap: 6px; margin-top: 8px; }
#lca-note button { flex: 1; padding: 5px; }
```

- [ ] **Step 3: Register it in `manifest.json`**

Extend the ISOLATED content script entry:

```json
{
  "matches": ["https://leetcode.com/*"],
  "world": "ISOLATED",
  "run_at": "document_start",
  "js": ["src/content/bridge.js", "src/content/note-panel.js"],
  "css": ["src/content/note-panel.css"]
}
```

- [ ] **Step 4: Handle `lca:note` in `src/background/service-worker.js`**

```js
import { notesPath } from '../lib/paths.js';
import { notesContent } from '../lib/render.js';

async function saveNote({ job, note }) {
  const token = await store.get('token');
  if (!token) return { status: 'unauthenticated' };
  // Not job.verdict.questionId: that is null whenever the poller found the
  // submission. archive.js resolves the real id and sends it back in the broadcast.
  const { questionId } = job;
  if (!questionId) return { status: 'skipped' };
  await commitFiles({
    token,
    repo: await store.get('repo', DEFAULT_REPO),
    message: `notes: ${Number(questionId)}. ${job.title || job.titleSlug}`,
    files: [{ path: notesPath(questionId, job.titleSlug), content: notesContent(note) }],
  });
  return { status: 'committed' };
}
```

route it:

```js
  if (message?.type === 'lca:note') { saveNote(message).then(sendResponse); return true; }
```

- [ ] **Step 5: Verify in Chrome**

Submit an accepted solution; the panel appears bottom-right; type a note, Save;
confirm a second commit adds `NOTES.md`. Then submit again and dismiss the panel;
confirm the solution commit still landed.

- [ ] **Step 6: Commit**

```bash
git add src/content/note-panel.js src/content/note-panel.css manifest.json src/background/service-worker.js
git commit -m "Capture a note while the problem is still fresh"
```

---

### Task 12: Options page

**Files:**
- Create: `src/options/options.html`, `src/options/options.js`
- Test: manual (browser)

- [ ] **Step 1: Write `src/options/options.html`**

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>LeetCode Archive settings</title></head>
  <body>
    <h1>LeetCode Archive</h1>
    <label>Owner <input id="owner" /></label>
    <label>Repository <input id="name" /></label>
    <label>Branch <input id="branch" /></label>
    <button id="save">Save</button>
    <button id="sign-out">Disconnect GitHub</button>
    <p id="msg"></p>
    <script src="options.js" type="module"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `src/options/options.js`**

```js
const DEFAULT_REPO = { owner: 'hyeseonko', name: 'LeetCode', branch: 'main' };
const $ = (id) => document.getElementById(id);

const { repo = DEFAULT_REPO } = await chrome.storage.local.get('repo');
$('owner').value = repo.owner;
$('name').value = repo.name;
$('branch').value = repo.branch;

$('save').addEventListener('click', async () => {
  const next = { owner: $('owner').value.trim(), name: $('name').value.trim(), branch: $('branch').value.trim() || 'main' };
  if (!next.owner || !next.name) {
    $('msg').textContent = 'Owner and repository are both required.';
    return;
  }
  await chrome.storage.local.set({ repo: next });
  $('msg').textContent = `Archiving to ${next.owner}/${next.name} on ${next.branch}.`;
});

$('sign-out').addEventListener('click', async () => {
  await chrome.storage.local.remove('token');
  $('msg').textContent = 'Disconnected. Reconnect from the popup.';
});
```

- [ ] **Step 3: Register the page in `manifest.json`**

```json
  "options_page": "src/options/options.html"
```

- [ ] **Step 4: Verify in Chrome**

Open the extension's options, change the branch to a scratch branch, submit a
solution, confirm the commit lands on that branch. Change it back.

- [ ] **Step 4: Commit**

```bash
git add src/options/
git commit -m "Let the target repository be configured"
```

---

### Task 13: Poller safety net

**Files:**
- Create: `src/background/poller.js`
- Modify: `src/background/service-worker.js`
- Test: `test/poller.test.js`

**Interfaces:**
- Consumes: `fetchRecentSubmissions` (Task 7), `hasSynced` (Task 6), `matchVerdict` semantics (Task 2)
- Produces: `sweep({ store, csrfToken, fetchRecent, archive }): Promise<number>` — the number of submissions it archived

- [ ] **Step 1: Write the failing test**

`test/poller.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/background/poller.js'`

- [ ] **Step 3: Implement `src/background/poller.js`**

```js
import { hasSynced } from '../lib/ledger.js';

// The hook misses submissions made while the worker was asleep, in another browser,
// or through a UI path that never touches fetch. This is the floor under it.
export async function sweep({ store, csrfToken, fetchRecent, archive }) {
  const submissions = await fetchRecent({ csrfToken });
  let archived = 0;

  for (const submission of submissions) {
    if (submission.statusDisplay !== 'Accepted') continue;
    const submissionId = String(submission.id);
    if (await hasSynced(store, submissionId)) continue;

    try {
      await archive({
        verdict: {
          submissionId,
          lang: submission.lang,
          runtime: submission.runtime ?? null,
          memory: submission.memory ?? null,
          questionId: null,
        },
        titleSlug: submission.titleSlug,
        title: submission.title,
      });
      archived += 1;
    } catch (error) {
      // One bad submission must not strand the rest of the sweep.
      console.error('[leetcode-archive] sweep skipped', submissionId, error);
    }
  }
  return archived;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all tests green

- [ ] **Step 5: Schedule it in `src/background/service-worker.js`**

```js
import { sweep } from './poller.js';
import { fetchRecentSubmissions } from '../lib/leetcode.js';

chrome.alarms.create('lca:sweep', { periodInMinutes: 5 });
```

and extend the alarm listener:

```js
  if (alarm.name === 'lca:sweep' && (await store.get('token'))) {
    await sweep({
      store,
      csrfToken: await csrfToken(),
      fetchRecent: fetchRecentSubmissions,
      archive: run,
    });
  }
```

- [ ] **Step 6: Verify in Chrome**

Disable the extension, submit an accepted solution, re-enable it, and wait for the
five-minute alarm (or trigger it from the service worker console with
`chrome.alarms.create('lca:sweep', { when: Date.now() + 1000 })`). The missed
submission should appear as a commit.

- [ ] **Step 7: Commit**

```bash
git add src/background/poller.js src/background/service-worker.js test/poller.test.js
git commit -m "Sweep for submissions the hook missed"
```

---

### Task 14: Contributor documentation and CI

**Files:**
- Create: `README.md`, `CONTRIBUTING.md`, `.github/workflows/ci.yml`

- [ ] **Step 1: Write `README.md`**

Cover, in this order: what it does in two sentences; install (load unpacked, no build
step); connect GitHub (popup → device code); configure the target repository; what a
commit looks like; how it works in one paragraph with a pointer to `docs/design.md`;
what it does not do (the Out of scope list from the design); licence.

- [ ] **Step 2: Write `CONTRIBUTING.md`**

Cover: `npm test` is the whole test suite and needs no install; the repository has no
build step and no dependencies, and pull requests adding either need to argue for it;
`src/lib/` holds the pure logic and is where new behaviour should get its tests;
content scripts cannot use ES modules, hence the `globalThis.LCA_*` shape; do not add
GraphQL fields without evidence LeetCode's schema has them.

- [ ] **Step 3: Write `.github/workflows/ci.yml`**

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm test
```

- [ ] **Step 4: Verify**

Run: `npm test` locally, then push and confirm the workflow passes on GitHub.

- [ ] **Step 5: Commit**

```bash
git add README.md CONTRIBUTING.md .github/workflows/ci.yml
git commit -m "Document the project and run the tests in CI"
```

---

### Task 15: Retire the Actions sync in hyeseonko/LeetCode

The extension replaces it. Leaving it running would produce duplicate commits in a
different directory-naming convention, and its expiring cookie is the failure mode
this whole project exists to remove.

**Files (in `hyeseonko/LeetCode`, not this repository):**
- Delete: `.github/workflows/sync.yml`
- Keep: `.github/workflows/index.yml`, `scripts/build_readme.py`

- [ ] **Step 1: Remove the workflow**

```bash
cd /Users/user/personal/LeetCode
git rm .github/workflows/sync.yml
git commit -m "Retire the polling sync in favour of the browser extension"
git push
```

- [ ] **Step 2: Remove the credentials it needed**

```bash
gh secret delete LEETCODE_SESSION -R hyeseonko/LeetCode
gh secret delete LEETCODE_CSRF_TOKEN -R hyeseonko/LeetCode
gh secret list -R hyeseonko/LeetCode
```

Expected: no LeetCode secrets remain.

- [ ] **Step 3: Confirm the index workflow still runs**

Run: `gh run list -R hyeseonko/LeetCode --workflow "rebuild index" --limit 3`
Expected: the most recent run succeeded.

---

## Notes for the executor

- Tasks 1–7 and 9 and 13 are pure and testable; run `npm test` after each.
- Tasks 8, 10, 11, 12 need a browser. Load unpacked from the repository root and use
  the service worker console on `chrome://extensions` for logs.
- Task 15 touches a different repository. Do it last, once the extension has archived
  at least one real submission.
