// Builds the user prompt for one review: the PR title, description and diff, each fenced in its own tag.
// All three are untrusted (written by the PR author); SYSTEM_PROMPT tells the model the tags hold data, not instructions.

// The description is optional context, so it is capped to keep its cost bounded (CI budget is $0.1 per run).
export const PR_BODY_MAX_CHARS = 4000;
export const PR_BODY_TRUNCATION_MARKER = "[description truncated after 4000 characters]";

export interface ReviewPromptInput {
  diff: string;
  title?: string;
  body?: string;
}

// A closing fence tag inside any input would end its fence early, and the text after it would read as
// instructions outside the untrusted region. So every closing fence tag in title, body and diff is
// neutralised (`</pr_body>` -> `<\/pr_body>`) before fencing; the reviewer still sees what was written.
const FENCE_CLOSING_TAG = /<\/(pr_title|pr_body|diff)\s*>/gi;

export function neutraliseFenceTags(text: string): string {
  return text.replace(FENCE_CLOSING_TAG, "<\\/$1>");
}

export function buildReviewPrompt({ diff, title, body }: ReviewPromptInput): string {
  const parts = ["Review this pull request."];
  const trimmedTitle = title?.trim();
  if (trimmedTitle) parts.push(`<pr_title>\n${neutraliseFenceTags(trimmedTitle)}\n</pr_title>`);
  const trimmedBody = body?.trim();
  if (trimmedBody) {
    const capped =
      trimmedBody.length > PR_BODY_MAX_CHARS
        ? `${trimmedBody.slice(0, PR_BODY_MAX_CHARS)}\n${PR_BODY_TRUNCATION_MARKER}`
        : trimmedBody;
    parts.push(`<pr_body>\n${neutraliseFenceTags(capped)}\n</pr_body>`);
  }
  parts.push(`<diff>\n${neutraliseFenceTags(diff)}\n</diff>`);
  return parts.join("\n\n");
}
