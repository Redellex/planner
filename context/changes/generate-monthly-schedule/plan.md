# Generate Monthly Schedule Implementation Plan

## Overview

Roadmap slice S-03 (north star, GitHub #4): a manager clicks **Generate** for one of the next 3 months and gets a persisted draft schedule. The draft covers every 24/7 station day with 12h, 8h or 6h shifts, assigns each shift to one employee inside their availability, rotates 12h and night shifts fairly, keeps hours even, and flags every shift nobody can take. The month is locked first so availability cannot change under the draft. The generator is a pure, property-tested module (test-plan Phase 4 is delivered here). The draft is stored in new manager-only tables that S-04 will override and publish.

## Current State Analysis

- No schedule, shift or assignment code or table exists. The domain tables are `profiles`, `availability_windows` and `availability_locks` (`supabase/migrations/20260925120000_…`, `20260926130000_…`).
- Availability windows are `timestamp without time zone` holding Europe/Warsaw wall-clock time, more than 0 and at most 24h, and never overlapping per employee (half-open) (`supabase/migrations/20260926130000_create_availability.sql:17-31`). All math stays on strings and calendar parts (`src/lib/availability.ts:1-6`). The wall-clock-to-ms converter `timestampToUtcMs` is private (`src/lib/availability.ts:173-176`).
- `loadAllPages` (`src/lib/team-availability.ts:24-56`) and the all-or-unknown `buildTeamView` (`:78-95`) are the honest-read pattern that test-plan §6.4 requires for any list feeding a "none" conclusion.
- The three team read shapes (profiles, month windows, carry-overs) live inline in `src/pages/manager/availability.astro:65-99`.
- Month lock writes: an idempotent upsert/delete in `src/pages/api/manager/months/lock.ts:34-39`. On failure it redirects with the raw `error.message` (legacy).
- Clean manager endpoint + per-feature lib pattern: `src/pages/api/manager/users/role.ts` + `src/lib/manager-users.ts:7-69` (constants, allow-list, resolver, logger, URL builder, error describer).
- Gating: anything under `/manager` or `/api/manager` is manager-only (`src/lib/route-access.ts:6`). Every new page file needs a row in `EXPECTED_ACCESS` (`src/lib/route-inventory.test.ts:15-37`).
- Workers Free plan: about 10 ms of CPU per request, no background jobs (`context/foundation/infrastructure.md:17,63,94`; `wrangler.jsonc` has only `ASSETS`). Generation must be a bounded, synchronous computation.
- fast-check is not installed. Test-plan Phase 4 ("Generator invariants") is gated on this plan (`context/foundation/test-plan.md:75-77`). §6.5 is "TBD" (`:178-180`).

## Desired End State

On `/manager/schedule` a manager picks the current month or one of the next 3:

- **For an upcoming month** they can **Generate**. This locks the month, reads the whole team's availability in full and stores a draft.
- **Regenerate** replaces the draft atomically after an explicit confirm.
- **Discard** deletes the draft.
- **Unlock** on `/manager/months` is refused, with a clear message, while the month has a draft.

The page shows:

- a Monday-first calendar of station days;
- a day panel listing each shift (time, length, assignee or **Uncovered**);
- a notice for station days where no one is assigned (S-04 will block publishing on these);
- a per-person summary: shifts, hours, 12h count, night count, and a flag for anyone with availability but 0 shifts;
- a list of fairness exceptions the generator could not avoid.

How to verify:

- `npm test` runs a fast-check invariant suite that proves the guardrails over generated inputs (risk #5).
- `npm run test:db` proves the new tables' rules.
- `npm run smoke` walks generate, view, refused unlock, discard and unlock against a running server.

### Key Discoveries:

- **Generation locks first, then reads.** S-01 decided that S-03 inserts the lock itself and reads availability after locking (`context/archive/2026-09-26-employee-availability-management/plan.md:46,74`).
- **`is_manager()`** (SECURITY DEFINER) is the required helper in manager policies (`supabase/migrations/20260925120000_create_profiles_and_roles.sql:43-59`).
- **pgTAP conventions** (`supabase/tests/database/availability_month_lock.test.sql:1-30`):
  - `begin; select plan(N); … finish(); rollback;`
  - station months via `\gset`
  - fixture users inserted into `auth.users`
- **Smoke month usage** (`scripts/smoke.mjs:31-45`):
  - station+12 for lock/unlock;
  - station+3 for CRUD, leaving the smoke user's windows on day 1 and day 2.

  Station+3 is the only upcoming month the script already treats as smoke-owned.

- **No checkbox component exists** in `src/components/ui/`, and hydration is off by default. The regenerate confirm is therefore a second page state (`?confirm=replace`) with a plain submit button.

## What We're NOT Doing

- **Configurable station hours or shift templates:** the station is 24/7 with fixed patterns in a code constant. No settings UI or table.
- **Multi-month history:** no fairness carried across months (roadmap S-03 decision), and no cross-month "touching shift" check. A person who works the last night of one month can be given 06:00 on day 1 of the next, because months are generated independently. S-04 overrides cover this.
- **Labour-law rules:** no rest periods beyond "no touching shifts, at most one shift per station day" (PRD Non-Goal).
- **A hard minimum shift count per person:** balancing plus a "0 shifts" flag replaces it.
- **Overrides, accept, publish or employee visibility:** these are S-04 and S-05. Employees cannot read `schedules` or `schedule_shifts` at all in S-03.
- **Next-month windows:** windows starting in the next month (day 1 00:00–06:00) are not used for the last station night, because that month is not locked and they could still change.
- **Async or progress UI:** generation is a fast synchronous form POST. The NFR's "visible progress if longer" is out of scope while the measured cost stays small.
- **Cleanup of the legacy `/manager/months` page and `lock.ts`:** only the new FK-refusal message is added.
- **A `starts_at` index:** reads stay small at single-station scale (S-02 decision).

## Implementation Approach

The work follows the codebase's split of **database as enforcement, pure core, thin shell**:

1. **Postgres holds the hard guarantees:**
   - manager-only RLS;
   - only the 9 allowed shift shapes;
   - no two shifts overlap (one person on duty at a time);
   - a draft cannot exist without its month lock, and the lock cannot be deleted while a draft exists;
   - an atomic replace RPC.
2. **A pure `generateSchedule`** (input: month + windows; output: shifts) and **a pure `summarizeSchedule`** (counts, uncovered shifts, days with no one, fairness exceptions, outside-availability assignments) live in `src/lib`. They are proved by fast-check properties whose oracles are built from the input, never from generator output.
3. **Thin Astro shell:**
   - the generate and discard endpoints, which lock, read honestly, generate and replace;
   - one manager page that re-reads everything and calls `summarizeSchedule`, so the same summary later validates S-04 overrides (FR-004).

### Station day and shift model (agreed)

- **Station day `D`** = `[D 06:00, D+1 06:00)`, for every calendar date `D` in the month. A shift belongs to the month of its station day: `month = date_trunc('month', starts_at - 6h)`. So `D+1 00:00–06:00` on the last day belongs to month M, and day-1 00:00–06:00 belongs to M−1.
- **Shift shapes** (start time, length): 06:00/12h, 18:00/12h, 06:00/8h, 14:00/8h, 22:00/8h, 06:00/6h, 12:00/6h, 18:00/6h, 00:00/6h.
- **Patterns per station day** (one person on duty at a time):
  - 12+12 = 06–18 | 18–06
  - 8+8+8 = 06–14 | 14–22 | 22–06
  - 12+6+6 = 06–18 | 18–24 | 00–06
  - 6+6+12 = 06–12 | 12–18 | 18–06
  - 6×4 = 06–12 | 12–18 | 18–24 | 00–06
- **Night shift** = a shift covering 00:00–06:00: 18–06, 22–06 or 00–06. Exactly one per station day.
- **Eligible for shift `s`** = a member whose merged availability contains `s`. Merged availability is the person's windows starting in M, plus their windows starting in M−1 that end after `M-01 06:00`, with touching windows merged into one span.
- **Hard rules:**
  - an assignment is inside the assignee's merged availability;
  - a person gets at most one shift per station day;
  - a person never gets two shifts where one ends exactly when the other starts.
- **Generator priorities, in order:**
  1. Cover as many hours as possible.
  2. **12h rule.** For an assigned 12h shift `s` with assignee `a`: `long(a) ≤ min(long(e) for e in eligible(s)) + 1`, using final counts. A pattern that keeps the rule beats one that breaks it at equal coverage. When coverage needs the 12h shift anyway, it is kept and reported.
  3. **Night rule.** The same predicate with night counts.
  4. Total hours as even as availability allows.
  5. Fewer shifts.
- **Uncovered** = a shift with `employee_id = null`. A shift is left uncovered only when every eligible member is blocked by a hard rule.
- **Flags:**
  - "days with no one assigned" = station days whose shifts are all uncovered;
  - "0 shifts" = members with any availability in the month but no assigned shift.

## Critical Implementation Details

- **Timing & lifecycle:**
  1. Generate checks for an existing draft. A draft without `confirm=replace` is refused.
  2. It upserts the lock.
  3. It reads profiles, month windows and carry-overs through `loadAllPages`. If any read is unknown, it stops with an allow-listed load error and generates nothing. The lock stays; this is acceptable, matches S-01's order, and the manager can unlock.
  4. It runs `generateSchedule`.
  5. It calls the `replace_schedule_draft` RPC.

  If the month was unlocked between steps 2 and 5, the RPC fails on the FK and the manager is asked to try again. The RPC is the only write. It deletes the old `schedules` row (cascading to its shifts) and inserts the new one in one transaction, so a failed generate never leaves a half-replaced draft.

- **Performance constraints:** the Free-plan CPU budget is about 10 ms per request. The greedy pass evaluates 5 patterns × at most 4 shifts × members for each station day, and the repair pass is capped at a fixed iteration count (no unbounded search). Workers' `performance.now()` does not advance during pure CPU work, so the cost is measured under Node as a proxy (Phase 2). The target is a median below 5 ms for a 40-person, 31-day, fragmented-availability fixture.

## Phase 1: Schedule data model

### Overview

Add the draft tables, their RLS, shape and overlap constraints, the lock coupling and the atomic replace RPC. Regenerate types, prove the rules in pgTAP, and make the legacy unlock refusal readable.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261006120000_create_schedules.sql`

**Intent**: Create the manager-only draft storage, with the hard guarantees enforced in Postgres so that later S-04 writes inherit them.

**Contract**:

- `public.schedules`:
  - `month date primary key references public.availability_locks(month) on delete restrict` (unlock refused while a draft exists);
  - `generated_at timestamptz not null default now()`;
  - `generated_by uuid default auth.uid() references public.profiles(id) on delete set null`.
- `public.schedule_shifts`:
  - `id uuid pk default gen_random_uuid()`;
  - `month date not null references public.schedules(month) on delete cascade`;
  - `starts_at`/`ends_at timestamp not null` (wall-clock, same type as windows);
  - `employee_id uuid null references public.profiles(id) on delete set null` (a deleted account's shifts become uncovered, never vanish).
- Checks on `schedule_shifts`:
  - `(starts_at::time, ends_at - starts_at)` is one of the 9 shapes listed above;
  - `month = date_trunc('month', starts_at - interval '6 hours')::date`.
- Exclusion `schedule_shifts_no_overlap` using gist on `tsrange(starts_at, ends_at) with &&`, station-wide, not per employee (`btree_gist` already exists).
- RLS enabled on both tables, with per-operation policies for `authenticated` using `public.is_manager()`: select, insert, delete. No update policy (S-04 adds what it needs). Column grants: insert only `month` on `schedules`; only `month, starts_at, ends_at, employee_id` on `schedule_shifts`.
- `public.replace_schedule_draft(target_month date, shifts jsonb) returns void`:
  - plpgsql, **SECURITY INVOKER** so RLS applies; follow the `is_manager()` style for `search_path`;
  - deletes the `schedules` row for `target_month`, inserts a new one, then inserts `jsonb_to_recordset(shifts)` rows (`starts_at, ends_at, employee_id`) with `month = target_month`;
  - one call is one transaction;
  - `grant execute … to authenticated`.
- Table comments explain the station day and the month rule. No `at time zone` literal is needed here; if one is added, it must be `'Europe/Warsaw'` (`src/lib/station-time-zone.test.ts`).

#### 2. Regenerated types

**File**: `src/db/database.types.ts`

**Intent**: Make the new tables and the RPC typed for `.from(...)` and `.rpc(...)`.

**Contract**: Generated with `npx supabase gen types typescript --local`; never hand-edited.

#### 3. Database rules tests

**File**: `supabase/tests/database/schedules.test.sql`

**Intent**: Prove the S-03 guarantees in the database, following test-plan §6.2 and the existing file conventions.

**Contract**: One transaction, rolled back. Fixture: employee A and manager Mg in `auth.users`; station month M+1 locked in the transaction. Assertions:

- **Employee:** cannot select, insert or delete either table, and `replace_schedule_draft` fails for them.
- **Manager:**
  - can call the RPC and read the result;
  - the RPC on a month without a lock fails with FK 23503;
  - deleting the lock row while a draft exists fails with 23503; deleting it after the draft is deleted succeeds.
- **Replace semantics:**
  - a second RPC call replaces all rows (old shift ids gone, count equals the new input);
  - an RPC call containing one invalid row (wrong shape) raises and leaves the previous draft intact.
- **Shift constraints:**
  - each of the 9 shapes is accepted;
  - a 7h shift, a 12h shift starting 07:00, and a shift whose `month` does not match its station day are rejected;
  - two overlapping shifts are rejected, even with different employees;
  - touching shifts (18–06 then 06–12 next day) are accepted.
- **Deleting a profile** sets its shifts' `employee_id` to null.

#### 4. Unlock refusal message

**File**: `src/pages/api/manager/months/lock.ts`

**Intent**: The unlock now fails with an FK violation while a draft exists. Show a fixed, readable message instead of the raw database text on the legacy months page.

**Contract**:

- On unlock, error code `23503` redirects with `?error=` set to `Discard this month's draft schedule before unlocking it.` and logs the raw error.
- All other errors keep today's behaviour (legacy, out of scope).
- Export the message from `src/lib/schedule.ts` (created here, filled in Phase 3) so that smoke and the page share it.

### Success Criteria:

#### Automated Verification:

- Migration applies on a clean stack: `npx supabase db reset`
- Types regenerated and include `schedules`, `schedule_shifts` and `replace_schedule_draft`: `npx supabase gen types typescript --local > src/db/database.types.ts`
- Database rules tests pass, including the new file: `npm run test:db`
- Station time zone guard still passes: `npx vitest run src/lib/station-time-zone.test.ts`
- Lint, type-check and unit tests pass: `npm run lint && npx astro check && npm test`

#### Manual Verification:

- In Studio, create a draft for a locked upcoming month by calling `replace_schedule_draft` with two valid shifts. Then press Unlock for that month on `/manager/months`: it shows "Discard this month's draft schedule before unlocking it." and the month stays locked.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Generator core (pure, property-tested)

### Overview

Add the wall-clock minute helpers, the pure generator and the pure summary, with example tests and a fast-check invariant suite. This delivers test-plan Phase 4. Measure CPU cost under Node.

### Changes Required:

#### 1. Wall-clock minute helpers

**File**: `src/lib/availability.ts` (+ `src/lib/availability.test.ts`)

**Intent**: The generator needs to compare and offset wall-clock timestamps without `new Date(...)` on a timestamp string. Expose the existing private conversion instead of duplicating it.

**Contract**:

- `wallClockMinutes(timestamp: string): number`: minutes on the `Date.UTC` calendar axis, no DST.
- `timestampFromWallClockMinutes(minutes: number): string`: returns `"YYYY-MM-DDTHH:MM:00"`.
- `windowMinutes` is reimplemented on top of the first.
- Unit tests:
  - a round trip across a month end and across both 2026 DST days;
  - `2026-10-25T18:00` + 12h → `2026-10-26T06:00:00`.

#### 2. Generator

**File**: `src/lib/schedule-generator.ts`

**Intent**: Turn one month's availability into a deterministic draft that keeps the hard rules and follows the agreed priorities, with bounded work.

**Contract**:

- Exports `SHIFT_SHAPES`, `STATION_DAY_PATTERNS`, `stationDays(month)`, `mergeAvailability(windows)` (per employee, touching windows merged, minutes) and `generateSchedule(input: { month: string; windows: { employee_id: string; starts_at: string; ends_at: string }[] }): { shifts: GeneratedShift[] }`.
- `GeneratedShift = { starts_at: string; ends_at: string; employee_id: string | null }`, sorted by `starts_at`. The shifts form exactly one pattern per station day.
- **Greedy pass, station days in date order.** For each of the 5 patterns:
  - simulate the assignment, taking shifts with the fewest eligible-and-unblocked candidates first;
  - pick the candidate with the lowest key: `(long count, night count, hours)` for a 12h night shift, `(long count, hours)` for a 12h day shift, `(night count, hours)` for other night shifts, `hours` otherwise; profile id breaks ties;
  - score the pattern lexicographically: (uncovered minutes, new 12h/night rule breaks, spread of total hours among members with availability, shift count);
  - commit the best pattern.

  "Blocked" means the person already has a shift on that station day, or a shift ending exactly at the candidate's start.

- **Repair pass.** For each 12h/night rule break, try to reassign that shift to an eligible, unblocked person with a lower count, if that does not break another hard rule. Iterations are capped at a fixed bound (e.g. the number of shifts).
- Input windows are assumed already filtered to M plus carry-overs. The function ignores any part of a span outside the month's station days.

#### 3. Summary

**File**: `src/lib/schedule-summary.ts`

**Intent**: One pure function that turns a stored or generated draft into everything the page shows and S-04 will reuse to warn on overrides. Rule breaks are reported, never hidden.

**Contract**: `summarizeSchedule({ month, members, windows, shifts })` returns:

- `perMember` (shifts, minutes, longCount, nightCount, `hasAvailability`, `zeroShifts`);
- `uncovered` (shifts);
- `daysWithNoOne` (station dates);
- `ruleBreaks` (`{ kind: "long" | "night"; shift; assignee; eligibleMin }`);
- `outsideAvailability` (assigned shifts not inside the assignee's merged availability; always empty for generated drafts).

It reuses `mergeAvailability` and `stationDays`.

#### 4. Example tests

**File**: `src/lib/schedule-generator.test.ts`, `src/lib/schedule-summary.test.ts`

**Intent**: Pin the agreed rules with hand-written cases whose expected outcome comes from the rule, not from a generator run.

**Contract**: Cases:

- A and B, available all month: no uncovered shifts, no rule breaks, hours differ by at most 12h.
- **12h rule:** A can do 12h days on 5 days and B on 1 (shared). The shared day must not go to A when that would break the rule; a 6+6 split covers it instead.
- **Uncovered:** nobody available 00:00–06:00 on day 3, so that night is uncovered and the rest of the day is covered.
- **Merging:** a person with windows 18–24 and 00–06 (two rows) is eligible for 18–06.
- **Carry-over:** a M−1 window running past `M-01 06:00` makes its person eligible on day 1.
- **Touching:** a person whose only availability makes them the sole candidate for 18–06 on day 4 and for 06–18 on day 5 gets only one of them; the other is uncovered.
- **DST:** October 2026's last Sunday has 18–06 counted as 12h.
- **0 shifts:** a member with one 2h window is flagged `zeroShifts`.
- **Determinism:** the same input gives deep-equal output.
- **Summary:** an injected shift outside availability lands in `outsideAvailability`; an injected rule break lands in `ruleBreaks`.

#### 5. Property suite (test-plan Phase 4)

**File**: `src/lib/schedule-generator.property.test.ts`; `package.json` (devDependency `fast-check`)

**Intent**: Prove risk #5's guardrails over generated inputs, with oracles computed independently from the input.

**Contract**:

- Plain `fast-check` with `fc.assert(fc.property(...))` inside Vitest `it` (no adapter). A failure prints the seed and path for replay.
- **Arbitraries:**
  - month drawn from a fixed set including 2026-03, 2026-10 (DST) and 2028-02 (leap);
  - 1–10 members;
  - per member, non-overlapping windows on a 30-minute grid, 30 min to 24h long, starting in M, plus an optional carry-over from M−1's last day.
- **Properties:**
  1. Every assigned shift is inside the assignee's availability. The oracle checks every 30-minute slot of the shift against the raw windows, with no merge code.
  2. Each station day is exactly one of the 5 patterns, with no gap or overlap, and the whole month is covered by assigned or uncovered shifts.
  3. No person has two shifts on one station day or two touching shifts.
  4. Every uncovered shift has every raw-window-eligible member blocked by property 3's rules.
  5. Every 12h/night rule break found by the test's own counting appears in `summarizeSchedule(...).ruleBreaks`. No silent unfairness.
  6. With 4–10 members all available all month: no uncovered shifts, no rule breaks, and total hours spread ≤ 12h.
  7. The output is deterministic.
- Keep the suite under ~2 s locally (default `numRuns`), because the Stop hook and pre-commit run it.

#### 6. CPU proxy measurement

**File**: none committed (throwaway timing in the scratchpad)

**Intent**: Check the Free-plan budget before the endpoint ships.

**Contract**:

- Time 1,000 `generateSchedule` runs under Node on a 40-person, 31-day fixture where each person has 8–20 fragmented windows. Record the median per run in this plan's Phase 2 notes.
- Accept below 5 ms. Above that, lower the repair cap or prune patterns before Phase 3.
- If tuning cannot reach 5 ms without losing the ≤1 rules in feasible cases, stop before Phase 3 and agree with the human on the browser-side fallback (see Performance Considerations; the project stays on Workers Free). Do not ship a server-side generate that is known to exceed the budget.

### Success Criteria:

#### Automated Verification:

- fast-check installed as a devDependency: `npm ls fast-check`
- Generator, summary and helper unit tests pass: `npx vitest run src/lib/schedule-generator.test.ts src/lib/schedule-summary.test.ts src/lib/availability.test.ts`
- Property suite passes: `npx vitest run src/lib/schedule-generator.property.test.ts`
- Full unit suite, lint and type-check pass: `npm test && npm run lint && npx astro check`

#### Manual Verification:

- Breaking the generator on purpose (e.g. skip the containment check) makes the property suite fail with a printed seed. Revert afterwards.
- Median `generateSchedule` time on the 40-person fixture is below 5 ms under Node, and recorded in the plan.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Manager flow (endpoints + `/manager/schedule`)

### Overview

Wire generate and discard endpoints and the read-only draft view, following the clean manager endpoint and page patterns, with honest reads, an allow-listed feedback, a kitchen sink and gating guards.

### Changes Required:

#### 1. Schedule lib (messages, URLs, reads)

**File**: `src/lib/schedule.ts` (+ `src/lib/schedule.test.ts`)

**Intent**: Give the generate and discard endpoints and `/manager/schedule` the per-feature layout of `src/lib/manager-users.ts`: messages, an allow-list, URLs, logging and error mapping. Hold the shared reads behind an all-or-unknown state.

**Contract**:

- **Messages.** Constants for every `?error=` message:
  - invalid month;
  - not configured;
  - "Confirm replacing the current draft";
  - the load error ("Could not read the team's availability. Nothing was generated.");
  - not permitted;
  - "The month was unlocked; generate again";
  - "No draft to discard";
  - the generic write error;
  - the Phase 1 unlock message.
- **Feedback functions:**
  - `SCHEDULE_FEEDBACK_ERRORS` and `resolveScheduleFeedbackError(param)`;
  - `managerScheduleUrl({ month, error? | generated? | discarded? })` with the status param first;
  - `logScheduleError(context, error)`;
  - `describeScheduleWriteError({ code, message })`: 42501 → not permitted, 23503 → unlocked, else generic with a log.
- **Months:** `scheduleMonths()` returns the current station month plus the next 3; `generatableMonths()` returns `upcomingMonths()`.
- **Reads:** `loadScheduleInputs(supabase, month)` runs the paged reads through `loadAllPages`:
  - profiles;
  - windows with `starts_at` in `[M-01, M+1-01)`;
  - carry-overs with `starts_at < M-01` and `ends_at > M-01 06:00`.
- **State:** `buildScheduleInputs(results)` is pure and returns `ready | unknown`, like `buildTeamView`.
- **Tests** (literal fixtures, following test-plan §6.4.3): the resolver, the URL builder and `buildScheduleInputs` with each failed input and one legitimate-empty control.

#### 2. Generate endpoint

**File**: `src/pages/api/manager/schedule/generate.ts`

**Intent**: Lock, read honestly, generate and atomically replace the draft. The database decides permissions.

**Contract**: `POST` form `month`, optional `confirm=replace`. Steps:

1. The month must be in `generatableMonths()`.
2. A null client redirects with not configured.
3. Read the `schedules` row. If one exists and `confirm !== "replace"`, redirect with the confirm error.
4. Upsert the lock with `ignoreDuplicates`.
5. Run `loadScheduleInputs`. Unknown means redirect with the load error.
6. Run `generateSchedule`.
7. Call `supabase.rpc("replace_schedule_draft", { target_month, shifts })`.
8. Redirect to `managerScheduleUrl({ month, generated: true })`.

Every database error is logged raw and mapped through `describeScheduleWriteError`.

#### 3. Discard endpoint

**File**: `src/pages/api/manager/schedule/discard.ts`

**Intent**: Delete a draft so the month can be regenerated from scratch or unlocked.

**Contract**:

- `POST` form `month` (in `scheduleMonths()`).
- `delete from schedules where month = …` returning `month` (shifts cascade).
- 0 rows redirects with "No draft to discard"; success redirects with `discarded=1`.
- The lock is left in place.

#### 4. Page and components

**File**: `src/pages/manager/schedule.astro`; `src/components/schedule/{ScheduleCalendar,ScheduleDayPanel,ScheduleSummary,ScheduleActions}.astro`; reuse `src/components/availability/MonthTabs.astro`

**Intent**: A read-only view of the draft and the summary, built on design tokens like `/manager/availability`, with the generate, regenerate and discard actions next to the data they concern.

**Contract**:

- **Params:** `?month=YYYY-MM` (validated against `scheduleMonths()`), `?day=YYYY-MM-DD` (a station day of the month), `?confirm=replace`, plus feedback params.
- **Reads:** month locks, the `schedules` row, the month's shifts (paged, ordered `starts_at, id`) and `loadScheduleInputs`. If any of them is unknown, the page shows only the load error, the month tabs and the lock status, never "no draft" or empty states.
- **No draft:** an empty state. For an upcoming month, a Generate form with a note that generating locks the month's availability.
- **Draft:**
  - the generated-at time;
  - a Regenerate link to `?confirm=replace`, which renders a confirmation panel with a submit carrying `confirm=replace`;
  - a Discard form;
  - a destructive-style notice listing the days with no one assigned, if any;
  - an uncovered count;
  - the calendar: each station-day cell shows assigned/total shifts and an uncovered marker;
  - the day panel: shifts for the selected station day, as time range, length and assignee label (`accountLabel`) or an "Uncovered" marker;
  - the summary table: shifts, hours (`formatDuration`), 12h count and nights per member, a "No shifts" marker for `zeroShifts`, and the `ruleBreaks` list;
  - an `outsideAvailability` list, shown only if it is not empty.
- **Feedback:** `Alert role="status"` for generated or discarded, and the destructive `Alert` for resolved errors, next to the actions.
- **Tokens:** design tokens only (CLAUDE.md UI role map); no hydration.

#### 5. Kitchen sink, guards, navigation

**File**:

- `src/pages/dev/schedule-states.astro`
- `src/lib/route-inventory.test.ts`
- `scripts/check-ui-literals.mjs`
- `src/pages/dashboard.astro`

**Intent**: Keep the new view inside the existing gates and make it reachable.

**Contract**:

- **Kitchen sink** (404 outside dev, fixtures only, forms inert). States:
  - read unknown;
  - no draft in an open month;
  - no draft in a locked month;
  - current month (no generate);
  - fully covered draft;
  - draft with uncovered shifts and a day with no one;
  - rule breaks;
  - a zero-shift member;
  - the confirm panel;
  - success feedback;
  - each error.
- **`EXPECTED_ACCESS` rows:**
  - `/manager/schedule`: manager;
  - `/api/manager/schedule/generate`: manager;
  - `/api/manager/schedule/discard`: manager;
  - `/dev/schedule-states`: public.
- **`check:ui` scope:** the page, `src/components/schedule/` and the kitchen sink.
- **Dashboard:** a "Schedule" manager link next to the existing three.

### Success Criteria:

#### Automated Verification:

- Schedule lib tests pass: `npx vitest run src/lib/schedule.test.ts`
- Route inventory guard passes with the new rows: `npx vitest run src/lib/route-inventory.test.ts`
- No colour literals in the new views: `npm run check:ui`
- Full unit suite, lint, type-check and build pass: `npm test && npm run lint && npx astro check && npm run build`

#### Manual Verification:

- As the seeded manager, with the seeded employee's availability entered for next month, Generate shows a calendar, day panel and summary, and every listed shift falls inside that person's windows on `/manager/availability`.
- Regenerate without the confirm step is impossible, and with it replaces the draft.
- Discard empties the view. Unlock on `/manager/months` works after discarding and is refused before.
- With availability missing for one night, that shift shows as Uncovered. A day with nobody available is listed in the "no one assigned" notice.
- As the seeded employee, `/manager/schedule` renders the 403 page.
- `/dev/schedule-states` shows every state legibly.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Smoke and documentation

### Overview

Keep the generate flow and its refusals alive in the HTTP smoke, and record the new contracts in CLAUDE.md, the test plan and the roadmap handoff to S-04.

### Changes Required:

#### 1. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Satisfy test-plan §6.3 item 5 (a new data-writing endpoint is refused for employee and anonymous POSTs, with no effect) and keep the happy path working. The script must stay re-runnable.

**Contract**: Use `crudMonth` (station+3, already smoke-owned) after the existing team-view steps:

1. The fresh user's POST to `/api/manager/schedule/generate` gets the 403 page.
2. An anonymous POST is sent to sign-in.
3. The manager's `/manager/schedule?month=<crudMonth>` shows no draft (check a stable marker such as `data-schedule-draft` is absent). The month is still unlocked.
4. The manager generates: 302 to `…&generated=1`.
5. The page now has the draft marker.
6. The manager's unlock of `crudMonth` redirects with the discard-first message.
7. Discard: `discarded=1`.
8. Unlock: `updated=1`.

The header comment is updated. If a run dies between generate and unlock, recovery is to discard and unlock `crudMonth` in the UI (documented in CLAUDE.md).

#### 2. Docs

**File**: `CLAUDE.md`, `context/foundation/test-plan.md`, `context/foundation/roadmap.md`

**Intent**: Future agents and S-04 need the schedule contracts without re-reading this plan.

**Contract**:

- **CLAUDE.md:**
  - a new "Schedule" architecture section: tables, RLS, the shape/month/overlap constraints, lock FK restrict, the replace RPC, the station day and patterns, generator rules and priorities, `summarizeSchedule` as the validation reused by S-04, and the routes;
  - updated `npm run smoke` and `npm run test:db` descriptions;
  - the smoke recovery note.
- **Test plan:**
  - §3 Phase 4 status → done (delivered by S-03);
  - §4 stack row: fast-check version and the "checked" date;
  - §5 gate "property-based generator tests" → required now;
  - §6.5 cookbook: arbitraries, independent oracles, no copied output, seed replay;
  - §6.6 Phase 4 notes;
  - §8 freshness ledger entry.
- **Roadmap:** S-04 handoff notes:
  - draft model and replace semantics;
  - unlock is refused while a draft exists;
  - an update policy must be added for overrides;
  - `summarizeSchedule` gives conflict warnings, and `daysWithNoOne` blocks accept/publish;
  - the cross-month touching gap.

### Success Criteria:

#### Automated Verification:

- Smoke passes against a local server with a reset database: `npx supabase db reset && npm run build && npm run preview` then `npm run smoke`
- Smoke passes a second time without a reset (re-runnable): `npm run smoke`
- Docs formatting is clean: `npx prettier --check CLAUDE.md context/foundation/test-plan.md context/foundation/roadmap.md`
- Full gates still pass: `npm test && npm run lint && npx astro check && npm run test:db`

#### Manual Verification:

- CLAUDE.md's Schedule section lets someone unfamiliar with the change explain the station day, the 5 patterns and why unlock can be refused.
- Test-plan §6.5 is concrete enough to add a new invariant without reading this plan.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Wall-clock minute helpers (month end, DST days).
- Generator example cases pinned to the agreed rules (12h rule, merging, carry-over, touching, uncovered, DST, zero shifts, determinism).
- Summary: rule breaks, outside availability, days with no one, zero-shift flags.
- Schedule lib: feedback allow-list, URL builder, `buildScheduleInputs` ready/unknown.

### Property Tests (risk #5, test-plan Phase 4):

- These are the seven invariants in Phase 2 §5. They use independent oracles (a 30-minute slot check on raw windows, the test's own counting) and never compare to a stored generator output.

### Integration Tests:

- pgTAP `schedules.test.sql`: RLS by role, lock FK both ways, replace atomicity, shape, month and overlap constraints, profile deletion → uncovered.
- Smoke: employee and anonymous refusal with no effect; manager generate, view, refused unlock, discard and unlock.

### Manual Testing Steps:

1. Enter availability for 2–3 accounts next month (one with a gap at night) and Generate. Check uncovered shifts and the summary.
2. Compare three random shifts to `/manager/availability` windows.
3. Regenerate through the confirm panel. Discard, then unlock on `/manager/months`.
4. Open `/manager/schedule` as an employee: you should get 403.

## Performance Considerations

- The Free-plan budget is about 10 ms of CPU per request, and waiting on Supabase I/O does not count. The work is bounded by days × 5 patterns × at most 4 shifts × members, plus a capped repair pass, with an expected median below 5 ms under Node for 40 people (measured in Phase 2).
- **Staying on Workers Free is a constraint** (decided 2026-10-06). Upgrading to Workers Paid is not an option for this project.
- **CPU fallback** (not built in this change; used only if the Phase 2 measurement fails after tuning, or production shows CPU-limit errors after deploy):
  - **Browser-side generation.** `generateSchedule` is pure and has no server dependencies, so it moves unchanged into a React island on `/manager/schedule` (a justified exception to "no hydration by default"). The page passes the month's profiles and windows as props, the island generates, and the endpoint saves the result through `replace_schedule_draft`. The server can no longer trust the shifts, so the hard rules must be re-checked on write: allowed shift shapes and month (already constraints from Phase 1), one shift per person per station day, no back-to-back shifts, and each assigned shift contained in that person's availability. These checks go into the RPC or constraints, so they also serve S-04 overrides. The summary (Uncovered, 0-shift, rule breaks) is recomputed on the server with `summarizeSchedule` or on read, never stored from the client. Cost: a new island, a JSON payload of the month's availability, and write-side containment checks with their own pgTAP tests.
  - The re-checks run in Postgres and the summary is a single pass over the shifts, so the Worker's own CPU cost stays far below the generator's.
  - It is a new change (`/10x-new`), not a silent edit to this plan.
- A generate makes about 6 Supabase requests at single-station scale: schedule read, lock upsert, 3 paged reads, RPC. This is well under the subrequest limit.

## Migration Notes

- This is an additive migration with no backfill. Push to the hosted project with `npx supabase db push` once merged.
- Rollback: drop `replace_schedule_draft`, `schedule_shifts` and `schedules`. The lock FK disappears with them.

## References

- Research: `context/changes/generate-monthly-schedule/research.md`
- Roadmap S-03 decisions: `context/foundation/roadmap.md` (S-03 block, 2026-10-06)
- PRD: `context/foundation/prd.md` (US-01, FR-003/FR-004, Business Logic clarification)
- Honest reads: `src/lib/team-availability.ts:24-95`, `src/pages/manager/availability.astro:58-122`
- Clean endpoint pattern: `src/pages/api/manager/users/role.ts`, `src/lib/manager-users.ts:7-69`
- Lock endpoint: `src/pages/api/manager/months/lock.ts:34-43`
- pgTAP conventions: `supabase/tests/database/availability_month_lock.test.sql`
- Test plan: `context/foundation/test-plan.md` (risk #5/#6, Phase 4, §6.2-§6.5)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schedule data model

#### Automated

- [x] 1.1 Migration applies on a clean stack — 3f75a6e
- [x] 1.2 Types regenerated and include schedules, schedule_shifts and replace_schedule_draft — 3f75a6e
- [x] 1.3 Database rules tests pass, including the new file — 3f75a6e
- [x] 1.4 Station time zone guard still passes — 3f75a6e
- [x] 1.5 Lint, type-check and unit tests pass — 3f75a6e

#### Manual

- [x] 1.6 Unlock of a month with a draft is refused with the discard-first message — 3f75a6e

### Phase 2: Generator core (pure, property-tested)

#### Automated

- [x] 2.1 fast-check installed as a devDependency — 3411781
- [x] 2.2 Generator, summary and helper unit tests pass — 3411781
- [x] 2.3 Property suite passes — 3411781
- [x] 2.4 Full unit suite, lint and type-check pass — 3411781

#### Manual

- [x] 2.5 Deliberately broken generator fails the property suite with a printed seed — 3411781
- [x] 2.6 Median generateSchedule time on the 40-person fixture is below 5 ms and recorded — 3411781

### Phase 3: Manager flow (endpoints + /manager/schedule)

#### Automated

- [x] 3.1 Schedule lib tests pass
- [x] 3.2 Route inventory guard passes with the new rows
- [x] 3.3 No colour literals in the new views
- [x] 3.4 Full unit suite, lint, type-check and build pass

#### Manual

- [x] 3.5 Generate shows calendar, day panel and summary with every shift inside availability
- [x] 3.6 Regenerate requires the confirm step and replaces the draft
- [x] 3.7 Discard empties the view and unlock works only after discarding
- [x] 3.8 Uncovered shifts and days with no one assigned are shown
- [x] 3.9 Employee gets the 403 page on /manager/schedule
- [x] 3.10 Kitchen sink shows every state legibly

### Phase 4: Smoke and documentation

#### Automated

- [ ] 4.1 Smoke passes against a local server with a reset database
- [ ] 4.2 Smoke passes a second time without a reset
- [ ] 4.3 Docs formatting is clean
- [ ] 4.4 Full gates still pass

#### Manual

- [ ] 4.5 CLAUDE.md Schedule section explains station day, patterns and refused unlock
- [ ] 4.6 Test-plan §6.5 is concrete enough to add a new invariant
