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
