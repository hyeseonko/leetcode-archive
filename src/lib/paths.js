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
