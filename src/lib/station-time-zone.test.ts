import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { STATION_TIME_ZONE } from "./availability";

// If the SQL (migrations, database rules tests) or smoke station zone drifts from STATION_TIME_ZONE, the app and the
// database disagree about which month is editable around midnight. Only code forms are matched; comments mentioning
// the zone are ignored.

const repoRoot = path.resolve(import.meta.dirname, "../..");
const migrationsDir = path.join(repoRoot, "supabase/migrations");
const dbTestsDir = path.join(repoRoot, "supabase/tests/database");

const sources = [
  {
    name: "SQL migrations (at time zone '…')",
    files: readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => path.join(migrationsDir, file)),
    pattern: /at time zone '([^']+)'/gi,
  },
  {
    name: "local seed (at time zone '…')",
    files: [path.join(repoRoot, "supabase/seed.sql")],
    pattern: /at time zone '([^']+)'/gi,
  },
  {
    name: "database rules tests (at time zone '…')",
    files: readdirSync(dbTestsDir)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => path.join(dbTestsDir, file)),
    pattern: /at time zone '([^']+)'/gi,
  },
  {
    name: 'smoke and demo seed scripts (timeZone: "…")',
    files: [path.join(repoRoot, "scripts/smoke.mjs"), path.join(repoRoot, "scripts/seed-demo-team.mjs")],
    pattern: /timeZone:\s*"([^"]+)"/g,
  },
];

describe("the station time zone literal agrees everywhere", () => {
  it.each(sources)("$name uses STATION_TIME_ZONE", ({ files, pattern }) => {
    const found = files.flatMap((file) =>
      Array.from(readFileSync(file, "utf8").matchAll(pattern), (match) => ({
        file: path.relative(repoRoot, file),
        zone: match[1],
      })),
    );

    expect(found.length).toBeGreaterThan(0);
    expect(found.filter(({ zone }) => zone !== STATION_TIME_ZONE)).toEqual([]);
  });
});
