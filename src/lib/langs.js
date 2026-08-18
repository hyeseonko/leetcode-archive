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
