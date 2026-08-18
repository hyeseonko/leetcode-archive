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
