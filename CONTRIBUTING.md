# Contributing

## Running the tests

```bash
npm test
```

`node --test` discovers everything under `test/`. There is nothing to install first.

## Two constraints worth knowing before you open a pull request

**No build step, no dependencies.** The extension loads unpacked straight from the
repository root, and `package.json` declares neither `dependencies` nor
`devDependencies`. This is deliberate: a contributor should be able to clone, load,
and edit, and a user should be able to read the code that is actually running. A pull
request that adds a bundler or a runtime dependency needs to argue for it.

**Content scripts cannot use ES modules.** Chrome MV3 does not support `import` in
manifest-declared content scripts, and `src/content/detector.js` additionally runs in
the page's MAIN world where `chrome.runtime` does not exist. Logic those files share
is published on a global — `globalThis.LCA_VERDICT` — by an IIFE listed ahead of its
consumer in the manifest's `js` array. Tests import the file for its side effect and
read the global. Background code has no such limit and uses ordinary `export`.

## Where to put things

`src/lib/` holds the pure logic — the language map, the path builder, the renderer,
the verdict matcher, the LeetCode queries — and it is where new behaviour should get
its tests. `src/background/` and `src/content/` should stay thin enough to read in
one sitting; when a decision inside them starts to deserve a test, it belongs in
`src/lib/`.

## Do not extend the GraphQL selections on a guess

LeetCode's schema is not published and rejects a query wholesale if it names one
field that does not exist. Every field in `src/lib/leetcode.js` has a working
precedent in `joshcai/leetcode-sync@v1.7`. Adding one because it seems like it should
exist will break the core read path for everyone. Bring evidence.

## Commits

Imperative subject under 72 characters. Explain why in the body when the why is not
obvious from the diff.

## Icons

`icons/icon-512.png` is the master. The four sizes Chrome loads are derived from it:

```bash
for s in 16 32 48 128; do sips -Z $s icons/icon-512.png --out icons/icon-$s.png; done
```

Regenerate all of them together so they never drift apart.
