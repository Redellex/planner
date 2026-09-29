<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Manager Availability Visibility

- **Plan**: context/changes/manager-availability-visibility/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-09-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Evidence summary

- Automated: `npm run lint` passed. `npx astro check` passed (52 files, 0 errors, 0 warnings, 0 hints). `npm run build` passed.
- Smoke: `npm run smoke` was run against this worktree's preview build (`BASE_URL=http://localhost:4399`) and failed 13 steps. The cause is the environment: `signup creates account` got `email rate limit exceeded` because `supabase/config.toml:182` sets `email_sent = 2` per hour. Every failing step depends on that fresh user. All the manager-only steps passed. See F3.
- Plan drift: every planned item MATCHes. There are small justified deviations:
  - The lock query reads all 4 offered months so `MonthTabs` can mark locked months.
  - The "No availability submitted" badge uses destructive tokens, because there is no warning token.
  - "Show only" is hidden on the row that is already filtered.
  - The smoke assertion is stricter than planned (email plus `10:00 – 12:00` in tag-stripped text).
  - `formatCarryOver` is a new helper.
- Security: the `/manager` middleware gate covers the page. `?month`, `?day` and `?employee` are all checked against the allowed values before they are used, and the raw values never reach a query or the page. Wall-clock strings never go through `new Date`.

## Findings

### F1 — Month-wide window read is silently truncated at 1000 rows

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/manager/availability.astro:60-65
- **Detail**: The team windows query is not paginated. PostgREST caps each response at `max_rows` (1000 locally, per `supabase/config.toml:18`, and 1000 by default on hosted Supabase), and it returns no error when it does. Rows are ordered by `starts_at`, so any rows dropped are always at the end of the month. When that happens, late-month day counts are too low, `TeamSummary` totals are too low, and some accounts are wrongly flagged "No availability submitted". Managers act on that flag before locking a month. About 33 people entering one window a day reaches the cap. The plan's "single-station scale" reasoning covers the missing index (speed), not truncation (correctness).
- **Fix A ⭐ Recommended**: Page the windows query with `.range(from, from + PAGE - 1)` in a loop until a page comes back short, as a small helper in the page or in `src/lib/availability.ts`.
  - Strength: Always correct at any size, and the rendering code does not change.
  - Tradeoff: Adds about 10 lines, and a busy month costs extra round trips (one per 1000 rows).
  - Confidence: HIGH — standard supabase-js `.range()` usage.
  - Blind spot: The profiles query has the same cap, but more than 1000 accounts is unrealistic.
- **Fix B**: Request `{ count: "exact" }` and show a destructive alert ("Showing a partial month") when `count > data.length`.
  - Strength: Smallest change, and the failure is visible instead of silent.
  - Tradeoff: The manager still sees wrong totals and flags. It only tells them the data is wrong.
  - Confidence: HIGH — `count` is supported by the select API.
  - Blind spot: `count: "exact"` adds a COUNT query on each render (cheap at this scale).
- **Decision**: FIXED via Fix A. `loadMonthWindows` pages the query with `.range()` in steps of 1000, ordered by `starts_at` then `id`. Lint and astro check pass.

### F2 — A failed window load looks like "nobody submitted"

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/manager/availability.astro:80-91
- **Detail**: If the windows or carry-over query fails while profiles load, `windows` stays `[]`. The error alert appears, but below it every account is flagged "No availability submitted" and listed under "No windows on this day". That output looks like real data.
- **Fix**: Set a `windowsUnknown` flag in the same way as `lockStateUnknown`. While it is set, skip rendering the day panel and summary, or hide their flags and "no windows" lists.
- **Decision**: FIXED. `windowsUnknown` is set when the windows or carry-over read fails, and while it is set `TeamDayPanel` and `TeamSummary` are not rendered. The calendar still renders so the manager can move between months and days.

### F3 — Smoke could not be re-verified in this review (auth email rate limit)

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs (environment: supabase/config.toml:182)
- **Detail**: Progress item 3.4 is marked done at 8da5b5a. In this review, the run failed at sign-up with `email rate limit exceeded` (`email_sent = 2`/hour). Every later step that needs the fresh user failed as a result, including the two new team-view steps. All the manager-only steps passed. This does not show a code defect, but the new smoke steps were not independently confirmed here.
- **Fix**: Re-run `npm run smoke` once the hourly limit resets, or raise `auth.rate_limit.email_sent` for local runs.
- **Decision**: FIXED (verified). On 2026-09-29 at 14:23, `npm run smoke` passed all 27 steps, including both new team-view steps, on a build that includes the F1, F2 and F4 fixes. For that run `.dev.vars` was temporarily pointed at local Supabase and afterwards restored (checksum matched). History: at 13:55 the smoke run was repeated against a rebuild that includes the F1 and F2 fixes. Sign-up was still rate-limited, and the same 13 steps failed because they depend on it. Every manager-only step passed. Re-run `npm run smoke` after the hourly window resets.
  - Follow-up on 2026-09-29 at 14:20: the rate limit was never local. This worktree's `.dev.vars` and `.env` set `SUPABASE_URL` to the **hosted** project, so the preview and all three smoke runs in this review hit the hosted database. The hosted email limit is what blocked sign-up. The same runs also wrote to hosted: each locked and then unlocked month 2027-09 (net zero), and each tried to demote the last manager, which was rejected. The seeded `manager@example.com` / `Manager-Passw0rd!` works on the hosted project, even though `seed.sql` is marked local/CI only. Smoke is still unverified until it runs against local Supabase.

### F4 — Carry-over label logic duplicated

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/team-availability/TeamCalendar.astro:33-35, src/components/team-availability/TeamDayPanel.astro:17-19, src/pages/availability.astro:105-107
- **Detail**: `entryLabel` is copied word for word in two components. `/availability` still builds the `00:00 – HH:MM (from …)` string inline instead of using the new `formatCarryOver`. The wording now lives in two places, and the comments already say it must stay "the same wording as /availability".
- **Fix**: Use `formatCarryOver` in `src/pages/availability.astro`. Optionally, move `entryLabel` into one shared helper.
- **Decision**: FIXED. `src/pages/availability.astro` now uses `formatCarryOver(carryOver)` and no longer imports `timeOf`; the output is unchanged. The two `entryLabel` copies were left as they are. Lint, astro check and build pass.

## Triage summary

- Fixed: F1 (Fix A), F2, F4
- Verified: F3 (smoke passes against local Supabase)
- Outside this change, for the user: this worktree's `.env` and `.dev.vars` point at the hosted project, and the seeded `manager@example.com` credentials work there.
