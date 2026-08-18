# LeetCode Archive

A Chrome extension that commits an accepted LeetCode submission to a GitHub
repository within seconds of it passing — the solution source, the problem statement,
the runtime and memory numbers, and an optional note you type while the problem is
still fresh.

It exists because the alternatives fail quietly. LeetHub scrapes the LeetCode DOM and
stops working whenever LeetCode reworks its UI, without saying so. Cron-driven
syncers need a `LEETCODE_SESSION` cookie in repository secrets, which expires every
couple of weeks and reports its own expiry as `TypeError: submissions is not
iterable`. This extension is already authenticated as you, watches the submission
payload rather than the page, and puts every failure on the toolbar badge.

## Install

There is no build step. Clone the repository and load it:

1. `git clone https://github.com/hyeseonko/leetcode-archive.git`
2. Open `chrome://extensions` and turn on **Developer mode**
3. **Load unpacked** → select the cloned directory

## Connect GitHub

Click the extension icon → **Connect GitHub**. It shows a nine-character code; enter
it at [github.com/login/device](https://github.com/login/device) and approve. The
token is stored in `chrome.storage.local` on this machine only — never in
`storage.sync`, which would copy it to every browser you are signed into.

## Configure

The extension writes to `hyeseonko/LeetCode` on `main` by default. Change the owner,
repository and branch on the options page (**Settings** in the popup).

## What a commit looks like

```
0049-group-anagrams/
  0049-group-anagrams.py   your submitted source
  README.md                the problem statement
  NOTES.md                 your note, if you wrote one
```

```
solve: 49. Group Anagrams — Time 62 ms (19.26%), Space 13.9 MB (57.10%)
```

## How it works

A content script in the page's own world wraps `fetch` and `XMLHttpRequest` and
recognises an accepted submission by the shape of the response — a verdict field and
a submission id — rather than by the URL it arrived at, so a LeetCode endpoint move
does not break it. The background worker then reads the code and the statement from
LeetCode's GraphQL API and writes all the files in one commit through GitHub's Git
Data API. A five-minute sweep catches anything the hook missed, and both paths share
one ledger so nothing is committed twice.

`docs/design.md` has the reasoning in full.

## What it does not do

- Browsers other than Chrome. The MV3 code is close to Firefox-compatible; porting is
  a follow-up, not a launch requirement.
- leetcode.cn
- Backfill submissions made before you installed it

## Development

```bash
npm test
```

That is the whole suite. There are no dependencies to install and nothing to build.
See `CONTRIBUTING.md`.

## Licence

MIT
