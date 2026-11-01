import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Review } from "./review-schema.ts";
import { enforceVerdictRule } from "./verdict.ts";

function review(overrides: Partial<Review> = {}): Review {
  return {
    implementationCorrectness: 8,
    idiomaticity: 8,
    complexity: 8,
    testRiskCoverage: 8,
    documentation: 8,
    securitySafety: 8,
    verdict: "pass",
    summary: "Looks good.",
    ...overrides,
  };
}

void describe("enforceVerdictRule", () => {
  void it("turns pass into fail when a score is 4, naming the criterion", () => {
    const result = enforceVerdictRule(review({ testRiskCoverage: 4 }));
    assert.equal(result.verdict, "fail");
    assert.match(result.summary, /^\*\*Verdict changed to fail:\*\* testRiskCoverage 4 /);
    assert.ok(result.summary.endsWith("\n\nLooks good."));
  });

  void it("names every low criterion", () => {
    const result = enforceVerdictRule(review({ complexity: 1, securitySafety: 3 }));
    assert.equal(result.verdict, "fail");
    assert.match(result.summary, /complexity 1, securitySafety 3/);
  });

  void it("keeps pass when the lowest score is 5", () => {
    const input = review({ documentation: 5 });
    assert.deepEqual(enforceVerdictRule(input), input);
  });

  void it("never changes a fail verdict", () => {
    for (const input of [review({ verdict: "fail" }), review({ verdict: "fail", idiomaticity: 2 })]) {
      assert.deepEqual(enforceVerdictRule(input), input);
    }
  });

  void it("rejects scores outside 1-10 or not integers", () => {
    for (const score of [0, 11, 7.5, Number.NaN]) {
      assert.throws(() => enforceVerdictRule(review({ complexity: score })), /Invalid score for complexity/);
      assert.throws(
        () => enforceVerdictRule(review({ verdict: "fail", complexity: score })),
        /Invalid score for complexity/,
      );
    }
  });
});
