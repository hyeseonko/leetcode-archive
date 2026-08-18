# Design

## What this is

A Chrome extension (Manifest V3) that commits an accepted LeetCode submission to a
GitHub repository within seconds of it passing — the solution source, the problem
statement, the runtime/memory numbers, and an optional note you type while the
problem is still fresh.

## Why it exists

The established tool for this, LeetHub, is a browser extension that scrapes the
LeetCode DOM. When LeetCode reworks its UI the extension stops working, and because
it fails silently the user does not find out until they notice a gap in their commit
history. The reference archive this was built for lost four years that way.

Server-side pollers (GitHub Actions running `leetcode-sync` on a cron) avoid the DOM
problem but need a `LEETCODE_SESSION` cookie in repository secrets. That cookie
expires roughly every two weeks, and a rejected session surfaces as
`TypeError: submissions is not iterable` rather than "your cookie expired".

This extension takes the browser's advantage — it is already authenticated as you —
without taking the DOM's fragility.

## Architecture

| Component | World | Responsibility |
|---|---|---|
| `src/content/detector.js` | MAIN | Wraps `fetch` and `XMLHttpRequest`, recognises a submission verdict in any response body, posts the submission id to the isolated world |
| `src/content/collector.js` | ISOLATED | Calls the LeetCode GraphQL API for code, stats and problem statement; forwards a complete record to the background |
| `src/content/note-panel.js` | ISOLATED | Renders the note box after a successful commit |
| `src/background/service-worker.js` | — | Message router, dedupe, retry queue, badge state |
| `src/background/github.js` | — | Git Data API — blobs, tree, commit, ref |
| `src/background/oauth.js` | — | OAuth device flow, token storage |
| `src/background/poller.js` | — | Safety-net sweep of recent submissions |
| `src/lib/*` | — | Pure functions: language map, path builder, markdown renderer, response parser |

Everything with logic worth trusting lives in `src/lib/` and is tested with
`node --test`. The Chrome and network surfaces are thin enough to read.

## Flow

```
LeetCode page
  │ user submits, LeetCode returns a verdict
  ▼
detector.js (MAIN)         recognises { status_msg: "Accepted", submission_id }
  │ window.postMessage
  ▼
collector.js (ISOLATED)    GraphQL: submissionDetails + question.content
  │ chrome.runtime.sendMessage
  ▼
service-worker.js          seen before? → drop.  otherwise → github.js
  │
  ▼
github.js                  3 blobs → 1 tree → 1 commit → 1 ref update
  │
  ▼
note-panel.js              "saved. add a note?" → second commit if they do
```

### Detection is shape-based, not URL-based

`detector.js` does not match on `/submissions/detail/{id}/check/`. It inspects every
JSON response body the page receives and accepts one that satisfies both tests:

- a verdict reading `Accepted` in any of `status_msg`, `statusDisplay`, or
  `state`-plus-`status_msg`
- a submission identifier in any of `submission_id`, `submissionId`, or `id`

When LeetCode moves the endpoint — and it will — the detector keeps working as long
as the payload still describes a submission. If both shapes ever change at once the
poller still catches the submission, five minutes later.

### The poller is not redundant

The hook misses submissions made while the extension was reloading, made in another
browser, or made through a UI path that does not go through `fetch`. Every five
minutes the background worker asks LeetCode for the recent submission list and syncs
anything the hook did not. Both paths converge on the same dedupe set, so a
submission caught twice is committed once.

## Data collection

Three GraphQL queries against `https://leetcode.com/graphql/`, issued from the
content script so the browser attaches the session cookie automatically. The only
header the extension sets by hand is `x-csrftoken`, read from the non-httpOnly
`csrftoken` cookie.

Every field below is one that `joshcai/leetcode-sync@v1.7` queries in production.
The schema is not published and rejects a query wholesale if it names a field that
does not exist, so this project asks only for fields with a working precedent and
takes everything else from data it already holds.

```graphql
query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    runtimePercentile
    memoryPercentile
    code
    question { questionId }
  }
}

query getQuestionDetail($titleSlug: String!) {
  question(titleSlug: $titleSlug) { content }
}

query recent($offset: Int!, $limit: Int!, $slug: String) {
  submissionList(offset: $offset, limit: $limit, questionSlug: $slug) {
    hasNext
    submissions { id lang timestamp statusDisplay runtime memory title titleSlug }
  }
}
```

The rest of a record comes from what each path already has:

| Field | Hook path | Poller path |
|---|---|---|
| submission id | verdict payload | `submissionList.id` |
| title, titleSlug | page URL | `submissionList` |
| language | verdict payload, else `submissionList` | `submissionList.lang` |
| runtime / memory display | verdict payload, else `submissionList` | `submissionList` |
| percentiles, code, questionId | `submissionDetails` | `submissionDetails` |
| problem statement | `question.content` | `question.content` |

A `403` on any query means the problem is Premium-locked. Skip it, record it as
skipped, and do not retry — retrying cannot fix a subscription.

## GitHub authentication

OAuth device flow, client id `Ov23liCEJVOZnAhTMT4z`. The client id is public by
design and is compiled into the extension.

1. `POST https://github.com/login/device/code` with `client_id` and `scope=repo`
2. Show the nine-character user code; open `https://github.com/login/device`
3. Poll `POST https://github.com/login/oauth/access_token` at the returned interval,
   honouring `authorization_pending`, `slow_down`, `expired_token` and `access_denied`

Device flow needs no client secret, so the extension needs no server. Background
`fetch` is exempt from CORS for hosts listed in `host_permissions`, which is why
this works from the service worker and would not work from a page.

The token goes in `chrome.storage.local`. Not `storage.sync` — a credential should
not be replicated to every machine signed into the browser profile.

## Writing to GitHub

One submission is one commit containing up to three files. The Contents API writes
one file per commit, so this uses the Git Data API instead:

```
GET  /repos/{owner}/{repo}/git/ref/heads/{branch}     → base sha
POST /repos/{owner}/{repo}/git/blobs            × 3   → blob shas
POST /repos/{owner}/{repo}/git/trees                  → tree sha (base_tree = base)
POST /repos/{owner}/{repo}/git/commits                → commit sha
PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}   → move the branch
```

A `409`/non-fast-forward on the final PATCH means something else pushed in between.
Re-read the ref and replay; do not force.

## Repository layout written

Matching the existing archive's convention:

```
0049-group-anagrams/
  0049-group-anagrams.py   the submitted source, language-appropriate extension
  README.md                problem statement HTML from LeetCode
  NOTES.md                 your note, written only if you type one
```

Problem numbers are zero-padded to four digits so directories sort in problem order.

Commit message:

```
solve: 49. Group Anagrams — Time 62 ms (19.26%), Space 13.9 MB (57.10%)
```

## State

`chrome.storage.local` holds:

- `token` — GitHub access token
- `repo` — `{ owner, name, branch }`, default `hyeseonko/LeetCode` on `main`
- `synced` — submission ids already committed, capped at the most recent 5000
- `queue` — records that failed to commit, with attempt counts

## Failure handling

| Condition | Response |
|---|---|
| No token | Badge turns amber; clicking the icon starts device flow |
| `401` from GitHub | Token cleared, badge amber, re-authentication prompted |
| `403` from LeetCode | Premium-locked; recorded as skipped, never retried |
| Network error, `5xx` | Queued, retried with exponential backoff, six attempts |
| Ref moved under us | Re-read and replay once |
| Repo not writable | Badge red with the GitHub error message in the popup |

Nothing fails silently. That is the entire reason this project exists.

## Security

- The extension reads LeetCode responses only on `leetcode.com`
- It never reads, stores or transmits `LEETCODE_SESSION`
- The GitHub token is requested with `repo` scope, stored locally, and sent only to
  `api.github.com`
- The MAIN-world detector passes only a submission id across the world boundary, not
  page state

## Testing

- `src/lib/` is pure and covered by `node --test`: the language map, path builder,
  markdown renderer, and the response parser against recorded LeetCode payloads
- `src/background/github.js` is tested against a stub fetch that asserts the request
  sequence and replays GitHub error bodies
- The Chrome APIs are reached through one adapter module, stubbed in tests
- One manual end-to-end run against a real submission before each release

## Out of scope

- Browsers other than Chrome. The MV3 code is close to Firefox-compatible; porting
  is a follow-up, not a launch requirement.
- leetcode.cn
- Backfilling submissions made before the extension was installed
- Normalising the existing archive's mixed `49-` / `0049-` directory naming
