// Contract rules the JSON schema cannot express (structured output rejects minimum/maximum on numbers):
// every score is an integer from 1 to 10, and any score of 4 or lower makes the verdict "fail".
// The prompt states the same rule; this makes it hold even when the model does not follow it.
import { SCORE_KEYS, type Review } from "./review-schema.ts";

export const FAIL_THRESHOLD = 4;

export function enforceVerdictRule(review: Review): Review {
  for (const key of SCORE_KEYS) {
    const score = review[key];
    if (!Number.isInteger(score) || score < 1 || score > 10) {
      throw new Error(`Invalid score for ${key}: ${score} (expected an integer from 1 to 10).`);
    }
  }
  if (review.verdict === "fail") return review;

  const low = SCORE_KEYS.filter((key) => review[key] <= FAIL_THRESHOLD);
  if (low.length === 0) return review;

  const named = low.map((key) => `${key} ${review[key]}`).join(", ");
  return {
    ...review,
    verdict: "fail",
    summary: `**Verdict changed to fail:** ${named} (any score of ${FAIL_THRESHOLD} or lower fails).\n\n${review.summary}`,
  };
}
