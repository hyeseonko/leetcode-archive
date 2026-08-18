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
