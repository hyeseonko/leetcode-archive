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
