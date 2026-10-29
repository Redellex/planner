// Code-review agent: a git diff in (stdin or a file path), the structured review as JSON on stdout.
// Usage and cost go to stderr, so stdout stays pure JSON for the CI gate (M5L3).
//   git diff | npm --prefix reviewer run review
//   npm --prefix reviewer run review -- fixtures/sample-buggy.diff   (path relative to reviewer/)
import { readFile } from "node:fs/promises";
import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { REVIEW_JSON_SCHEMA, REVIEW_SCHEMA, SYSTEM_PROMPT, type Review } from "./review-schema.ts";

const MODEL = process.env.REVIEW_MODEL ?? "claude-sonnet-5-5";
// Hard cap per run; the SDK estimate can pass it slightly, so it stays well under what a run may cost.
const MAX_BUDGET_USD = Number(process.env.REVIEW_MAX_BUDGET_USD ?? "0.5");

async function readDiff(): Promise<string> {
  const path = process.argv[2];
  if (path) return readFile(path, "utf8");
  if (process.stdin.isTTY) {
    throw new Error("No diff: pipe one in (git diff | npm run review) or pass a file (npm run review -- <file>).");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function reportUsage(result: SDKResultMessage): void {
  const models = Object.entries(result.modelUsage)
    .map(
      ([model, u]) =>
        `${model}: ${u.inputTokens} in (+${u.cacheCreationInputTokens} cache write, +${u.cacheReadInputTokens} cache read) / ` +
        `${u.outputTokens} out`,
    )
    .join("; ");
  process.stderr.write(
    `[review] ${result.subtype}, ${result.num_turns} turns, ${result.duration_ms} ms, ` +
      `$${result.total_cost_usd.toFixed(4)} (${models || "no model calls"})\n`,
  );
}

async function review(diff: string): Promise<Review> {
  let result: SDKResultMessage | undefined;
  try {
    for await (const message of query({
      // The diff is untrusted input: fenced in tags so instructions inside it read as data.
      prompt: `Zrecenzuj ten diff:\n\n<diff>\n${diff}\n</diff>`,
      options: {
        systemPrompt: SYSTEM_PROMPT,
        model: MODEL,
        settingSources: [], // no CLAUDE.md, skills or hooks from the repo: the review stays narrow and repeatable
        tools: [],
        maxTurns: 2, // turn 1 reads the diff, turn 2 returns the structured output
        maxBudgetUsd: MAX_BUDGET_USD,
        outputFormat: { type: "json_schema", schema: REVIEW_JSON_SCHEMA },
      },
    })) {
      if (message.type === "result") result = message;
    }
  } catch (error) {
    // query() throws after yielding an error result; that result still carries the cost, reported below.
    if (!result) throw error;
  }

  if (!result) throw new Error("The agent returned no result.");
  reportUsage(result);
  if (result.subtype !== "success") {
    throw new Error(`Review failed (${result.subtype}): ${result.errors.join("; ")}`);
  }
  if (result.is_error) throw new Error(`Review failed: ${result.result}`);

  const parsed = REVIEW_SCHEMA.safeParse(result.structured_output);
  if (!parsed.success) throw new Error(`Invalid structured output: ${parsed.error.message}`);
  return parsed.data;
}

try {
  const diff = await readDiff();
  if (!diff.trim()) throw new Error("The diff is empty.");
  process.stdout.write(`${JSON.stringify(await review(diff), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`[review] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
