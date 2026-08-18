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
