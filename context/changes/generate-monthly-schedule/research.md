---
date: 2026-10-06T11:43:44+02:00
researcher: Redellex (with Claude Code)
git_commit: b0547cfca6dff831bc45911b0cee75f5a5b9d4c4
branch: generate-monthly-schedule
repository: Redellex/planner
topic: "S-03 generate-monthly-schedule: what the generator must integrate with, what is settled, what is still open"
tags: [research, codebase, schedule-generator, availability, supabase, rls, cloudflare-workers, test-plan]
status: complete
last_updated: 2026-10-06
last_updated_by: Redellex (with Claude Code)
---

# Research: S-03 Generate monthly schedule

**Date**: 2026-10-06T11:43:44+02:00
**Researcher**: Redellex (with Claude Code)
**Git Commit**: b0547cfca6dff831bc45911b0cee75f5a5b9d4c4
**Branch**: generate-monthly-schedule
**Repository**: Redellex/planner

## Research Question

Roadmap slice S-03 (`context/foundation/roadmap.md:107-125`, GitHub #4): "Manager generates a proposed monthly schedule that assigns every 6–12h shift to an employee, respecting each employee's stated availability and rotating who takes long shifts fairly, with zero conflicting assignments."

This research establishes:
- what the existing data layer, read paths, route gating, UI conventions and test gates give a generator,
- which decisions earlier changes already made for S-03,
- which runtime limits apply,
- which product questions are still open before `/10x-plan`.

## Summary

- **Nothing schedule-related exists yet.** The database has three domain tables: `profiles`, `availability_windows` and `availability_locks` (migrations `20260925120000`, `20260926130000`). `src/` has no schedule, shift or assignment code; the only hits are UI copy saying "Locking a month starts scheduling" (`src/pages/manager/months.astro:42`). S-03 therefore adds:
  - the first schedule migration (tables, RLS, regenerated types),
  - a pure generator module,
  - a manager page and endpoint.
- **The rules are settled; what a "shift" is, is not.** These are settled:
  - fairness is per month, with total hours as even as availability allows and 12h-shift counts differing by at most 1 among eligible employees (`roadmap.md:116`, `prd.md:102`);
  - an uncovered shift is left unassigned and flagged, never assigned outside availability (`roadmap.md:117`, `prd.md:103`);
  - one employee per shift (`prd.md:98`, Non-Goal at `prd.md:116`);
  - lengths of 6–12h, with "long" meaning 12h (`prd.md:59`).

  No document defines **which shifts must exist** in a month. There are no station hours, no 24/7 statement, no shift templates and no coverage target; a grep of `shape-notes.md`, `prd.md` and `roadmap.md` for these found nothing. "Every shift is covered or flagged" has no defined set of shifts until this is decided. This is the blocking product question for `/10x-plan`.
- **Availability is a containment test over wall-clock strings.**
  - A window is a `timestamp without time zone` pair holding Europe/Warsaw wall-clock time, more than 0 and at most 24h, with no overlaps per employee (half-open ranges) (`supabase/migrations/20260926130000_create_availability.sql:17-31`).
  - S-01 chose this shape so S-03 can check a 6–12h shift, night shifts included, "with one containment test" (`context/archive/2026-09-26-employee-availability-management/plan-brief.md:22`).
  - All math must stay on strings and calendar parts, never `new Date(...)` (`src/lib/availability.ts:1-6`).
  - Back-to-back windows (…–07:00, 07:00–…) are separate rows, so containment over the union of adjacent windows is a design choice the plan must make (inference from the half-open exclusion constraint at `20260926130000_create_availability.sql:25-27`).
- **The read path exists and the test plan requires it.**
  - `loadAllPages` (`src/lib/team-availability.ts:24-56`) pages count-driven reads and returns `{data: null}` on any error, truncation or shifting count.
  - `/manager/availability` already holds the three query shapes a generator needs: profiles, the month's windows, and carry-over windows from the previous month (`src/pages/manager/availability.astro:65-99`).
  - Test plan §6.4 requires any list that feeds a "none" conclusion to go through `loadAllPages` with a ready/unknown state (`context/foundation/test-plan.md:173-176`). Risk #6 names the generator explicitly.
- **Generating locks the month.** S-01 decided "S-03 inserts into `availability_locks` itself" and accepted the lock race because "S-03 reads availability after locking" (`context/archive/2026-09-26-employee-availability-management/plan.md:46,74`; `CLAUDE.md` Availability section). The existing lock write is an idempotent upsert (`src/pages/api/manager/months/lock.ts:34-39`). Still open from S-01: what an unlock does to an existing draft (`plan-brief.md:71`).
- **Runtime risk: Workers Free CPU.**
  - The project assumes the Cloudflare Workers Free tier (`context/foundation/infrastructure.md:17`).
  - That doc flags "10ms/request on the free tier" as a ceiling for "the shift-scheduling algorithm" and says it must be measured, not assumed (`infrastructure.md:63,94`).
  - Production is not live (`roadmap.md:60`), so nothing has been measured.
  - No background mechanism is configured: `wrangler.jsonc` has only `ASSETS`, and `tech-stack.md:19` has `has_background_jobs: false`. A synchronous generate inside the request is the only path today.
- **Test gates waiting on S-03:**
  - Test-plan Phase 4, "Generator invariants (with S-03)" (`test-plan.md:75,77`), is property-based with fast-check. fast-check is not installed (no `fast-check` entry in `package.json`).
  - The quality gate "property-based generator tests" becomes required after Phase 4 (`test-plan.md:115`).
  - Copying a generator output as the expected value is the named anti-pattern (`test-plan.md:61`).

## Detailed Findings

### Data layer (what a schedule migration integrates with)

- **`availability_windows`** (`supabase/migrations/20260926130000_create_availability.sql:17-31`):
  - `employee_id uuid not null default auth.uid() references public.profiles(id) on delete cascade` (:19)
  - `starts_at`/`ends_at timestamp not null` (:20-21)
  - check `ends_at > starts_at and ends_at - starts_at <= interval '24 hours'` (:23-24)
  - exclusion `availability_windows_no_overlap` on `(employee_id with =, tsrange(starts_at, ends_at) with &&)` (:25-27)
  - A window belongs to the month of its `starts_at` (table comment, :30-31).
- **Window RLS:**
  - Employees read their own rows; managers read all (:79-124).
  - Writes are own-row only, and only when both the `starts_at` month and the `ends_at - 1µs` month are editable (`20260926140000_harden_availability_writes.sql:6-34`).
  - Managers have no write policies on windows (`20260926130000_…:126`).
- **`availability_locks(month date pk, locked_at timestamptz)`**:
  - A check requires the first day of a month (`20260926130000_…:8-12`).
  - Any authenticated user can select; only `is_manager()` can insert or delete; nobody can update (:55-76).
- **`public.is_availability_month_editable(target_month)`** (:36-49) is true when the month is after the current Europe/Warsaw month and has no lock row.
- **`public.is_manager()`** (`20260925120000_create_profiles_and_roles.sql:43-59`) is SECURITY DEFINER and is the helper CLAUDE.md requires in manager policies.
- **`profiles`:** employees read only their own row; managers read all rows (`20260925120000_…:62-81`). A manager-only generator can therefore read every profile. S-05's employee-facing grid will need the narrow coworker read path that F-01 deferred (`context/archive/2026-09-25-role-aware-access-control/plan.md:45`).
- **No `starts_at` index.** S-02 decided none is needed at single-station scale and said to revisit if the generator's reads are slow (`roadmap.md:104`).
- **`supabase/config.toml`:** `[api] max_rows = 1000` (:18); Postgres `major_version = 17` (:36).
- **Seed** (`supabase/seed.sql:7-33`): one manager (`…0001`) and one employee (`…0002`), with no windows or locks. Generator smoke steps must create their own availability, as the existing smoke steps do.
- **Types:** `src/db/database.types.ts` holds the three tables plus the `is_availability_month_editable` and `is_manager` functions (:37-117). A new migration requires regeneration (CLAUDE.md, Key conventions).

### Reading all availability for a month

- **`loadAllPages<T>(fetchPage, pageSize)`** (`src/lib/team-availability.ts:24-56`):
  - Advances by the rows actually received (:28).
  - Stops at `rows.length >= count` (:49).
  - Returns `{data: null, error}` in these cases: a thrown request (:32-35), a PostgREST error (:37-39), null data or count (:40-42), a count that changes between pages (:43-46), or an empty page before the count is reached (:52-54).
  - Tested with a fake fetcher (`src/lib/team-availability.test.ts`).
- **Query shapes** (`src/pages/manager/availability.astro:58-99`, `TEAM_PAGE_SIZE = 1000`):
  - profiles ordered by email, then id (:66-75);
  - month windows by `gte/lt starts_at`, ordered by `starts_at, id`, with no `employee_id` filter (:77-88);
  - carry-overs with `starts_at < monthStart` and `ends_at > monthStart` (:89-99).

  These shapes live in the page, not in `src/lib`. Extracting them for the generator is an option, not a decision (`context/archive/2026-10-03-testing-route-gating-honest-reads/research.md:189`).
- **`buildTeamView`** (`src/lib/team-availability.ts:78-95`) is view-specific. Its "any list null → unknown" rule is the pattern a generator-input builder would copy.
- **Carry-overs:** a window starting on the last day of the previous month can cover 00:00–xx on day 1. Whether the generator uses that slice is open. The S-01 impl review noted "S-03 still has to decide which month owns 00:00–07:00 on day 1" (`context/archive/2026-09-26-employee-availability-management/reviews/impl-review.md:45`).

### Wall-clock helpers available to a generator

- **Exported from `src/lib/availability.ts`:**
  - `STATION_TIME_ZONE` (:10), `currentStationMonth()` (:52-61), `addMonths` (:64), `upcomingMonths(count=3)` (:70), `teamAvailabilityMonths()` (:76)
  - `parseMonth` (:80), `parseDate` (:85), `parseTime` (:93)
  - `monthStart` (:103), `buildWindow` (:111-114), `daysInMonth` (:124), `dateOf`/`timeOf` (:191-196)
  - `windowMinutes` (:179-181, wall-clock, no DST correction), `formatDuration` (:184)
- **Gap:** the wall-clock-to-milliseconds converter `timestampToUtcMs` (:173-176) is private. No exported helper adds N hours to a wall-clock timestamp or compares two timestamps. Building 6–12h shift bounds needs a new exported helper, or those private ones exported.
- **Durations** are wall-clock differences. On a DST day, 00:00–00:00 counts as 24h (CLAUDE.md Availability; S-01 review F6 at `reviews/impl-review.md:93-101`). The 12h shift and the hour totals inherit this.

### Manager page and endpoint patterns

- **Clean page with feedback** (`src/pages/manager/users.astro:20-21,65-68`):
  - `resolve…FeedbackError(searchParams.get("error"))`
  - `saved = updated === "1" && !feedbackError`
  - a status `Alert role="status"`
- **Clean read-only page** (`src/pages/manager/availability.astro:38-41,60-63,103-122,182-187,203`):
  - validates URL params against the offered set,
  - handles a null client with `SUPABASE_NOT_CONFIGURED_ERROR`,
  - logs raw errors and shows only an allow-listed message,
  - renders data only when the view is known.
- **Clean manager endpoint** (`src/pages/api/manager/users/role.ts:19-39`):
  - validate, then redirect through a URL builder with allow-listed messages,
  - map DB errors through `describe…WriteError`.

  Its constants, allow-list, logger and URL builder live in a per-feature lib (`src/lib/manager-users.ts:7-69`). This is the layout a `src/lib/schedule*.ts` would copy.
- **Do not copy:**
  - `src/pages/api/manager/months/lock.ts:42` redirects with the raw `error.message`.
  - `src/pages/manager/months.astro` is legacy `bg-cosmic` markup that renders raw `?error=` text (CLAUDE.md, UI, Legacy).
- **Batch writes:** a single `.insert(array)` rejects the whole batch when any row fails RLS or a constraint (`src/pages/api/availability/create.ts:40`).
- **RPC:** no `.rpc(` call exists anywhere in `src/`. Typed RPC would become available if a SQL function is added.

### Route gating, smoke and UI scope

- **Gating:** `MANAGER_ROUTES = ["/manager", "/api/manager"]`, matched on segment boundaries (`src/lib/route-access.ts:6,11-13`). Any `/manager/schedule…` page or `/api/manager/schedule/…` endpoint is gated automatically: anonymous users go to sign-in, non-managers get 403 (`src/middleware.ts:29-34`).
- **Route inventory:** each new file under `src/pages` needs a row in `EXPECTED_ACCESS` (`src/lib/route-inventory.test.ts:15-37`); a missing row fails at :76-78. A dev kitchen sink needs a `"public"` row.
- **Smoke:**
  - Steps are `[name, () => request(...), {status, location?, check?}]` tuples (`scripts/smoke.mjs:111-263`).
  - Test plan §6.3 item 5 requires a smoke step for any new data-writing endpoint where an employee or anonymous POST gets 403 or sign-in and has no effect (`test-plan.md:166`).
  - Months already in use: station+12 (lock/unlock) and station+3 (CRUD, plus the leftover window on day 2) (`scripts/smoke.mjs:40-45`). Generation locks its month, so a generate step must pick a month and an unlock/cleanup so the script can re-run, as the lock steps do.
- **UI:**
  - Kitchen sinks: `src/pages/dev/availability-states.astro` and `src/pages/dev/manager-users-states.astro`; each 404s outside dev.
  - `check:ui` scope list: `scripts/check-ui-literals.mjs:17-24`. A new clean view gets added there.
  - Reusable components: `src/components/availability/MonthTabs.astro` (months, current, lockedMonths, hrefFor) and the team calendar components in `src/components/team-availability/`.

### Runtime constraints (Cloudflare Workers)

- **Plan:** Free tier, as stated in `infrastructure.md:17` and `context/changes/deployment/deployment-plan.md:24`.
- **CPU:** the only CPU figure in the project docs is "10ms/request on the free tier", named as a ceiling for the scheduling algorithm (`infrastructure.md:63`). The risk register says to re-estimate once the algorithm exists, because the NFR "could exceed free-tier CPU-ms per invocation" (`infrastructure.md:94`).
- **Subrequests:** no project doc states the limit. From general knowledge, not verified for this research: Free has historically allowed 50 subrequests per invocation and Paid 1000, and every Supabase call counts. A generate request that pages reads (about 4 calls at this scale), upserts the lock and inserts a draft stays well under 50. This is an inference.
- **Bindings:** `wrangler.jsonc:1-15` has only `ASSETS`: no Durable Objects, Queues, cron or KV. `astro.config.mjs:16-17` uses `cloudflare({ imageService: "passthrough" })` with `session: false`.
- **Inference, not measured:** for one station (tens of employees, about 30 days, a few shifts per day), a greedy assignment with balancing passes is likely well under 10 ms of CPU. A search-based solver, such as backtracking or local search with many iterations, may not be. The plan should either bound the algorithm's work or include a measurement step. Waiting on Supabase I/O does not consume CPU time (`infrastructure.md:72`).
- **NFR:** "within a few seconds… with continuous visible progress if it takes longer" (`prd.md:91`). There is no progress design anywhere. A synchronous form POST shows no progress, which meets the NFR only if generation is fast.

### Testing expectations already set for S-03

- **Risk #5** (`test-plan.md:48`) is High impact and High likelihood "once S-03 lands". Its response (`test-plan.md:61`) asks for invariants over generated inputs:
  - every assignment falls inside that employee's availability,
  - every shift has exactly one employee or is explicitly reported as uncovered,
  - long shifts do not repeatedly land on one person by the agreed fairness metric.

  The cheapest layer is a property-based unit test. The anti-pattern is an expected schedule copied from the generator's output.
- **Phase 4** (`test-plan.md:75,77`) is "not started" and gated only on S-03 having a plan.
- **Stack row** (`test-plan.md:90`): fast-check with Vitest, "none yet", for generator invariants only.
- **Quality gate** (`test-plan.md:115`): property-based generator tests, local and CI, required after Phase 4.
- **§6.5** "Adding an invariant test for the schedule generator" is "TBD" (`test-plan.md:178-180`). S-03 (or Phase 4) fills it.
- **Risk #3** (`test-plan.md:46`) cites "generation will set the lock". Risk #6 requires honest reads, so the generator must not treat a truncated read as "no availability".
- **pgTAP** for new tables follows §6.2 item 1: one file per risk or per table (`test-plan.md:142`), with conventions from `supabase/tests/database/*.test.sql`:
  - `begin; select plan(N); … finish(); rollback;`
  - inline `set local role authenticated; set local request.jwt.claims = …` to act as a user
  - `\gset` station months
- **Stryker** is manual and opt-in per module via `--mutate` (`stryker.config.json`; CLAUDE.md, Commands).

## Code References

- `supabase/migrations/20260926130000_create_availability.sql:8-12` – `availability_locks` table
- `supabase/migrations/20260926130000_create_availability.sql:17-31` – `availability_windows` shape, checks, exclusion constraint, cascade FK
- `supabase/migrations/20260926130000_create_availability.sql:36-49` – `is_availability_month_editable`
- `supabase/migrations/20260926140000_harden_availability_writes.sql:6-39` – both-months write rule, column grants
- `supabase/migrations/20260925120000_create_profiles_and_roles.sql:43-59` – `is_manager()`
- `src/lib/team-availability.ts:24-56` – `loadAllPages`
- `src/lib/team-availability.ts:78-95` – `buildTeamView` (all-or-unknown)
- `src/pages/manager/availability.astro:58-99` – the profiles, month-window and carry-over queries
- `src/lib/availability.ts:1-6,173-181` – wall-clock rule, private ms converter, `windowMinutes`
- `src/pages/api/manager/months/lock.ts:34-39` – idempotent lock upsert/delete
- `src/pages/api/manager/users/role.ts:19-39` + `src/lib/manager-users.ts:7-69` – clean endpoint + per-feature lib pattern
- `src/lib/route-access.ts:6` – `MANAGER_ROUTES`
- `src/lib/route-inventory.test.ts:15-37` – `EXPECTED_ACCESS`
- `scripts/smoke.mjs:40-45,111-263` – smoke months and steps
- `scripts/check-ui-literals.mjs:17-24` – UI literal scope
- `context/foundation/test-plan.md:48,61,75,90,115,178-180` – risk #5, Phase 4, the property-based gate, §6.5
- `context/foundation/infrastructure.md:17,63,72,94` – Free tier, 10 ms CPU ceiling, measurement risk

## Architecture Insights

- **Containment is the core check.** Wall-clock strings with half-open ranges let "shift ⊆ some availability window of employee E" be a string or calendar comparison. Two decisions are needed:
  - whether adjacent windows (…–07:00 + 07:00–…) merge for containment,
  - whether day-1 carry-over hours count.
- **Pure core, thin shell.** The codebase separates pure helpers in `src/lib/*.ts` (unit-tested under UTC) from Astro pages and endpoints that do I/O and let RLS decide. A pure `generateSchedule(input) → {assignments, uncovered}` fits this split and is what property tests in test-plan Phase 4 need.
- **Fail closed on reads.** The generator's input must be "ready" (every list read in full) or the request must stop with an allow-listed load error. It must not generate from a partial team.
- **Database as enforcement.** Earlier slices put the hard guarantees in Postgres, using RLS, check constraints and exclusion constraints. These schedule invariants are candidates for the same treatment:
  - manager-only writes via `is_manager()`;
  - one assignee per shift, as a column on a shift row;
  - no overlapping shifts for one employee, via an exclusion constraint like `availability_windows_no_overlap`.

  Whether "inside availability" is also enforced in SQL or only in the generator (with S-04 overrides allowed to break it, with a warning) is a design choice. FR-004/FR-005 let a manager override outside availability, so a hard DB constraint on containment would block S-04's override path (inference from `prd.md:73,75`).
- **Lock first, then read.** The S-01 decision (`plan.md:74`) orders the generate flow as: upsert the lock, then page the reads, then generate, then persist. Because the lock upsert is idempotent, a re-generate on an already-locked month is safe at the lock step.

## Historical Context (from prior changes)

- `context/archive/2026-09-26-employee-availability-management/plan-brief.md`:
  - :22 – the window shape was chosen so S-03 checks 6–12h shifts, night shifts included, with one containment test. **Supported** by the current schema.
  - :24, :30 – S-03 inserts the same `availability_locks` row. **Supported**: the table and policies are unchanged.
  - :27 – S-03 shifts use the same `timestamp` type. A decision for S-03 to honour.
  - :71 – what unlock does to a draft. **Still open.**
- `context/archive/2026-09-26-employee-availability-management/plan.md:46,74` – no auto-lock in S-01; S-03 locks, then reads. **Supported.**
- `context/archive/2026-09-26-employee-availability-management/reviews/impl-review.md`:
  - :45 – day-1 spill ownership. **Still open.**
  - :93-101 – hours are wall-clock. **Supported** (`windowMinutes`).
  - :103-111 – cascade delete and the missing index were moved to the roadmap.
- `context/archive/2026-09-29-manager-availability-visibility/` – paging fix for the 1000-row cap (`reviews/impl-review.md:36-53`); no `starts_at` index (`plan.md:39`). **Supported** (`loadAllPages`, `config.toml:18`).
- `context/archive/2026-10-03-testing-route-gating-honest-reads/research.md:189` – the roadmap asks the generator to page reads but does not mandate reusing `loadAllPages`. Test plan §6.4 now effectively does. **Supported.**
- `context/archive/2026-09-25-role-aware-access-control/plan.md:45` – the coworker read path is deferred to S-05. Not needed for the manager-only S-03.
- `context/foundation/roadmap.md:120` – the cascade delete on `availability_windows.employee_id` should be revisited "once schedules are persisted". The same question applies to an assignee FK on any new schedule table.

## Related Research

- `context/archive/2026-09-26-employee-availability-management/research.md` – availability shape; "Shifts are 6–12h, one employee per shift — Settled" (:83)
- `context/archive/2026-10-03-testing-route-gating-honest-reads/research.md` – honest reads and route gating

## Open Questions

Product decisions for the user. 1 blocks planning; the others are design choices `/10x-plan` can propose defaults for.

1. **What shifts must exist in a month? (blocking)** Nothing in `shape-notes.md`, `prd.md` or `roadmap.md` defines station hours, 24/7 operation, shift templates or a per-day coverage target. Candidate models:
   - **(a) Fixed templates** for the station, e.g. 06–18 / 18–06 (12h) or 06–14 / 14–22 / 22–06 (8h), and the generator fills them.
   - **(b) Station opening hours** per day; the generator splits each day into 6–12h shifts.
   - **(c) Shifts carved from availability**, with no coverage target. This conflicts with "every shift is covered or flagged", because there would be no fixed set of shifts to flag.

   This choice also decides what "long (12h) shift" and "a day with no one assigned" (`prd.md:103`) mean in practice.
2. **Draft lifecycle:**
   - Is the draft persisted (new tables, needed by S-04 overrides) or computed per view?
   - Does re-generating replace an existing draft?
   - What does a month unlock do to an existing draft (`plan-brief.md:71`)?
3. **Containment details:**
   - Do adjacent windows merge?
   - Does a carry-over window from the previous month make its employee available on day 1 (`reviews/impl-review.md:45`)?
4. **Minimum shifts per employee:** "Everyone should have at least few shifts" (`prd.md:36`) is unquantified and is not an acceptance criterion. Decide whether it is a goal implied by the even-hours balancing or a separate constraint.
5. **Who is schedulable:** availability is submitted by any signed-in user, managers included (`plan-brief.md:25`). The generator presumably schedules every profile with windows, managers included. Confirm.
6. **Persistence FK:** should an assignee FK on new schedule tables use `on delete cascade` or `restrict` (`roadmap.md:120`)?
7. **Runtime:** measure the generator's CPU time against the Workers Free 10 ms figure (`infrastructure.md:63,94`), or bound the algorithm's work. Decide whether the NFR's "visible progress" needs anything beyond a fast synchronous POST.
8. **Test tooling:** add `fast-check` as a devDependency and write test-plan §6.5 (Phase 4) alongside or after S-03 (`test-plan.md:75,90,178-180`).
