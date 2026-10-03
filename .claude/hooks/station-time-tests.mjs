// PostToolUse (Write|Edit): test plan risk #1. When the edited file is part of the station-time surface
// (STATION_TIME in lib.mjs), run the whole risk-#1 suite plus whatever else `vitest related` finds for the file.
// related-tests.mjs skips these files, so nothing runs twice.
import { STATION_TIME, STATION_TIME_TESTS, TESTED, clip, finish, readPayload, repoFile, run } from "./lib.mjs";

const payload = await readPayload();
const input = payload.tool_input ?? {};
const file = repoFile(input.file_path ?? input.path);
if (!file || !STATION_TIME.test(file)) process.exit(0);

const targets = [...new Set([...(TESTED.test(file) ? [file] : []), ...STATION_TIME_TESTS])];
const tests = await run("vitest", ["related", ...targets, "--run"]);

finish(
  `Station-time tests (test plan risk #1: wall-clock dates on the UTC Worker) fail after editing ${file}.\n` +
    "Expected values are calendar literals, never helper output (context/foundation/test-plan.md §6.1):",
  [!tests.ok && clip(tests.output)],
);
