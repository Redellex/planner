# Test Runner and Station-Time Logic Implementation Plan

## Overview

Rollout Phase 1 of `context/foundation/test-plan.md`, covering risk #1: station wall-clock dates drifting on the UTC Worker. This plan bootstraps the repo's first unit runner, a plain Vitest config that always runs in UTC. It then pins the station-time helpers in `src/lib/availability.ts` to literal calendar facts. A guard test checks that every copy of the station time zone literal agrees. One Stryker run confirms that the assertions would fail if the date maths broke. Finally, the test plan's cookbook and gates are updated.

## Current State Analysis

- **No test runner exists.** `package.json` has no `test` script, no Vitest and no test files. The only automated behaviour check is `scripts/smoke.mjs` over HTTP (`package.json:5-16`, `.github/workflows/ci.yml`).
- **All station-time logic sits in one module with no imports**, `src/lib/availability.ts`. Calendar math runs `Date.UTC` on date parts and reads results with `getUTC*` (`:27-49`). Every `Intl.DateTimeFormat` passes an explicit `timeZone` (`:53-57`, `:201-208`, `:232-238`). This reading has never been proven under a UTC process; the dev machine runs in `Europe/Warsaw`, which is the "passes in CET" trap.
- **One clock read.** `currentStationMonth()` calls `new Date()` with no injectable clock (`:52-61`). `upcomingMonths()` (`:70-73`) and `teamAvailabilityMonths()` (`:76-78`) build on it.
- **The station zone literal lives in three places:**
  - `STATION_TIME_ZONE` (`src/lib/availability.ts:10`);
  - `now() at time zone 'Europe/Warsaw'` in `public.is_availability_month_editable` (`supabase/migrations/20260926130000_create_availability.sql:43`);
  - `timeZone: "Europe/Warsaw"` in smoke's `stationMonthPlus` (`scripts/smoke.mjs:19`).

  The migration also mentions the zone in comments (`:31`, `:35`). CLAUDE.md says they must stay in sync. Today only comments enforce that.
- **Runner constraints** (from research):
  - `getViteConfig` would run the `@astrojs/cloudflare` 14.3.1 hook, which adds `@cloudflare/vite-plugin` with no `VITEST` guard.
  - npm scripts run under cmd.exe on Windows, so a `TZ=UTC` script prefix fails.
  - `test.env` does not reach worker threads.
  - `tsconfig.json` includes `**/*`, so test and config files are type-checked by `astro check` and linted with `strictTypeChecked` (`eslint.config.js:17-24`).
  - `@types/node` is only a transitive dependency today.
- **The SQL month rules are out of reach:** `is_availability_month_editable` and the `ends_at - 1µs` check (`supabase/migrations/20260926140000_harden_availability_writes.sql`) belong to rollout Phase 2 (pgTAP).

## Desired End State

- `npm test` runs Vitest once, in UTC, on any OS, and exits non-zero on failure. CI's `ci` job runs it after `astro check`.
- `src/lib/availability.test.ts` pins every helper that turns dates into days, months or weekdays to literal values taken from the calendar and the EU DST rule. Helpers under test never compute expected values.
- A guard test fails when the process zone is not UTC, so a removed `TZ` line cannot silently fall back to CET on a dev machine.
- A guard test fails when any SQL `at time zone '…'` or smoke `timeZone: "…"` literal differs from `STATION_TIME_ZONE`.
- One Stryker run on `src/lib/availability.ts` has been triaged, and its score and the conscious equivalents are recorded in Progress and in test-plan §6.6.
- test-plan §3/§4/§5/§6.1/§6.6 and CLAUDE.md reflect the real runner.

Verify with `npm test`, `npm run lint`, `npx astro check`, `npm run build` and a green CI run.

### Key Discoveries:

- `currentStationMonth()` takes no clock argument (`src/lib/availability.ts:52-61`). Tests freeze it with `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime(...)`, which needs no production change.
- `sameWeekdayDatesInMonth` works from the day number only and never computes a weekday (`:117-121`). An expected list taken from the calendar catches arithmetic errors that a weekday-based oracle would not.
- `windowMinutes` deliberately ignores DST (`:178-181`). The CLAUDE.md Availability section is the oracle: 00:00–00:00 on a DST day counts as 24h.
- `formatStationInstant` is the only `new Date` on DB data (`:242-244`). With an offset in the string its output does not depend on the process zone. An offset-less string would shift. PostgREST is assumed to send the offset for timestamptz (`:230-231`, not verified at runtime).
- In `en-GB`, short September renders as `Sept` on ICU 78.3, and CI Node 22's ICU was not checked. Label assertions avoid September.
- `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` 10.0.0 declare `vitest >=2` and `node >=22` (`npm view`, 2026-10-01). The peer range admits Vitest 5.0.3 and `.nvmrc` 22.14.0, but the runner was built against vitest 4.1.10 (its devDependencies) before Vitest 5.0.0 shipped (2026-09-03), so Vitest 5 support is unproven; Phase 3 carries a fallback.

## What We're NOT Doing

- No `getViteConfig` and no Astro Container API. test-plan §4 is updated to say so.
- No second time zone run (e.g. `Pacific/Kiritimati`). The Worker only runs in UTC; the UTC guard test covers the "passes in CET" trap.
- No refactor of the three `.slice(0, 7)` lock-month keys (`src/pages/availability.astro:91`, `src/pages/manager/availability.astro:122`, `src/pages/manager/months.astro:26`) or of the dev page's inline carry-over copy.
- No production change to `src/lib/availability.ts`, such as an injectable clock, unless a test exposes a real bug. If it does, stop and ask before fixing.
- No tests for the SQL editability rule, the `ends_at - 1µs` spill rule or RLS: that is rollout Phase 2 (pgTAP).
- No tests for an offset-less `formatStationInstant` input, the error and URL helpers (`describeWriteError`, `availabilityUrl`, `teamAvailabilityUrl`, `resolveFeedbackError`) or `formatDuration`. They carry no station-time risk.
- No Stryker in CI or pre-commit, no pre-commit test hook (Lesson 3 territory) and no coverage thresholds.

## Implementation Approach

The runner config is standalone and sets `process.env.TZ = "UTC"` before Vitest starts its workers. Tests live next to the module (`src/lib/*.test.ts`), import `describe`/`it`/`expect`/`vi` from `"vitest"` explicitly and use relative imports. Every expected value is a literal written from the calendar facts in `research.md` § "Independent calendar facts" plus the cross-checked values in this plan. Repeated fact shapes, such as month flips or overnight windows, use `it.each` tables so each row catches a different regression. The runner is proven green on a guard test before the real tests are added. Stryker then tests the tests, and the docs are written last from real results.

## Critical Implementation Details

- **TZ ordering.** `process.env.TZ = "UTC"` must be the first statement in `vitest.config.ts`, before `defineConfig` is exported, because worker threads inherit the zone only if it is set before they start. Do not move it into `test.env` or a setup file; neither reaches thread workers.
- **Fake timers scope.** Fake only `Date` (`toFake: ["Date"]`) and restore with `vi.useRealTimers()` in `afterEach`, so a frozen clock cannot leak into later tests.
- **Guard regexes must ignore comments.** The migration mentions `Europe/Warsaw` in a comment and in a `comment on table` string. Match the code form `at time zone '<zone>'` (case-insensitive) across all of `supabase/migrations/*.sql`, and `timeZone: "<zone>"` in `scripts/smoke.mjs`. Require at least one match in each source, so a renamed function or a regex that stops matching fails loudly instead of passing on zero matches.

## Phase 1: Runner Bootstrap

### Overview

Install Vitest, add a UTC-forcing config, an `npm test` script and a guard test proving the process zone is UTC, and wire `npm test` into CI.

### Changes Required:

#### 1. Dependencies and script

**File**: `package.json`

**Intent**: Add the runner and Node typings as dev dependencies, and a one-shot `test` script that CI and humans share.

**Contract**:
- devDependencies `vitest@^5.0.3` (fallback `^4.1.11` if 5 misbehaves; note the fallback in Progress) and `@types/node@^22`, matching `.nvmrc` 22.14.0.
- Script `"test": "vitest run"`, with no env prefix.

#### 2. Runner config

**File**: `vitest.config.ts` (new)

**Intent**: Run tests in a UTC process on every OS, matching the Worker, without loading Astro or the Cloudflare plugin.

**Contract**:
- `process.env.TZ = "UTC"` as the first statement, with a one-line comment on why it is not in `test.env`.
- `defineConfig` from `vitest/config`, with `test.environment: "node"` and `test.include: ["src/**/*.test.ts"]`.
- No `globals`.

#### 3. UTC guard test

**File**: `src/lib/test-runtime.test.ts` (new)

**Intent**: Fail loudly if the runner is not in UTC, for example because the config line was removed. Otherwise every date test could pass in CET on a dev machine while proving nothing about the Worker.

**Contract**: Asserts `Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC"` and `new Date(2026, 6, 1).getTimezoneOffset() === 0`. A July date is used because Warsaw would give `-120` there.

#### 4. CI step

**File**: `.github/workflows/ci.yml`

**Intent**: Make unit tests a required gate, as test-plan §5 says ("required after §3 Phase 1").

**Contract**: In the `ci` job, add `- run: npm test` between `npx astro check` and `npm run build`. It needs no secrets.

### Success Criteria:

#### Automated Verification:

- `npm test` passes locally on Windows with only the guard test
- `npm run lint` passes, including `vitest.config.ts` and the guard test
- `npx astro check` passes
- `npm run build` passes

#### Manual Verification:

- Temporarily commenting out the `process.env.TZ` line makes the guard test fail on the Warsaw dev machine (then restore it)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Station-Time Tests and Zone-Literal Guard

### Overview

Pin each station-time helper to literal calendar facts with the clock frozen, and guard the three copies of the station zone literal.

### Changes Required:

#### 1. Helper tests

**File**: `src/lib/availability.test.ts` (new)

**Intent**: Prove that days, months, weekdays and the station month come out right on a UTC process around DST, month and year boundaries and leap February. Each `describe` names the regression it catches. Expected values are literals, never helper output.

**Contract**: one `describe` per behaviour, with these cases (all values cross-checked against the calendar / raw `Intl` on 2026-10-01):

- **Station month at Warsaw midnight**, using `currentStationMonth` with a frozen clock (`it.each`). This catches a station month taken from UTC instead of Warsaw.

  | Instant (UTC) | Station month |
  |---|---|
  | `2026-03-31T21:59:59Z` | `2026-03` |
  | `2026-03-31T22:00:00Z` | `2026-04` (CEST) |
  | `2026-10-31T22:59:59Z` | `2026-10` |
  | `2026-10-31T23:00:00Z` | `2026-11` (CET) |
  | `2026-12-31T22:59:59Z` | `2026-12` |
  | `2026-12-31T23:00:00Z` | `2027-01` |

- **Offered months:**
  - at `2026-12-31T22:59:59Z`, `upcomingMonths()` → `["2027-01","2027-02","2027-03"]`;
  - at `2026-12-31T23:00:00Z`, `upcomingMonths()` → `["2027-02","2027-03","2027-04"]`;
  - at `2026-10-31T23:00:00Z`, `teamAvailabilityMonths()` → `["2026-11","2026-12","2027-01","2027-02"]`.

  This catches the wrong months becoming editable or visible.
- **Month arithmetic:** `addMonths("2026-12", 1)` → `"2027-01"`, and `addMonths("2027-01", -1)` → `"2026-12"`.
- **Calendar validity:**
  - `parseDate` accepts `"2028-02-29"` and rejects `"2027-02-29"` and `"2026-04-31"`;
  - `daysInMonth("2028-02")` has 29 entries ending `"2028-02-29"`, and `daysInMonth("2027-02")` has 28 ending `"2027-02-28"`.
- **Overnight windows** (`buildWindow`, `it.each`):

  | Date | Start–end | starts_at → ends_at |
  |---|---|---|
  | `2026-10-31` | 19:00–07:00 | `2026-10-31T19:00:00` → `2026-11-01T07:00:00` |
  | `2028-02-28` | 22:00–06:00 | ends `2028-02-29T06:00:00` |
  | `2026-12-31` | 22:00–06:00 | ends `2027-01-01T06:00:00` |
  | `2026-03-29` | 00:00–00:00 | ends `2026-03-30T00:00:00` (full day on the spring DST day) |
  | `2026-10-25` | 00:00–00:00 | ends `2026-10-26T00:00:00` (full day on the fall-back DST day) |
  | `2026-10-31` | 08:00–16:00 | stays on `2026-10-31` (same-day control) |

- **Wall-clock durations on DST days** (`windowMinutes`):
  - 00:00–00:00 on `2026-03-29` → `1440`;
  - 00:00–00:00 on `2026-10-25` → `1440`;
  - `2026-03-29T01:00:00` → `2026-03-29T04:00:00` → `180`;
  - `2026-10-31T19:00:00` → `2026-11-01T07:00:00` → `720`.

  The oracle is CLAUDE.md: wall-clock difference, no DST correction.
- **Weekday repeats** (`sameWeekdayDatesInMonth`, `it.each`):
  - from `"2026-10-18"` → the Sundays `04, 11, 18, 25` of 2026-10;
  - from `"2026-10-31"` → the Saturdays `03, 10, 17, 24, 31`;
  - from `"2028-02-29"` → the Tuesdays `01, 08, 15, 22, 29` of 2028-02.
- **Monday-first grid:**
  - `mondayWeekdayIndex("2026-10-01")` → `3` (Thursday);
  - `mondayWeekdayIndex("2026-11-01")` → `6` (Sunday);
  - `calendarWeeks("2026-11")` → 6 weeks, the first week is six `null`s then `"2026-11-01"`, and the last week is `"2026-11-30"` then six `null`s;
  - `calendarWeeks("2027-02")` → exactly 4 weeks with no `null` (1 Feb 2027 is a Monday).
- **Labels** (no September):
  - `weekdayName("2028-02-29")` → `"Tuesday"`;
  - `weekdayName("2026-03-29")` → `"Sunday"`;
  - `formatDay("2026-10-31")` → `"Sat 31 Oct"`;
  - `formatMonth("2026-11")` → `"November 2026"`.
- **Overnight markers:**
  - `formatWindow` of the 2026-10-31 19:00–07:00 window → `"19:00 – 07:00 (+1)"`;
  - `formatWindowCompact` → `"19–07+1"`;
  - `formatCarryOver` → `"00:00 – 07:00 (from Sat 31 Oct)"`.
- **Station instant** (`formatStationInstant`, offset-carrying strings only):

  | Input | Output |
  |---|---|
  | `"2026-10-31T22:59:00+00:00"` | `"31 Oct 2026, 23:59"` |
  | `"2026-10-31T23:00:00+00:00"` | `"1 Nov 2026, 00:00"` |
  | `"2026-03-29T01:00:00+00:00"` | `"29 Mar 2026, 03:00"` |
  | `"2026-10-25T00:30:00+00:00"` | `"25 Oct 2026, 02:30"` |
  | `"2026-10-25T01:30:00+00:00"` | `"25 Oct 2026, 02:30"` |

  The two fall-back instants pin that output carries no zone marker.

#### 2. Station zone literal guard

**File**: `src/lib/station-time-zone.test.ts` (new)

**Intent**: Enforce the CLAUDE.md rule that the station zone in SQL and smoke matches `STATION_TIME_ZONE`. If they drift, the app and the database disagree about which month is editable around midnight.

**Contract**:
- Read every `supabase/migrations/*.sql` and `scripts/smoke.mjs` as text (`node:fs`, paths resolved from the repo root).
- Collect every `at time zone '<zone>'` (case-insensitive) from SQL and every `timeZone: "<zone>"` from smoke.
- Assert each source has at least one match, and that every captured zone equals `STATION_TIME_ZONE`.

### Success Criteria:

#### Automated Verification:

- `npm test` passes with the helper tests and the zone guard
- `npm run lint` passes on the new test files with no `eslint-disable`
- `npx astro check` passes

#### Manual Verification:

- Temporarily changing the smoke `timeZone` literal to `"Europe/Berlin"` makes the zone guard fail (then restore it)
- No expected value in `availability.test.ts` is produced by calling a helper from `src/lib/availability.ts` (read-through)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Mutation Gate

### Overview

Run Stryker once on `src/lib/availability.ts` to check that the Phase 2 assertions would catch broken date maths. Then kill the survivors that would hurt a user and consciously note the equivalent ones.

### Changes Required:

#### 1. Stryker setup

**File**: `package.json`, `stryker.config.json` (new), `.gitignore`, `tsconfig.json`

**Intent**: Make the mutation run reproducible for later rollout phases without adding it to CI.

**Contract**:
- devDependencies `@stryker-mutator/core@^10` and `@stryker-mutator/vitest-runner@^10`.
- `stryker.config.json` with `testRunner: "vitest"`, `mutate: ["src/lib/availability.ts"]`, HTML and clear-text reporters, and no `thresholds.break`.
- `.gitignore` gains `reports/` and `.stryker-tmp/`, and `tsconfig.json` `exclude` gains `".stryker-tmp"` and `"reports"`. `astro check` does not read `.gitignore`, so a sandbox left by a killed run would otherwise be type-checked as a second copy of `src/`.
- No npm script: run with `npx stryker run`. A different module can be scoped with `--mutate`.
- **Fallback if the vitest runner fails on Vitest 5** (the dry run errors or reports 0 tests): first switch `stryker.config.json` to `testRunner: "command"` with `commandRunner.command: "npm test"`. It is slower and has no per-test coverage, but the module is small, it keeps Vitest 5 and it needs no Phase 1 rework. Only if that is too slow to be usable, pin `vitest@^4.1.11`, rerun checks 1.1–1.4 and the Phase 2 suite, and use the vitest runner. Record whichever path was taken in Progress and test-plan §6.6.

#### 2. Survivor triage

**File**: `src/lib/availability.test.ts`

**Intent**: For each surviving mutant in a station-time helper, ask whether the change would hurt a user or the business. If yes, add an assertion taken from the calendar that kills it. If no (an equivalent or cosmetic mutant, or one in the out-of-scope error/URL helpers), leave it and record why.

**Contract**: New assertions follow the Phase 2 rule of literal expected values. Do not pin implementation details only to raise the score.

### Success Criteria:

#### Automated Verification:

- `npx stryker run` completes and writes `reports/mutation/mutation.html`
- `npm test` and `npm run lint` pass after any added assertions

#### Manual Verification:

- Every surviving mutant in a station-time helper (date, month, weekday, window, duration or label function; the out-of-scope `formatDuration`, `describeWriteError`, `availabilityUrl`, `teamAvailabilityUrl` and `resolveFeedbackError` are exempt) is either killed or recorded as equivalent with a one-line reason
- The final mutation score (total and "of covered code") and the list of accepted survivors are noted for test-plan §6.6

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Test-Plan and Docs Sync

### Overview

Record the real runner, the gate and the cookbook pattern so the next phase (and the next agent) adds date tests the same way.

### Changes Required:

#### 1. Test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Bring the strategy doc in line with what shipped.

**Contract**:
- §3 row 1 Status → `complete` (the orchestrator's parser literal).
- §4: change "Test base today" to describe the unit runner. The unit row becomes "Vitest (plain `vitest.config.ts`, no `getViteConfig`)" with the installed version and `checked: <date>`, plus a note that `getViteConfig` loads the Cloudflare plugin, and why. Add a mutation row for Stryker 10 (selective, manual, not CI).
- §5: the unit tests gate becomes "required (wired)".
- §6.1: the cookbook pattern:
  - where tests live;
  - UTC is forced by the config and checked by the guard test;
  - a frozen clock with `toFake: ["Date"]` and `useRealTimers`;
  - expected values are literals from the calendar or DST rule, never helper output;
  - use `it.each` for fact tables;
  - avoid September in `en-GB` labels;
  - run Stryker with `--mutate` on the changed module.
- §6.6: Phase 1 notes, with the mutation score (total and of covered code), accepted survivors, the Vitest version and the Stryker runner path taken.
- Update the "Last updated" stamp.

#### 2. Project instructions

**File**: `CLAUDE.md`

**Intent**: Keep the Commands section true.

**Contract**:
- Add `npm test` (Vitest, UTC forced in `vitest.config.ts`, tests in `src/**/*.test.ts`) and `npx stryker run` (manual mutation gate).
- Replace the smoke bullet's "there is currently no unit/integration test runner in this repo" sentence.
- Add `npm test` to the CI `ci` job order in the CI bullet.
- Under Availability, note that the zone-literal sync rule is now enforced by `src/lib/station-time-zone.test.ts`.

### Success Criteria:

#### Automated Verification:

- `npx prettier --check context/foundation/test-plan.md CLAUDE.md` passes
- `npm test`, `npm run lint` and `npx astro check` still pass

#### Manual Verification:

- CI on the branch's PR is green, including the new `npm test` step
- test-plan §6.1 reads as a usable recipe for someone adding a date test without having read this plan

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- The station month on both sides of Warsaw midnight in CEST, CET and at the year rollover, with a frozen clock.
- Overnight windows across month and year boundaries and on both 2026 DST days; leap February 2028 vs 2027.
- Weekday repeats including a fifth occurrence, and the Monday-first grid with maximal (Nov 2026) and zero (Feb 2027) padding.
- Labels and station-instant formatting, including the ambiguous fall-back hour.
- Guards: the process zone is UTC, and the zone literals agree across TS, SQL and smoke.

### Integration Tests:

- None in this phase. The SQL editability and spill rules are rollout Phase 2 (pgTAP). The smoke script keeps the end-to-end checks.

### Manual Testing Steps:

1. Remove the `TZ` line → the guard test fails on the Warsaw machine → restore it.
2. Change the smoke `timeZone` literal → the zone guard fails → restore it.
3. Open the Stryker HTML report and triage survivors in station-time helpers.

## Performance Considerations

None. The suite is pure functions with no I/O apart from reading four or five text files in the zone guard.

## Migration Notes

None. No schema or production code change.

## References

- Research: `context/changes/testing-station-time/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 risk #1, §3 Phase 1, §4, §5, §6.1)
- Module under test: `src/lib/availability.ts:10,52-128,156-244`
- Zone literals: `supabase/migrations/20260926130000_create_availability.sql:43`, `scripts/smoke.mjs:19`
- CI: `.github/workflows/ci.yml:18-25`
- Prior decisions: `context/archive/2026-09-26-employee-availability-management/plan.md:69-70,196`; `context/archive/2026-09-29-manager-availability-visibility/plan.md:161`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner Bootstrap

#### Automated

- [x] 1.1 `npm test` passes locally on Windows with only the guard test
- [x] 1.2 `npm run lint` passes, including `vitest.config.ts` and the guard test
- [x] 1.3 `npx astro check` passes
- [x] 1.4 `npm run build` passes

#### Manual

- [x] 1.5 Temporarily commenting out the `process.env.TZ` line makes the guard test fail on the Warsaw dev machine (then restore it)

### Phase 2: Station-Time Tests and Zone-Literal Guard

#### Automated

- [ ] 2.1 `npm test` passes with the helper tests and the zone guard
- [ ] 2.2 `npm run lint` passes on the new test files with no `eslint-disable`
- [ ] 2.3 `npx astro check` passes

#### Manual

- [ ] 2.4 Temporarily changing the smoke `timeZone` literal to `"Europe/Berlin"` makes the zone guard fail (then restore it)
- [ ] 2.5 No expected value in `availability.test.ts` is produced by calling a helper from `src/lib/availability.ts` (read-through)

### Phase 3: Mutation Gate

#### Automated

- [ ] 3.1 `npx stryker run` completes and writes `reports/mutation/mutation.html`
- [ ] 3.2 `npm test` and `npm run lint` pass after any added assertions

#### Manual

- [ ] 3.3 Every surviving mutant in a station-time helper (date, month, weekday, window, duration or label function; the out-of-scope `formatDuration`, `describeWriteError`, `availabilityUrl`, `teamAvailabilityUrl` and `resolveFeedbackError` are exempt) is either killed or recorded as equivalent with a one-line reason
- [ ] 3.4 The final mutation score (total and "of covered code") and the list of accepted survivors are noted for test-plan §6.6

### Phase 4: Test-Plan and Docs Sync

#### Automated

- [ ] 4.1 `npx prettier --check context/foundation/test-plan.md CLAUDE.md` passes
- [ ] 4.2 `npm test`, `npm run lint` and `npx astro check` still pass

#### Manual

- [ ] 4.3 CI on the branch's PR is green, including the new `npm test` step
- [ ] 4.4 test-plan §6.1 reads as a usable recipe for someone adding a date test without having read this plan
