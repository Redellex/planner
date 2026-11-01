// Decides the final outcome of one AI review and writes the PR comment for it (M5L3).
// Called by action.yml for every outcome; it never exits non-zero, so the workflow decides comment, status and gate.
// Env in:  OUTCOME (reviewed | empty | too-large | error; anything else counts as error), REVIEW_FILE,
//          COMMENT_FILE, HEAD_SHA, RUN_URL, DIFF_BYTES, MAX_DIFF_BYTES, GITHUB_OUTPUT.
// Out:     the comment in COMMENT_FILE, and outcome=/verdict= lines appended to GITHUB_OUTPUT.
// The verdict is re-validated here (pass | fail, six integer scores 1-10): free text never gates.
// The model's summary is untrusted; it is posted through --body-file, never interpolated into a shell.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const CRITERIA = [
  ["implementationCorrectness", "Implementation correctness"],
  ["idiomaticity", "Idiomaticity"],
  ["complexity", "Complexity"],
  ["testRiskCoverage", "Test / risk coverage"],
  ["documentation", "Documentation"],
  ["securitySafety", "Security and safety"],
];

const env = process.env;
const shortSha = /^[0-9a-f]{40}$/.test(env.HEAD_SHA ?? "") ? env.HEAD_SHA.slice(0, 7) : "unknown";
const runLink = env.RUN_URL ? `[run log](${env.RUN_URL})` : "run log";

function readReview(path) {
  try {
    const review = JSON.parse(readFileSync(path, "utf8"));
    if (review.verdict !== "pass" && review.verdict !== "fail") return null;
    if (typeof review.summary !== "string") return null;
    for (const [key] of CRITERIA) {
      const score = review[key];
      if (!Number.isInteger(score) || score < 1 || score > 10) return null;
    }
    return review;
  } catch {
    return null;
  }
}

function reviewedComment(review) {
  const rows = CRITERIA.map(([key, label]) => `| ${label} | ${review[key]} |`);
  return [
    `## AI Code Review: ${review.verdict.toUpperCase()}`,
    "",
    `Reviewed commit \`${shortSha}\` · ${runLink}`,
    "",
    "| Criterion | Score (1-10) |",
    "| --- | ---: |",
    ...rows,
    "",
    review.summary,
    "",
  ].join("\n");
}

const REASONS = {
  empty: "Nothing to review: the diff is empty after the exclusions (lockfiles, `src/db/database.types.ts`).",
  "too-large": `The diff is ${env.DIFF_BYTES ?? "?"} bytes, over the ${env.MAX_DIFF_BYTES ?? "?"}-byte limit, so it was not sent to the model.`,
  error: "The review agent did not return a valid verdict (agent error, budget cap or invalid output).",
};

function couldNotRunComment(outcome) {
  return [
    "## AI Code Review: could not run",
    "",
    `${REASONS[outcome]} Commit \`${shortSha}\`; see the ${runLink}.`,
    "",
  ].join("\n");
}

let outcome = Object.hasOwn(REASONS, env.OUTCOME) || env.OUTCOME === "reviewed" ? env.OUTCOME : "error";
let verdict = "";
let comment;
if (outcome === "reviewed") {
  const review = readReview(env.REVIEW_FILE);
  if (review) {
    verdict = review.verdict;
    comment = reviewedComment(review);
  } else {
    outcome = "error";
  }
}
comment ??= couldNotRunComment(outcome);

try {
  writeFileSync(env.COMMENT_FILE, comment);
  appendFileSync(env.GITHUB_OUTPUT, `outcome=${outcome}\nverdict=${verdict}\n`);
} catch (error) {
  console.error(`[format-comment] ${error instanceof Error ? error.message : String(error)}`);
}
