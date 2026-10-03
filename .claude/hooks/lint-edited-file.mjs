// PostToolUse (Write|Edit): lint the one file the agent just edited, plus the colour-literal check
// (scripts/check-ui-literals.mjs ignores files outside its clean-view SCOPE). Report only, no --fix:
// rewriting the file would make the agent's next Edit fail with "modified since read".
import { LINTED, UI_CHECKED, clip, finish, readPayload, repoFile, run } from "./lib.mjs";

const payload = await readPayload();
const input = payload.tool_input ?? {};
const file = repoFile(input.file_path ?? input.path);
if (!file || !LINTED.test(file)) process.exit(0);

const [eslint, ui] = await Promise.all([
  run("eslint", ["--quiet", "--no-warn-ignored", file]),
  UI_CHECKED.test(file) ? run("checkUi", [file]) : { ok: true },
]);

finish(`Checks failed for ${file} (fix before moving on):`, [
  !eslint.ok && `ESLint:\n${clip(eslint.output)}`,
  !ui.ok && `Colour literals (npm run check:ui):\n${clip(ui.output)}`,
]);
