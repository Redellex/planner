// PostToolUse (Write|Edit): run the Vitest tests that import the edited file (exits 0 when none do).
// Station-time files are left to station-time-tests.mjs, which runs their related tests too.
import { STATION_TIME, TESTED, clip, finish, readPayload, repoFile, run } from "./lib.mjs";

const payload = await readPayload();
const input = payload.tool_input ?? {};
const file = repoFile(input.file_path ?? input.path);
if (!file || !TESTED.test(file) || STATION_TIME.test(file)) process.exit(0);

const tests = await run("vitest", ["related", file, "--run"]);

finish(`Tests related to ${file} fail:`, [!tests.ok && clip(tests.output)]);
