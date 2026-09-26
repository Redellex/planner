<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Role-aware Access Control Implementation Plan

- **Plan**: context/changes/role-aware-access-control/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-09-26
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Verification evidence

- `npx astro check` (run in this review): 0 errors, 0 warnings, 0 hints.
- `npm run build` (run in this review): passes.
- `npm run lint` (run in this review): fails. There are 836 errors: 834 are CRLF `␍` errors in files that predate this change (a Windows `core.autocrlf=true` checkout; the index is LF), and 2 are parse errors in `.claude/skills/10x-plan/scripts/*.mjs`. The files this change added lint clean.
- GitHub Actions run 36113211217 on 5a41bef (the branch head): `smoke` passed and `ci` failed at lint on the same 2 parse errors. Master has been red for the same reason since 6f91b3c, which predates this change.
- Not re-run here because Docker isn't running: `supabase db reset`, `db lint`, the SQL checks, and `npm run smoke`. The green CI `smoke` job on 5a41bef applies the migration and seed from scratch and runs the role steps, so it covers these.
- Plan drift: every planned file exists and matches its contract, including the segment-boundary matching, fail-closed role lookup, `SECURITY DEFINER` + `search_path = ''` on `is_manager()`, the manager-row lock in the guard trigger, and the column-level `update (role)` grant. The unplanned additions are benign or were anticipated by the plan: the ESLint/Prettier ignores for the generated types (the plan says to add them if needed), the `URL` global for the smoke script, and the smoke `check` hook that asserts the error message.

## Findings

### F1 — CI `ci` job is red; "lint passes" ticked without a passing lint

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: eslint.config.js:83
- **Detail**: Progress items 2.1, 3.1 and 4.2 ("`npm run lint` passes") are all `[x]`. But on the PR's head commit (5a41bef), the `ci` job fails at lint with 2 "not found by the project service" parse errors in `.claude/skills/10x-plan/scripts/metadata-guard{,.test}.mjs`. Those files came from 6f91b3c on master, before this change, so the change didn't cause the failure. It does block the PR from going green, and the ticked criteria don't reflect reality.
- **Fix**: Add the agent-tooling folders (`.claude/**`, `.agents/**`, `.codestudio/**`) to the existing `globalIgnores([...])` in `eslint.config.js`.
- **Decision**: FIXED. Added `globalIgnores([".claude/**", ".agents/**", ".codestudio/**"])` to `eslint.config.js`. A local ESLint run now shows 0 non-CRLF errors.

### F2 — Manager self-demotion "success" lands on the 403 page

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/manager/users/role.ts:38
- **Detail**: When a manager demotes themselves while another manager exists, the update succeeds and the endpoint redirects to `/manager/users?updated=1`. On that request the middleware reads the new role (`employee`) and rewrites the page to `/403`. The user sees "Access denied" instead of a confirmation. Plan manual step 4 ("Demote yourself while another manager exists → succeeds") works at the data level, but the UX reads as a failure.
- **Fix**: In the endpoint, when `userId === context.locals.user?.id && role !== "manager"`, redirect to `/dashboard` instead of `/manager/users?updated=1`.
- **Decision**: FIXED. Added a self-demotion branch in `role.ts` that redirects to `/dashboard`. Lint and `astro check` are clean; the flow itself isn't manually tested yet (needs a running Supabase with two managers).

### F3 — `handle_new_user` doesn't guard against a NULL email

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260925120000_create_profiles_and_roles.sql:26
- **Detail**: The trigger inserts `new.email` into `profiles.email text not null`, but the backfill in the same migration uses `coalesce(u.email, '')`. An auth user without an email (a phone or anonymous sign-in) would make the signup transaction fail. Only email signup is enabled today (`enable_anonymous_sign_ins = false`), so this is latent.
- **Fix**: Accept as risk for now. If phone or anonymous auth is ever enabled, add a follow-up migration that redefines `handle_new_user` with `coalesce(new.email, '')`. Don't edit the already-applied migration.
- **Decision**: FIXED. Added the follow-up migration `supabase/migrations/20260926120000_handle_new_user_null_email.sql`, which redefines `handle_new_user` with `coalesce(new.email, '')`. It hasn't been applied locally yet (Docker is off): run `npx supabase db reset` to apply it, and `npx supabase db push` for the hosted project. No type regeneration is needed.

### F4 — `npm run lint` fails on Windows checkouts (CRLF)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: N/A (repo root; no `.gitattributes`)
- **Detail**: With `core.autocrlf=true` and no `.gitattributes`, older files are checked out as CRLF. The Prettier rule then reports 834 `Delete ␍` errors locally, while CI (Linux, LF) doesn't see them. This makes the local "lint passes" gate unreliable on this machine. It isn't caused by this change.
- **Fix**: Add `.gitattributes` with `* text=auto eol=lf`, then run `git add --renormalize .`. This could be a separate chore commit or change.
- **Decision**: FIXED. Added `.gitattributes` (`* text=auto eol=lf`). The index was already LF, so I converted the 55 working-tree CRLF files in place instead of renormalizing, and refreshed the files that git only flagged after the attributes change. Nothing was staged. `npm run lint` now passes locally with 0 errors.

## Triage summary (2026-09-26)

| Outcome | Findings |
|---------|----------|
| Fixed | F1, F2, F3, F4 |

`20260926120000_handle_new_user_null_email.sql` has been pushed to the hosted project; `migration list` on 2026-09-26 shows it applied remotely. Still to do before merge (there's no local Supabase; work happens on the hosted project): with two managers, check by hand that manager self-demotion lands on `/dashboard`. Commit and let CI run; its `smoke` job uses its own local Supabase. Don't run `npm run smoke` against the hosted project, because its seeded-manager steps only work with `seed.sql`.
