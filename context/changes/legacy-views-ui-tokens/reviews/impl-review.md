<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Legacy Views on the Design Tokens (S-09)

- **Plan**: context/changes/legacy-views-ui-tokens/plan.md
- **Scope**: Full plan (completed phases only; Phase 5 left out because Progress row 5.5, the reviewer accepting the look, is still open)
- **Reviewed phases**: 1, 2, 3, 4, 6
- **Date**: 2026-10-08
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Success criteria re-run (2026-10-08)

- `npm test`: 405/405 pass.
- `npm run lint`: clean.
- `npx astro check`: 0 errors, 0 warnings, 0 hints.
- `npm run check:ui`: clean.
- The plan's literal greps for Phases 2, 3 and 4: no hits. `rg bg-cosmic src` and `rg LibBadge src`: no hits.
- Planted `text-purple-300` in `src/pages/manager/months.astro`: `check-ui-literals` exits 1. The plant was reverted.
- `npm run build` + `npm run preview` against local Supabase (`.dev.vars` swapped temporarily and restored byte-identical, then rebuilt): all 4 kitchen sinks return 404. `npm run smoke`: all steps passed.
- Manual rows: every Phase 1–4 and 6 row is `[x]` with its commit SHA, and the diff backs each one (screenshots, `tokens.md`, components). Row 5.5 is pending, outside this review's scope.

## Notes

- Local `master` is behind `origin/master` (#49). Diff against `origin/master...HEAD`, or the roadmap and tasks-linear changes and the role-aware-navigation archive move look like part of this branch.
- `context/foundation/roadmap.md:67` still says "Legacy views still on `bg-cosmic`". Refresh it when this change is archived.

## Findings

### F1 — Password toggle states "pressed" twice

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/auth/PasswordToggle.tsx:14-15
- **Detail**: `aria-label` switches between "Show password" and "Hide password", and `aria-pressed={visible}` was added on top of it. With the password visible, a screen reader announces "Hide password, toggle button, pressed", so the state is given twice and the two contradict each other. The plan asked for both ("`aria-pressed={visible}`. The `aria-label` is kept"), so the flaw is in the plan, and the code followed it.
- **Fix**: Keep `aria-pressed={visible}` and make the label the static "Show password" (the WAI-ARIA toggle-button pattern).
- **Decision**: FIXED — `aria-label="Show password"`, `aria-pressed={visible}` kept

### F2 — Auth and 403 panels use p-6, not the role map's p-4

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/components/auth/AuthPanel.astro:17, src/components/system/AccessDeniedPanel.astro:10
- **Detail**: The Desired End State and the CLAUDE.md role map define the panel as `rounded-xl border bg-card p-4 text-card-foreground`. `AuthPanel` and `AccessDeniedPanel` use `p-6`. The auth wrapper also adds centring (`flex items-start justify-center sm:items-center`), which the "auth panel" row in `tokens.md` does not mention. The after screenshots were taken with `p-6`, and row 5.5 (accept the look) is still open.
- **Fix A ⭐ Recommended**: Record it in `tokens.md`: the "auth panel" row gets `p-6` and the centring, and a note says 403 reuses the same panel.
  - Strength: Keeps the look the screenshots already show for review 5.5. A small standalone card reads better with more padding.
  - Tradeoff: The map gets a second panel padding that the next agent has to choose between.
  - Confidence: HIGH — `tokens.md` is the change's own map, and this is what the "New rows" section is for.
  - Blind spot: The reviewer has not accepted the look yet (5.5).
- **Fix B**: Change both panels to `p-4` to match the role map.
  - Strength: One panel recipe across the app, with no exception to document.
  - Tradeoff: The 5 after shots of the auth and 403 views need retaking before 5.5.
  - Confidence: MEDIUM — the dense `p-4` may look cramped on a centred `max-w-sm` card.
  - Blind spot: Not checked visually.
- **Decision**: FIXED via Fix A — `tokens.md` auth panel row records `p-6` and the centring; new "access-denied panel" row

### F3 — Arbitrary ring-[3px] in a view component

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/auth/PasswordToggle.tsx:13
- **Detail**: The component uses `focus-visible:ring-[3px]` and `transition-[color,box-shadow]`. CLAUDE.md "No literals" keeps `ring-[3px]` inside the shadcn components. The rest of this diff writes `focus-visible:ring-3` (for example `signin.astro:17`, `ConfirmEmailPanel.astro:22`). The plan allowed `ring-[3px]`, and `check:ui` checks colours only, so nothing caught it.
- **Fix**: Use `focus-visible:ring-3` and `transition-colors`.
- **Decision**: FIXED

### F4 — logAuthError logs Supabase's raw message

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/auth-feedback.ts:78-81
- **Detail**: The doc comment and CLAUDE.md say the log never includes the email or password. The code never logs the form fields, but it does log `error.message`, which is text from the auth server. If some auth code put the submitted email into its message, it would reach the Worker log. Not verified against GoTrue's messages. The raw message also helps with debugging, which is the reason the plan logs it.
- **Fix**: Keep logging the message, and change the comment to "never logs the submitted fields".
- **Decision**: FIXED — doc comment and the CLAUDE.md auth "API endpoints" bullet now say "never the submitted form fields"

### F5 — Lock-write error mapping is inline and untested

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/manager/months/lock.ts:47-71
- **Detail**: The sibling modules map a write error in a pure, tested function (`describeDisplayNameWriteError` in `account.ts`, `describeScheduleWriteError` in `schedule.ts`). Here the mapping stays in the endpoint: 23503 → the draft or published message, anything else → `GENERIC_LOCK_WRITE_ERROR`. Only smoke covers it, and only the draft message. The plan said the 23503 branch would keep its logic, so this is not drift.
- **Fix**: Extract `describeLockWriteError(error, publishedAt)` into `src/lib/manager-months.ts` and add tests for the draft, published and generic cases.
- **Decision**: FIXED — `isUnlockBlockedBySchedule` + `describeLockWriteError` in `manager-months.ts`, used by `lock.ts` (the schedule read stays in the endpoint); 4 new tests in `manager-months.test.ts`

### F6 — Unplanned helpers added for the kitchen sinks

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/auth/ConfirmEmailPanel.astro, src/components/auth/AuthFieldStates.tsx; `idPrefix` props on SignInForm, SignUpForm, AuthPanel, DashboardPanel and ConfirmEmailPanel; `pending` on MonthLockRow
- **Detail**: None of these is in the plan. All of them exist so Phase 5's kitchen sinks can render several forms on one page with unique ids, or render a state from fixtures. They are harmless, `ConfirmEmailPanel` is documented in CLAUDE.md, and `AuthFieldStates` is imported only by `/dev/auth-states`. Two other small additions are tested hardening:
  - `describeAuthError` turns the other form's message into this form's generic one;
  - `monthsUrl` drops a malformed month.
- **Fix**: Add a short "Deviations" note to the plan listing them.
- **Decision**: FIXED — `## Deviations` section added to `plan.md` before `## Progress`, also listing the review fixes
