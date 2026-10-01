---
date: 2026-10-01T18:42:54+02:00
researcher: Redellex (with Claude Code)
git_commit: f4071d60f302c32b3313f8748642b2b5b925f6f7
branch: testing-station-time
repository: Planner
topic: "Test runner and station-time logic: what Phase 1 of the test plan must cover, and how to bootstrap Vitest here"
tags: [research, testing, vitest, station-time, availability, dst, test-plan-phase-1]
status: complete
last_updated: 2026-10-01
last_updated_by: Redellex (with Claude Code)
---

# Research: Test runner and station-time logic (test-plan rollout Phase 1)

**Date**: 2026-10-01T18:42:54+02:00
**Researcher**: Redellex (with Claude Code)
**Git Commit**: f4071d60f302c32b3313f8748642b2b5b925f6f7 (working tree has uncommitted context/skill files, none under `src/`)
**Branch**: testing-station-time
**Repository**: Planner

## Research Question

Ground Phase 1 of `context/foundation/test-plan.md` (risk #1: station wall-clock dates drift on the UTC Worker). The change brief (`change.md` Notes) asks for:

- where station "now" is computed (TS and SQL);
- every date parse/format path, and whether any path passes a wall-clock string through `new Date(...)`;
- how weekday repeats and month boundaries are derived;
- what bootstrapping a unit runner (Vitest, `TZ=UTC`, frozen clock) needs in this repo.

The tests must check independent calendar facts (DST days 2026-03-29 and 2026-10-25, an overnight window into day 1, February 2028, the station month just before and after Warsaw midnight). They must not compute expected values with the helper under test.

## Summary

1. **One module holds the station-time logic in `src/`.** A grep of `src/` for `new Date(`, `Date.now`, `Date.UTC`, `Date.parse`, `getTime`, `toISOString`, `get(UTC)?*`, `Intl.DateTimeFormat`, `toLocale*`, `timeZone`, `Europe/Warsaw`, `STATION_TIME_ZONE` and `split("T")` matched only in `src/lib/availability.ts`. Outside it, the inspected code does string work on dates in two places:
   - three `.slice(0, 7)` lock-month keys (`src/pages/availability.astro:91`, `src/pages/manager/availability.astro:122`, `src/pages/manager/months.astro:26`);
   - one inline copy of `formatCarryOver` text in the dev page (`src/pages/dev/availability-states.astro:59`).

   In the inspected `src/` files, no wall-clock `starts_at`/`ends_at` string goes through `new Date(...)`.
2. **The helpers should not depend on the process time zone, but no test proves it yet.** Reading the code, calendar math runs `Date.UTC` on date parts and reads results with `getUTC*` (`src/lib/availability.ts:27-49`). Every `Intl.DateTimeFormat` in the file passes an explicit `timeZone` (`:53-57`, `:201-208`, `:232-238`). Phase 1 has to turn this reading into a test run under `TZ=UTC`.
3. **One function reads the clock.** `currentStationMonth()` calls `new Date()` with no injectable clock (`:52-61`). `upcomingMonths()` (`:70-73`) and `teamAvailabilityMonths()` (`:76-78`) depend on it, so their tests need `vi.setSystemTime`.
4. **The authoritative month rules live in SQL, out of reach of a TS unit test.**
   - The SQL station month is `date_trunc('month', now() at time zone 'Europe/Warsaw')` (`supabase/migrations/20260926130000_create_availability.sql:43`).
   - Writes also check the month of `ends_at - 1µs` (`supabase/migrations/20260926140000_harden_availability_writes.sql:1-12`). That rule has no TS mirror.

   Both belong to Phase 2 (pgTAP). The `'Europe/Warsaw'` literal appears in three places: TS `:10`, SQL `:43`, smoke `scripts/smoke.mjs:19`.
5. **Runner: use a plain `vitest.config.ts`, not Astro `getViteConfig`.** This contradicts test-plan §4, which names "Vitest via Astro `getViteConfig`".
   - `getViteConfig` runs the integration hooks. The installed `@astrojs/cloudflare` 14.3.1 then adds `@cloudflare/vite-plugin`, and its dist has no `process.env.VITEST` guard (grep count 0 in every `dist/*.js`).
   - `src/lib/availability.ts` has zero imports, so it needs nothing from Astro.
   - Set `TZ` with `process.env.TZ = "UTC"` at the top of the config. An npm-script prefix does not work on Windows (cmd.exe), and `test.env` does not work in worker threads.
6. **None of the earlier date fixes has an automated test.** S-01 F1 (overnight spill into a locked month), F2 (spilled window hidden on day 1), F6 (DST semantics, a documentation-only fix) and the S-02 hour totals were each checked manually, with SQL or through smoke. Phase 1 is the first automated coverage of these helpers.

## Detailed Findings

### Station "now"

| Where | How | Anchor |
|---|---|---|
| TS | `Intl.DateTimeFormat("en-CA", { timeZone: STATION_TIME_ZONE, year, month: "2-digit" }).formatToParts(new Date())` | `src/lib/availability.ts:52-61` |
| SQL | `target_month > date_trunc('month', now() at time zone 'Europe/Warsaw')::date and not exists(lock)` | `supabase/migrations/20260926130000_create_availability.sql:36-49` |
| smoke | `stationMonthPlus(offset)`: the same Intl call plus `Date.UTC` month shift, a hand copy (not an import) | `scripts/smoke.mjs:15-27` |

Consumers of the TS station month:

- `/availability` offers `upcomingMonths()`, and any other `?month=` falls back to the first of them (`src/pages/availability.astro:33-36`).
- `/manager/availability` offers `teamAvailabilityMonths()` and stores `currentStationMonth()` as `stationMonth` (`src/pages/manager/availability.astro:35-39`). It shows "In progress — employees can no longer edit" when `month === stationMonth` (`:167-169`), an app-side copy of the SQL rule `target_month > station month`.
- `/manager/months` offers `upcomingMonths()` (`src/pages/manager/months.astro:10`).
- The endpoints do not gate by month: `create.ts` and `lock.ts` accept any month that parses, and RLS decides. Smoke relies on this for its station month + 12 steps (`scripts/smoke.mjs:30`).

Near a Warsaw month rollover, smoke (Node clock), the Worker and Postgres each compute "now" on their own. They can disagree only within the same seconds around midnight on the last day of a month. That case is out of scope for unit tests.

### Helper inventory (`src/lib/availability.ts`) and what Phase 1 must prove

| Helper | Lines | Date mechanism | Risk #1 relevance |
|---|---|---|---|
| `currentStationMonth` | 52-61 | Intl + explicit zone + `new Date()` | Station month flip at Warsaw midnight, not UTC midnight |
| `addMonths` | 64-67 | `Date.UTC(y, m+offset, 1)` | December → January year rollover |
| `upcomingMonths(count=3)` / `teamAvailabilityMonths` | 70-78 | builds on the two above | Wrong months become editable or visible |
| `parseDate` | 85-90 | round-trip through `Date.UTC` | Rejects 2027-02-29, accepts 2028-02-29 |
| `parseMonth`, `parseTime` | 80-95 | regex only | Input validation (low date risk) |
| `monthOfDate`, `monthStart`, `dateOf`, `timeOf`, `dayOfMonth` | 98-105, 151-198 | string slicing | Low risk; cheap to pin |
| `buildWindow` | 111-114 | `end <= start` → next day via `Date.UTC + DAY_MS` | Overnight from the last day of a month into day 1; 00:00–00:00 = full day |
| `sameWeekdayDatesInMonth` | 117-121 | arithmetic on day number + `daysInMonth` | Weekday repeat dates |
| `daysInMonth` | 124-128 | `Date.UTC(y, m+1, 0).getUTCDate()` | Leap February |
| `mondayWeekdayIndex`, `calendarWeeks` | 156-171 | `getUTCDay` | Monday-first grid, leading padding |
| `windowMinutes` | 173-181 | `Date.UTC` of parts, no DST correction | 00:00–00:00 on a DST day = 1440 by design (CLAUDE.md Availability) |
| `formatWindow`, `formatWindowCompact`, `formatCarryOver` | 131-148, 226-228 | string slicing; `(+1)` when date parts differ | Overnight marker |
| `weekdayName`, `formatDay`, `formatMonth` | 201-223 | Intl with `timeZone: "UTC"` on a `Date.UTC` instant | Labels shift by a day if the zone were dropped |
| `formatStationInstant` | 232-244 | `new Date(timestamptz)` + Intl in station zone | The only `new Date` on DB data in this file. Correct only when the string carries an offset |

Points from the code that the plan should address:

- **`formatStationInstant` depends on the process zone when the offset is missing.** Under `TZ=UTC`, `new Date("2026-09-26T12:05:00")` (no offset) formats as `26 Sept 2026, 14:05`. With `+00:00` it formats the same, but under a Warsaw process zone the offset-less string would give 12:05. Checked with a one-off `node -e` in this session. The lib comment (`:230-231`) assumes PostgREST sends the offset for `locked_at`; that was not verified at runtime.
- **DST fall-back hides the zone in the output.** `2026-10-25T00:30:00+00:00` and `2026-10-25T01:30:00+00:00` both format as `25 Oct 2026, 02:30` (CEST, then CET), so no zone marker is shown. This is a property to pin, not a bug.
- **`sameWeekdayDatesInMonth` works only from the day number** (`firstSameWeekday = ((day-1) % 7) + 1`) and never computes a weekday. An independent expected list catches arithmetic errors that a weekday-based oracle built from the same helpers would not.
- **No helper implements the `ends_at - 1µs` month rule.** The `/availability` locked flag looks only at the displayed month (`src/pages/availability.astro:96`). An overnight spill into a locked month is refused only by RLS (code 42501 → `MONTH_LOCKED_ERROR`, `:302-303`), which is Phase 2 territory.

### Independent calendar facts for expected values

Taken from the calendar and the EU DST rule (last Sunday of March/October at 01:00 UTC). In this session they were cross-checked with `Intl` in Europe/Warsaw in a one-off script, not with any helper under test:

- **Spring forward:** 2026-03-29 is a Sunday. Warsaw goes from 01:59:59 CET to 03:00 CEST at 2026-03-29T01:00:00Z.
- **Fall back:** 2026-10-25 is a Sunday. Warsaw goes from 02:59:59 CEST back to 02:00 CET at 2026-10-25T01:00:00Z.
- **Station month flips** (Warsaw midnight on the 1st):

  | Instant (UTC) | Warsaw month |
  |---|---|
  | 2026-03-31T21:59:59Z | March |
  | 2026-03-31T22:00:00Z | April (CEST, UTC+2) |
  | 2026-10-31T22:59:59Z | October |
  | 2026-10-31T23:00:00Z | November (CET, UTC+1) |
  | 2026-12-31T22:59:59Z | December 2026 |
  | 2026-12-31T23:00:00Z | January 2027 |

  At these instants the UTC month and the Warsaw month differ, which is exactly the "flips at the wrong moment" scenario.
- **Calendar layout:**
  - 2026-11-01 is a Sunday, so a Monday-first grid has 6 leading blanks, and November's 30 days take 6 weeks.
  - 2026-10-01 is a Thursday.
  - 2028-02-29 is a Tuesday. February 2028 has 29 days; February 2027 has 28.
- **Weekday repeats:**
  - Sundays in October 2026: 4, 11, 18, 25.
  - Tuesdays in February 2028: 1, 8, 15, 22, 29.
- **Overnight windows across a month or year boundary:**
  - 2026-10-31 19:00–07:00 → ends `2026-11-01T07:00:00`.
  - 2028-02-28 22:00–06:00 → ends `2028-02-29T06:00:00`.
  - 2026-12-31 22:00–06:00 → ends `2027-01-01T06:00:00`.

### Runner bootstrap facts

- **Installed versions** (`node_modules/*/package.json`): astro 7.3.2, vite 8.3.0 (one hoisted copy), @astrojs/cloudflare 14.3.1, typescript 6.0.3. `@types/node` 24.13.4 is present only as a transitive dependency.
- **Vitest on the registry:** `vitest@5.0.3` is the latest. Its peer range is `vite ^6.4.0 || ^7.0.0 || ^8.0.0` and its engines field is `node ^22.12.0 || ^24.0.0 || >=26.0.0` (`npm view`, checked this session). That fits `.nvmrc` 22.14.0 and CI `node-version: 22` (`.github/workflows/ci.yml:16`). The fallback is 4.1.11.
- **`getViteConfig`:**
  - It runs `astro:config:setup` hooks (`node_modules/astro/dist/config/index.js:4-42`), and the Cloudflare adapter hook adds `@cloudflare/vite-plugin` (`node_modules/@astrojs/cloudflare/dist/index.js:93-200`).
  - Astro core skips its dev-server plugin under `process.env.VITEST` (`node_modules/astro/dist/vite-plugin-astro-server/plugin.js:28`). The adapter has no such guard.
  - Upstream reports of this breakage: withastro/astro#15878, #15310; fix PR #17243. A worker reported these and they were not opened in this session. The failure is inferred, not reproduced.
- **Path alias:** `tsconfig.json` has `paths: { "@/*": ["./src/*"] }`. For tests importing `@/lib/...`, use Vite 8's native `resolve.tsconfigPaths: true` or an alias built with `fileURLToPath(new URL("./src", import.meta.url))`. `.pathname` yields `/E:/…` on Windows. A relative import avoids the alias.
- **Setting `TZ`:**
  - npm runs scripts through cmd.exe on Windows (no `script-shell` in the repo), so `"test": "TZ=UTC vitest run"` fails locally.
  - `process.env.TZ = "UTC"` at the top of `vitest.config.ts` runs before workers start (Vitest docs, "Time zone does not change in worker threads"). `test.env` / setup-file assignment do not reach thread workers.
  - Runtime `TZ` assignment was observed to change the process zone and to carry into a later-started worker thread. That check ran on Node v24.21.0 (the machine's Node), not 22.14.0.
- **The dev machine is in `Europe/Warsaw`** (`Intl…resolvedOptions().timeZone`). A test that silently depends on local time passes here without forced UTC, which is the "passes in CET" trap the test plan names.
- **Type-check and lint:**
  - `tsconfig.json` includes `**/*` (excluding only `dist`), so `*.test.ts` and `vitest.config.ts` are type-checked by `astro check`.
  - The same files are linted with `strictTypeChecked` via `projectService` (`eslint.config.js:17-24`), so tests must satisfy the strict rules (e.g. no non-null assertions).
  - Import `describe/it/expect/vi` from `"vitest"` explicitly rather than enabling `globals`.
- **CI and pre-commit:**
  - The `ci` job order is `npm ci` → `astro sync` → lint → `astro check` → build (`ci.yml:18-25`). A `npm test` step fits after `astro check`, and it needs no secrets.
  - lint-staged already runs `eslint --fix` on `*.ts`.
- **Time zone data:** Node official builds ship full ICU, and `Europe/Warsaw` was present locally (ICU 78.3, Node 24). The CI Node 22 ICU version was not checked.

## Code References

- `src/lib/availability.ts:10` — `STATION_TIME_ZONE`; comment `:8-9` points at SQL
- `src/lib/availability.ts:27-49` — `toDateString`/`dateToUtcMs`: UTC-only calendar math
- `src/lib/availability.ts:52-61` — `currentStationMonth()`, the only clock read for station "now" in TS
- `src/lib/availability.ts:111-128` — `buildWindow`, `sameWeekdayDatesInMonth`, `daysInMonth`
- `src/lib/availability.ts:173-181` — `windowMinutes` (wall clock, no DST correction)
- `src/lib/availability.ts:232-244` — `formatStationInstant` (`new Date(timestamptz)`)
- `supabase/migrations/20260926130000_create_availability.sql:36-49` — `is_availability_month_editable`
- `supabase/migrations/20260926140000_harden_availability_writes.sql:1-12` — `ends_at - 1µs` month check
- `scripts/smoke.mjs:15-38` — third copy of the station-month logic; month + 12 and + 3
- `src/pages/availability.astro:33-36,91,96` — offered months, lock-month slice, locked flag
- `src/pages/manager/availability.astro:35-39,122,167-175` — team months, lock-month slice, "In progress" status
- `src/pages/manager/months.astro:10,26` — offered months, lock-month slice
- `src/pages/dev/availability-states.astro:59` — inline copy of the carry-over label
- `src/pages/api/availability/create.ts:30-31` — weekday repeat + `buildWindow`
- `src/pages/api/availability/update.ts:59-63` — rebuilds date from the stored `starts_at`
- `node_modules/@astrojs/cloudflare/dist/index.js:93-200` — adapter adds the Cloudflare Vite plugin
- `tsconfig.json:3,8-10` — include `**/*`; `@/*` path

## Architecture Insights

- **Wall-clock by contract.** `starts_at`/`ends_at` are `timestamp without time zone` in Europe/Warsaw wall clock, handled as strings and `Date.UTC` parts. Only the instant `locked_at` (timestamptz) goes through `new Date` (`src/lib/availability.ts:1-6,230-231`).
- **The helpers are pure and import nothing.** Apart from the one clock read and `console.error` in `logAvailabilityError`, this makes the module an ideal first unit-test target with no mocking of Supabase or Astro.
- **The database enforces, the TS mirrors for display.** Editability is enforced in SQL. TS reproduces it only for display (offered months, the "In progress" text, the locked flag). Unit tests on TS cannot prove enforcement; that boundary matches the Phase 1 / Phase 2 split in test-plan §3.

## Historical Context (from prior changes)

- `context/archive/2026-09-26-employee-availability-management/reviews/impl-review.md:34-51`:
  - F1, an overnight window reaching a locked month, was fixed by `20260926140000_harden_availability_writes.sql` and verified by a manual SQL check (supported by the cited migration).
  - `:45` leaves open which month owns the day-1 hours for S-03.
- `…/impl-review.md:53-61`: F2, a spilled window hidden on day 1, was fixed in `availability.astro` with a carry-over query (supported: `src/pages/availability.astro:67-68,104-106`). It was checked with lint, astro check and SQL, not over HTTP.
- `…/impl-review.md:93-101`: F6, DST behaviour, was fixed by documentation only. CLAUDE.md's Availability section does contain the wording (supported).
- `context/archive/2026-09-26-employee-availability-management/plan.md`:
  - `:69-70` sets the wall-clock and two-place station-zone rules.
  - `:196` sets the "`Date.UTC` on date parts only" rule.
  - `:396` says "None. The repo has no test runner", and the helpers were exercised only manually and through smoke. That still holds at this commit (`package.json` has no test script or runner).
- `context/archive/2026-09-26-employee-availability-management/plan-brief.md:26-27,69` records the decision: Europe/Warsaw constant, `timestamp` not `timestamptz`, DST drift accepted.
- `context/archive/2026-09-29-manager-availability-visibility/plan.md`:
  - `:33-34,44,54` covers overnight windows grouped on their start day, totals without splitting, carry-over counted only on day 1.
  - `:161` describes `windowMinutes`.
  - `:261` says no tests; totals were checked manually.
- `context/foundation/roadmap.md:121-123` is the S-03 handoff: page month-wide reads, the spill rule, wall-clock durations. S-03 is still blocked (`:124`), and the roadmap does not say S-03 will reuse these TS helpers.

## Related Research

- `context/archive/2026-09-26-employee-availability-management/research.md:107,128,132` — origin of the time zone question ("Workers run in UTC").

## Open Questions

1. **Runner config vs. test-plan §4.** The evidence favours a plain `vitest.config.ts` over `getViteConfig` for this phase. The plan should decide and record it, and update the §4 "Vitest via Astro `getViteConfig`" row accordingly. Should a later phase need Astro's Container API, `getViteConfig` would have to be revisited together with an adapter upgrade (14.3.3 and 15.0.0-beta were not checked for the guard).
2. **UTC only, or UTC plus a second zone?** Phase 1 asks for `TZ=UTC`. A second run under a far-off zone (e.g. `Pacific/Kiritimati`, UTC+14) would prove the helpers ignore the process zone rather than merely agree with UTC. Cost: one more config or a CLI env on ubuntu CI. This is a plan choice.
3. **Guard the three `'Europe/Warsaw'` literals?** A unit test could read the SQL migration and `scripts/smoke.mjs` as text and assert that they contain `STATION_TIME_ZONE`. It is cheap, but it is a structural check, not behaviour. The plan should take it or leave it.
4. **The duplicated `.slice(0, 7)` lock-month keys** (three pages) and the dev-page carry-over copy are not covered by helper tests. Replacing them with `monthOfDate`/`formatCarryOver` is a refactor outside the testing scope unless the plan includes it.
5. **Intl label brittleness across ICU versions.** `en-GB` short September renders as `Sept` on ICU 78.3. CI Node 22's ICU was not checked, so label assertions should avoid September or be confirmed on CI.
6. **Vitest 5 is about a month old** (5.0.0 released 2026-09-03 per the registry, via a worker). 4.1.11 has the same config shape if 5 misbehaves.
