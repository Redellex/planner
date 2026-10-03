// Stop: before the agent hands back, sweep every file changed in the working tree (including files rewritten
// through Bash, which no Write|Edit hook sees): ESLint + colour literals on those files, the whole unit suite
// (it runs in ~2 s) and `astro check` (whole project, .astro included, syncs generated types itself).
// One retry: when this hook already sent the agent back, let it finish; the commit gate catches the rest.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { LINTED, ROOT, UI_CHECKED, clip, finish, readPayload, run } from "./lib.mjs";

const payload = await readPayload();
// loop_count: Cursor imports .claude/settings.json hooks and sends this instead of stop_hook_active.
if (payload.stop_hook_active === true || Number(payload.loop_count ?? 0) > 0) process.exit(0);

function git(args) {
  try {
    return execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd: ROOT, encoding: "utf8" });
  } catch {
    return "";
  }
}

// Changed and untracked files. Agent tooling and docs never affect lint, tests or types, so a turn that
// touched only those (or nothing, e.g. Q&A) checks nothing.
const IGNORED = /^(\.claude|\.agents|\.codestudio|context)\//;
const RELEVANT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|astro|json|sql)$/;
const changed = [
  ...new Set(
    `${git(["diff", "--name-only", "HEAD"])}\n${git(["ls-files", "--others", "--exclude-standard"])}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((path) => path && !IGNORED.test(path) && RELEVANT.test(path)),
  ),
].sort();
if (changed.length === 0) process.exit(0);

// Skip the sweep when these files are exactly as they were at the last green run (a Q&A turn on a dirty tree).
const fingerprint = createHash("sha1")
  .update(
    changed
      .map((path) => {
        const stat = statSync(resolve(ROOT, path), { throwIfNoEntry: false });
        return stat ? `${path}:${stat.mtimeMs}:${stat.size}` : `${path}:deleted`;
      })
      .join("\n"),
  )
  .digest("hex");
const cacheDir = resolve(ROOT, "node_modules/.cache/claude-hooks");
const cacheFile = resolve(cacheDir, "end-of-turn-green");
if (existsSync(cacheFile) && readFileSync(cacheFile, "utf8") === fingerprint) process.exit(0);

const existing = changed.filter((path) => existsSync(resolve(ROOT, path)));
const linted = existing.filter((path) => LINTED.test(path));
const uiChecked = existing.filter((path) => UI_CHECKED.test(path));

const [eslint, ui, tests, types] = await Promise.all([
  linted.length > 0 ? run("eslint", ["--quiet", "--no-warn-ignored", ...linted]) : { ok: true },
  uiChecked.length > 0 ? run("checkUi", uiChecked) : { ok: true },
  run("vitest", ["run"]),
  run("astro", ["check", "--minimumSeverity", "error"]),
]);

const failures = [
  !eslint.ok && `ESLint errors in changed files:\n${clip(eslint.output)}`,
  !ui.ok && `Colour literals (npm run check:ui):\n${clip(ui.output)}`,
  !tests.ok && `Unit tests fail (npm test):\n${clip(tests.output)}`,
  !types.ok && `Typecheck fails (npx astro check):\n${clip(types.output)}`,
].filter(Boolean);

if (failures.length === 0) {
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, fingerprint);
  } catch {
    // The cache only saves time; a read-only node_modules just means the next turn re-checks.
  }
}

finish("Fix these before you finish:", failures);
