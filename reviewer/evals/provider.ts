// promptfoo provider that runs the real reviewer CLI (src/index.ts) on one diff, so the eval exercises
// exactly what CI runs: the Agent SDK call, the JSON schema and the verdict rule in verdict.ts.
// Config: `model` (REVIEW_MODEL) and `maxBudgetUsd` (REVIEW_MAX_BUDGET_USD). The diff comes from the
// test's `diff` var. Cost and duration are read from the CLI's `[review] ...` stderr line.
// promptfoo is not a dependency (run through npx), so the few types used here are declared locally.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

interface ProviderOptions {
  id?: string;
  config?: { model?: string; maxBudgetUsd?: number };
}

interface ProviderResponse {
  output?: string;
  error?: string;
  cost?: number;
  metadata?: Record<string, number>;
}

const REVIEWER_DIR = fileURLToPath(new URL("..", import.meta.url));
const USAGE_LINE = /\[review\] \w+, (\d+) turns, (\d+) ms, \$([\d.]+)/;

function runReviewer(
  diff: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--env-file-if-exists=.env", "--import", "tsx", "src/index.ts"], {
      cwd: REVIEWER_DIR,
      env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(diff);
  });
}

export default class ReviewerProvider {
  private readonly config: NonNullable<ProviderOptions["config"]>;
  private readonly providerId: string;

  constructor(options: ProviderOptions = {}) {
    this.config = options.config ?? {};
    this.providerId = options.id ?? `reviewer:${this.config.model ?? "default"}`;
  }

  id(): string {
    return this.providerId;
  }

  async callApi(_prompt: string, context?: { vars?: Record<string, unknown> }): Promise<ProviderResponse> {
    const diff = context?.vars?.diff;
    if (typeof diff !== "string" || !diff.trim()) return { error: "The test has no diff var." };

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (this.config.model) env.REVIEW_MODEL = this.config.model;
    if (this.config.maxBudgetUsd !== undefined) env.REVIEW_MAX_BUDGET_USD = String(this.config.maxBudgetUsd);
    // Diff-only reviews, as in prompt-baseline.md: no PR title or body leaks in from the shell.
    delete env.PR_TITLE;
    delete env.PR_BODY;

    const { code, stdout, stderr } = await runReviewer(diff, env);
    const usage = USAGE_LINE.exec(stderr);
    const metrics: ProviderResponse = usage
      ? { cost: Number(usage[3]), metadata: { turns: Number(usage[1]), durationMs: Number(usage[2]) } }
      : {};
    if (code !== 0) return { ...metrics, error: `reviewer exited ${String(code)}: ${stderr.trim()}` };
    return { ...metrics, output: stdout.trim() };
  }
}
