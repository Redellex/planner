// Shared helpers for the Claude Code hooks in this folder (see .claude/settings.json).
// Signal contract: exit 2 + stderr is the only combination Claude sees; exit 0 means "nothing to report".
// Node instead of bash because this machine has no jq; local bins run through `node` (no npx, no .cmd shims).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every file ESLint covers here (eslint.config.js: typescript-eslint, react, eslint-plugin-astro). */
export const LINTED = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|astro)$/;
/** What scripts/check-ui-literals.mjs reads; it narrows to its own SCOPE list itself. */
export const UI_CHECKED = /\.(astro|tsx|ts)$/;
/** Modules Vitest can follow from a test file. */
export const TESTED = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/**
 * Test plan risk #1 (station wall-clock dates on the UTC Worker): the files that decide it. The station-time
 * helpers and their tests, the config that forces UTC, and every file holding a station zone literal that
 * src/lib/station-time-zone.test.ts reads as text (so `vitest related` never links them to it).
 */
export const STATION_TIME =
  /^(src\/lib\/(availability|station-time-zone\.test|test-runtime\.test|availability\.test)\.ts|vitest\.config\.ts|scripts\/smoke\.mjs|supabase\/(migrations|tests\/database)\/[^/]+\.sql)$/;
export const STATION_TIME_TESTS = [
  "src/lib/availability.test.ts",
  "src/lib/station-time-zone.test.ts",
  "src/lib/test-runtime.test.ts",
];

const BINS = {
  eslint: "node_modules/eslint/bin/eslint.js",
  vitest: "node_modules/vitest/vitest.mjs",
  astro: "node_modules/astro/bin/astro.mjs",
  checkUi: "scripts/check-ui-literals.mjs",
};

/** Payload from stdin; empty, unparseable or non-object input becomes {} (never fail the hook on its shape). */
export async function readPayload() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Repo-relative, forward-slash path of an existing file inside the repo, or null. */
export function repoFile(path) {
  if (typeof path !== "string" || path.trim() === "") return null;
  const absolute = isAbsolute(path) ? path : resolve(ROOT, path);
  const rel = relative(ROOT, absolute);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  if (!existsSync(absolute)) return null;
  return rel.split("\\").join("/");
}

/** Run a local bin; resolves { ok, output }. A missing bin (deps not installed) counts as ok: nothing to check. */
export function run(bin, args) {
  const script = resolve(ROOT, BINS[bin]);
  if (!existsSync(script)) return Promise.resolve({ ok: true, output: "" });
  return new Promise((done) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: ROOT,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      windowsHide: true,
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => done({ ok: true, output: String(error) }));
    child.on("close", (code) => done({ ok: code === 0, output: output.trim() }));
  });
}

/** Keep hook output readable for the model: drop ANSI codes, cap the length. */
export function clip(text, max = 8000) {
  // eslint-disable-next-line no-control-regex
  const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
  return plain.length > max ? `${plain.slice(0, max)}\n… (output truncated)` : plain;
}

/** Report failures to Claude (stderr + exit 2), or exit 0 when there are none. */
export function finish(header, sections) {
  const failed = sections.filter(Boolean);
  if (failed.length === 0) process.exit(0);
  process.stderr.write(`${header}\n\n${failed.join("\n\n")}\n`);
  process.exit(2);
}
