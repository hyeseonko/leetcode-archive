const ENDPOINT = 'https://leetcode.com/graphql/';

export class PremiumLockedError extends Error {
  constructor(what) {
    super(`${what} is locked behind LeetCode Premium`);
    this.name = 'PremiumLockedError';
  }
}

async function query(operation, variables, { fetchImpl = fetch, csrfToken }) {
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrftoken': csrfToken,
      Referer: 'https://leetcode.com',
    },
    body: JSON.stringify({ query: operation, variables }),
  });

  if (response.status === 403) throw new PremiumLockedError('this problem');
  const payload = JSON.parse(await response.text());
  if (!payload.data) {
    throw new Error(payload.errors?.map((e) => e.message).join('; ') || 'LeetCode returned no data');
  }
  return payload.data;
}

// Every field named below is one joshcai/leetcode-sync@v1.7 queries in production.
// The schema is unpublished and rejects a query wholesale on an unknown field, so do
// not extend these selections without evidence the field exists.
const SUBMISSION_DETAILS = `query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    runtimePercentile
    memoryPercentile
    code
    question { questionId }
  }
}`;

const QUESTION_DETAIL = `query getQuestionDetail($titleSlug: String!) {
  question(titleSlug: $titleSlug) { content }
}`;

const SUBMISSION_LIST = `query recent($offset: Int!, $limit: Int!, $slug: String) {
  submissionList(offset: $offset, limit: $limit, questionSlug: $slug) {
    hasNext
    submissions { id lang timestamp statusDisplay runtime memory title titleSlug }
  }
}`;

export async function fetchSubmissionDetails(submissionId, options) {
  const data = await query(SUBMISSION_DETAILS, { submissionId: Number(submissionId) }, options);
  const details = data.submissionDetails;
  if (!details) throw new Error(`no details for submission ${submissionId}`);
  return {
    code: details.code,
    runtimePercentile: details.runtimePercentile ?? null,
    memoryPercentile: details.memoryPercentile ?? null,
    questionId: details.question?.questionId ?? null,
  };
}

export async function fetchQuestionStatement(titleSlug, options) {
  try {
    const data = await query(QUESTION_DETAIL, { titleSlug }, options);
    return data.question?.content ?? null;
  } catch (error) {
    // A locked problem is a fact about the account, not a failure to retry.
    if (error instanceof PremiumLockedError) return null;
    throw error;
  }
}

export async function fetchRecentSubmissions({ limit = 20, ...options }) {
  const data = await query(SUBMISSION_LIST, { offset: 0, limit, slug: null }, options);
  return data.submissionList?.submissions ?? [];
}
