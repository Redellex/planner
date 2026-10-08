<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Role-aware navigation

- **Plan**: context/changes/role-aware-navigation/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Evidence for the passing dimensions:

- **Plan adherence.** Every planned item matches; there is no DRIFT or MISSING item. `navigation.test.ts` adds two more checks than planned: no route is both linked and excluded, and every excluded route exists. Both tighten the guard and are benign.
- **Scope.** The diff does not touch `route-access.ts` or the middleware. It adds no dependency, shadcn component or hydrated island, shows no display name in the bar, and leaves the title unchanged.
- **Commands re-run during this review.** `npm test` (374 passed), `npm run lint`, `npm run check:ui`, `npx astro check` (0 errors) and `npm run build` all pass, and `grep "Back to dashboard" src/` finds nothing.
- **Smoke was not re-run.** `.dev.vars` points at the hosted project, so a run would need an env swap and a rebuild; the pass is recorded at 9bb2da2.
- **Manual items.** All are checked off with commit references.

## Findings

### F1 — No `<main>` landmark or skip link past the new bar

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/layouts/Layout.astro:39-40
- **Detail**:
  - Every page now opens with a repeated block of links: up to 10 tab stops for a manager (brand, 8 links, Sign out).
  - No `<main>` exists anywhere in `src`, and there is no skip link (WCAG 2.4.1 Bypass Blocks).
  - Before this change there was no repeated block, so the gap is new.
- **Fix**: Wrap `<slot />` in `<main id="main" class="flex flex-1 flex-col">` so page roots keep their `flex-1`. Optionally add a visually hidden "Skip to content" link before `<AppNav>`.
- **Decision**: FIXED — `<main id="main">` around the slot plus a focus-visible "Skip to content" link in `Layout.astro`

### F2 — Smoke never checks that the signed-in bar renders Sign out

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:233-242
- **Detail**:
  - The dashboard's Sign out form was removed, so the bar is now the only Sign out in the UI.
  - The "signout clears session" step (`:349`) POSTs to the endpoint directly.
  - If the `actor.signedIn &&` branch regressed, users could not sign out and smoke would still pass.
- **Fix**: Check that `action="/api/auth/signout"` is in the account-page body, and that it is absent in the anonymous `/auth/signin` step.
- **Decision**: FIXED — `hasSignOut` in smoke: present on the fresh user's `/account`, absent on the anonymous `/auth/signin`; CLAUDE.md smoke paragraph updated

### F3 — The kitchen sink's submit guard also disables the real bar's Sign out

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dev/navigation-states.astro:77-82
- **Detail**:
  - The header comment (`:3-4`) calls the top bar "the real session's", and the script comment says it keeps the _fixture_ forms inert.
  - But the handler is page-wide, so the real Sign out does nothing on this page.
  - The other sinks behave the same way. Dev only.
- **Fix**: Reword the comments to say every form on the page is inert, including the real bar's Sign out.
- **Decision**: FIXED — comments in `navigation-states.astro` now say every form on the page is inert, the real bar's Sign out included

### F4 — Safari may still draw the `<details>` disclosure marker

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/navigation/AppNav.astro:54
- **Detail**: `list-none` with `inline-flex` hides the triangle in Chromium and Firefox. WebKit uses `::-webkit-details-marker`, so the Menu button can show a stray triangle in Safari. The manual checks did not cover Safari.
- **Fix**: Add `[&::-webkit-details-marker]:hidden` to the summary's classes.
- **Decision**: FIXED — `[&::-webkit-details-marker]:hidden` added to the Menu summary

## Triage summary

- **Fixed**: F1, F2, F3, F4 (4)
- **Skipped**: none
- **Verification after fixes**: `npm test`, `npm run lint`, `npm run check:ui`, `npx astro check` and `npm run build` all pass (374 tests, 0 astro errors). `npm run smoke` against the local stack (`.dev.vars` swapped to local, restored afterwards): all steps passed, including the new Sign out checks.
- **Manual (headless Chrome over CDP, seeded accounts, 2026-10-08)**:
  - **Skip link.** The first Tab focuses "Skip to content" and it shows top-left. Enter jumps to `#main`, and the next Tab lands inside `<main>`.
  - **Layout on every checked page.** There is exactly one `<main>`, and it starts at the bar's bottom edge. The page root fills it, and nothing scrolls sideways.
  - **Height.** `/auth/signin`, `/403`, `/account`, `/` and `/manager/months` fit an 800px-high viewport.
  - **Legacy pages.** The cards on `/auth/signin`, `/403`, `/` and `/manager/months` sit centred to the pixel.
  - **Anonymous visitor.** The bar shows Sign in and Sign up, with no Sign out.
  - **Employee.** The bar shows Home, Availability, Schedule and Account plus Sign out, on `/account`, `/` and the 403 page for `/manager/users`. The dashboard grid shows Availability, Schedule and Account.
  - **Manager, `/manager/schedule`.** At 390px and 768px the links collapse into Menu. At 1024px and 1280px all 8 links are inline, and Manage schedule is marked as the current page. The dashboard grid shows 7 links.
  - **Phone menu at 390px.** Keyboard Tab reaches the summary and Enter opens it; the panel stays inside the viewport (118–374px of 390). Tab moves into Home, and Enter on the summary closes it.
  - **Not covered.** Safari was not tested.
