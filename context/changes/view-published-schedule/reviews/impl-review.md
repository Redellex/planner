<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: View Published Schedule

- **Plan**: context/changes/view-published-schedule/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-07
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Notes:

- **Plan Adherence.** Every planned item matches. pgTAP has `plan(118)` in `schedules.test.sql` (+20 asserts) and `plan(36)` in `profiles_roles.test.sql` (+15 asserts). The SQL name rule matches `calendarName` exactly, with cross-reference comments in both places.
- **Scope Discipline.** There are three unplanned files, and each is justified:
  - `AccountPanel.astro` and `PublishedScheduleView.astro` were extracted so that the page and its kitchen sink render the same component.
  - The `manager-users.ts` change is only a comment, which the plan's Critical Implementation Details require.
- **Automated checks re-run on 2026-10-07, all passing:**
  - `npm run lint`: 0 errors.
  - `npm test`: 327 tests.
  - `npm run check:ui`: clean.
  - `npx astro check`: 0 errors.
  - `npm run build`: complete.
  - `npm run test:db`: 232 tests.
- **Not re-run:** `npm run smoke`, because `.dev.vars` points at the hosted project. The plan records it as passing in 10479e8.

## Findings

### F1 — `set_display_name` stores blank or invisible names through a direct RPC call

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261007140000_published_schedule_and_display_names.sql:10,23
- **Detail**:
  - Postgres `btrim(x)` strips only ASCII spaces. Verified locally: `length(btrim(E'\tAnn')) = 4` and `length(btrim(E'　Ann')) = 4`.
  - JS `.trim()` in `src/lib/account.ts:28` strips all Unicode whitespace, so the app path is safe.
  - But any signed-in user can call `/rest/v1/rpc/set_display_name` with their own JWT. That way they can store a name such as `E'　'` (shows blank), `E'\tAnn'`, or names containing zero-width or right-to-left override characters.
  - Both the check constraint (`display_name = btrim(display_name)`) and the function accept these. Colleagues then see a blank or spoofed name on that user's published shifts. `buildPublishedSchedule` treats such a name as valid, because it is non-null.
  - This contradicts CLAUDE.md's "no surrounding spaces" rule, and pgTAP does not cover it.
- **Fix A ⭐ Recommended**: Add a migration that normalises with a whitespace class and refuses control and format characters, then add pgTAP cases.
  - Approach: in `set_display_name`, normalise with `regexp_replace(new_name, '^[[:space:] 　​﻿]+|[...]+$', '', 'g')`. Raise a mapped error (e.g. 22023) when the name matches `[[:cntrl:]​-‏‪-‮⁦-⁩]`. Tighten the constraint the same way.
  - Add the same refusal to `parseDisplayName`. Add pgTAP cases for `E'　'`, `E'\tAnn'` and `E'A‮B'`.
  - Strength: The database stays the enforcement layer, as for every other rule in this project. The SQL rule and the JS rule then agree.
  - Tradeoff: A new migration plus a new error code and message in the `account.ts` allow-list. Existing rows need a check before the constraint is tightened. Locally there are none.
  - Confidence: MED — the regexp classes need care, and Postgres `[[:space:]]` depends on the locale.
  - Blind spot: Hosted data has not been checked for names that would violate a tighter constraint.
- **Fix B**: Accept the risk and record it in CLAUDE.md and the backlog.
  - Strength: No new code. Only an authenticated user can do this, to their own name, and Astro escapes the output.
  - Tradeoff: The "trimmed, 1–40 characters" rule is only half enforced at the database, and a colleague can show up blank on the grid.
  - Confidence: HIGH — there is no privilege escalation and no XSS path.
  - Blind spot: How much spoofing matters for a single-station team.
- **Decision**: FIXED (Fix A). The changes:
  - New migration `20261007150000_display_name_visible_characters.sql`. It trims the `String.prototype.trim` whitespace set and refuses control, zero-width and bidi-control characters with 22023, in both `set_display_name` and `profiles_display_name_shape`. It also cleans up existing rows.
  - `DISPLAY_NAME_FORBIDDEN` and `DISPLAY_NAME_CHARACTERS_ERROR` in `src/lib/account.ts` (allow-listed, mapped from 22023), with 4 new unit tests.
  - 10 new pgTAP asserts in `profiles_roles.test.sql`, which now has `plan(46)`.
  - An "Invisible characters" kitchen-sink state, and CLAUDE.md updates.

### F2 — Smoke "/schedule renders" also passes when the load fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs:197
- **Detail**:
  - The step "published schedule page renders for signed-in user" asserts only `status: 200`.
  - `/schedule` also returns 200 when the RPC fails and the page shows `PUBLISHED_SCHEDULE_LOAD_ERROR`, for example when the migration is missing on the target database.
  - The only content check (line 398) is gated on `scheduleMonthClean`, so on a skipped run nothing proves that a `/schedule` read worked.
- **Fix**: Add a `check` to the step at line 197 that the page text does not include the load-error message (mirror it like `notPublishedMessage`).
- **Decision**: FIXED. Added `publishedScheduleLoadError`, mirrored from `PUBLISHED_SCHEDULE_LOAD_ERROR`, and a `check` on the "/schedule renders" step that its page text does not contain it. Not run against a server: `.dev.vars` points at the hosted project.

### F3 — Name length is counted in UTF-16 units in JS but in code points in SQL

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/account.ts:29
- **Detail**:
  - `name.length` and the field's `maxlength` count UTF-16 code units; `char_length` counts code points.
  - A name of 21–40 emoji is refused with "Use at most 40 characters" even though the database would accept it.
  - The mismatch is only stricter, and no path produces an unmapped database error.
- **Fix**: Count `[...name].length` in `parseDisplayName`, or leave it and note that the app limit is stricter.
- **Decision**: FIXED. `parseDisplayName` now counts code points (`[...name].length`), with a unit test: 40 emoji are accepted, 41 refused. The field's `maxlength` still counts UTF-16 units in the browser, so typing more than 20 emoji there is still cut early. The plan's manual check depends on that `maxlength`, so it stays.

### F4 — `get_published_schedule` gives every colleague's profile UUID to every signed-in user

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261007140000_published_schedule_and_display_names.sql:67
- **Detail**:
  - The plan specified `employee_id` in the result, so this is not drift.
  - The app only uses it to mark the viewer's own shifts as "You", in `ownEmployeeId` matching.
  - UUIDs grant nothing under RLS, so the risk is low, but an `is_own` flag would disclose less.
- **Fix**: Replace `employee_id` with `is_own boolean` (`sh.employee_id = auth.uid()`) and an `is_uncovered` flag or `employee_id is null`.
  - Strength: The result discloses as little as possible, in line with the "never reaches employees" intent.
  - Tradeoff: This changes the six-column contract. It touches the pgTAP column-set assert, `PublishedScheduleRow`/`PublishedShift`, `ScheduleCalendar`'s `labels` keying and the kitchen sink. That is a larger edit for a low-risk leak.
  - Confidence: MED — `ScheduleCalendar` keys labels by employee id, so it would need a synthetic key per name.
  - Blind spot: Whether any later slice (FR-008 export, FR-009 notifications) expects ids on this read.
- **Decision**: FIXED. The changes:
  - New migration `20261007160000_published_schedule_is_own.sql` drops and recreates `get_published_schedule` with `id, starts_at, ends_at, assignee_name, is_own, published_at`. The types were regenerated.
  - `PublishedScheduleRow`/`PublishedShift` carry `is_own` in place of `employee_id`. The inconsistent-read rule is now "an own shift without a name".
  - `calendarAssigneeKey` and `OWN_ASSIGNEE_KEY` key the calendar as `own`, `shift:<id>` or null. `PublishedScheduleView` and `PublishedDayPanel` no longer take `ownEmployeeId`. `/schedule` and the kitchen sink were updated.
  - pgTAP (`schedules.test.sql`, `plan(120)`): the column-set assert is updated, the snapshot now compares ids and covered flags, and `is_own` is asserted for both A and Mg.
  - The unit tests are rewritten, with 3 new `calendarAssigneeKey` tests. CLAUDE.md is updated.

### F5 — A display name can copy a colleague's name

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261007140000_published_schedule_and_display_names.sql:7-10
- **Detail**:
  - Nothing stops two people from choosing the same name, or one person from using another's name.
  - "Uncovered" is still told apart by its destructive pill. Two colleagues with the same name are the real confusion.
  - This is a product decision the plan did not discuss.
- **Fix**: Record it as a known limitation in the roadmap or backlog. If it matters, add a unique index on `lower(display_name)` later.
- **Decision**: FIXED. Recorded under S-05 "Known limitations" in `context/foundation/roadmap.md`.

### F6 — An unconfigured Supabase shows the load error on /schedule instead of the not-configured message

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/schedule.astro:22
- **Detail**:
  - A null client maps to `{ kind: "unknown" }`, so the page shows "Could not load the schedule. Reload the page."
  - Its sibling `/account` shows `SUPABASE_NOT_CONFIGURED_ERROR` in the same case.
  - The difference is cosmetic, and the page is still honest.
- **Fix**: Either accept it as is, or render the not-configured message when `supabase` is null, matching `/account`.
- **Decision**: FIXED. `PublishedScheduleView` takes an optional `loadError`, which defaults to `PUBLISHED_SCHEDULE_LOAD_ERROR`. `/schedule` passes `SUPABASE_NOT_CONFIGURED_ERROR` (from `src/lib/schedule.ts`) when there is no client.

### F7 — `set_display_name` reports success when the caller has no profile row

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261007140000_published_schedule_and_display_names.sql:33-35
- **Detail**:
  - The update touches zero rows, and the user sees "Name saved."
  - In practice this cannot happen, because the `handle_new_user` trigger creates the row at signup.
- **Fix**: Add `if not found then raise exception ... using errcode = 'P0002'` after the update, or leave it as is.
- **Decision**: FIXED. In `20261007150000_display_name_visible_characters.sql`, `set_display_name` raises P0002 when no row is updated. The app maps it to the generic message. Added a pgTAP case for a JWT with no profile row; `profiles_roles.test.sql` now has `plan(47)`.

## Triage summary (2026-10-07)

- **Fixed:** F1 (Fix A), F2, F3, F4, F5 (recorded in the roadmap), F6, F7.
- **Checks after the fixes:**
  - `npm run lint`: clean.
  - `npm test`: 335 tests.
  - `npx astro check`: 0 errors.
  - `npm run check:ui`: clean.
  - `npm run build`: complete.
  - `npm run test:db`: 245 tests.
- **Not run:** `npm run smoke`, because `.dev.vars` points at the hosted project.
- **Hosted:** two new migrations need `npx supabase db push` before deploy: `20261007150000_display_name_visible_characters.sql` and `20261007160000_published_schedule_is_own.sql`.
