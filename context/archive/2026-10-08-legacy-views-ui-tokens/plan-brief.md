# Legacy Views on the Design Tokens (S-09) — Plan Brief

> Full plan: `context/changes/legacy-views-ui-tokens/plan.md`
> Research: `context/changes/legacy-views-ui-tokens/research.md`

## What & Why

Six views still use the legacy look: the dashboard `/`, sign-in, sign-up, confirm-email, 403 and `/manager/months`. That look is a `bg-cosmic` gradient, glass cards, purple/blue text and hand-built controls, so the first pages a user sees look like a different app. They also break the feedback rule:

- they render any error text from the URL or the database;
- `/manager/months` shows every month as "Open" when its read fails.

S-09 (MS-04, GitHub #44) moves them onto the existing tokens and fixes both defects.

## Starting Point

The tokens and components already exist and every other view uses them (`Input`, `Button`/`buttonVariants`, `Alert`, the role maps in `context/archive/*-ui-tokens/tokens.md`). The six views use none of them except one purple-overridden `Button`. That leaves 49 literal lines, no kitchen sinks and no `check:ui` scope.

## Desired End State

- **One look.** Every page has the same neutral shell as `/account` and `/schedule`.
- **Messages:**
  - sign-in and sign-up show clear messages for the common failures (wrong password, unconfirmed email, existing account, weak password, rate limit);
  - crafted `?error=` links show a generic message instead of their own text;
  - `/manager/months` shows only a load error when its read fails, and each lock/unlock result appears in that month's row.
- **Submit buttons.** They really disable while posting.
- **Guarded.** Four kitchen sinks and screenshots prove each state, and every file is in `check:ui`. `bg-cosmic` is deleted.

## Key Decisions Made

| Decision        | Choice                                                                                                                                                                    | Why (1 sentence)                                                                                                   | Source   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| Change size     | One change, 6 phases                                                                                                                                                      | Deletes `bg-cosmic` and the CLAUDE.md Legacy bullet in one go, matching the single roadmap item and issue.         | Plan     |
| Auth errors     | Endpoints map `AuthError.code` → allow-listed messages (`src/lib/auth-feedback.ts`), raw text logged                                                                      | Useful messages for common failures, the same allow-list pattern as `account.ts`, crafted links show generic text. | Plan     |
| Auth allow-list | Per form (sign-in vs sign-up)                                                                                                                                             | A sign-up message in a sign-in link resolves to the sign-in generic message.                                       | Plan     |
| Months read     | `buildMonthLocks` ready/unknown; unknown shows only the load error                                                                                                        | Fixes the fail-open, following the honest-read pattern in `team-availability.ts`.                                  | Research |
| Months feedback | Allow-listed, shown in the month's row via `&month=YYYY-MM` after the status param                                                                                        | The `/manager/users` row-feedback pattern; smoke's prefix matches stay green.                                      | Plan     |
| Banner          | Folded in: `Alert` + English copy, in scope                                                                                                                               | `Layout` is already in scope; this closes the last literal it renders.                                             | Plan     |
| Copy            | Dashboard drops the starter line and gets a role pill; confirm-email has one "Check your email" copy with a lucide icon; 403 gets "Go home" and true-on-direct-visit copy | Starter leftovers and the wrong DEV switch go while the views are open; smoke texts kept.                          | Plan     |
| Pending         | Real on auth (React state + `pageshow` reset) and months (the `users.astro` script)                                                                                       | The `useFormStatus` branch never fires on a URL-action form; matches the pending pattern of the token views.       | Plan     |
| Tests           | Unit tests for the two new modules + `roleLabel`; test-plan §7 legacy exclusion removed; smoke unchanged                                                                  | Pins the security-relevant allow-lists like the other views'; smoke already covers the flows.                      | Plan     |
| Kitchen sinks   | `auth-states`, `dashboard-states`, `access-denied-states`, `manager-months-states`; Banner in `navigation-states`                                                         | One per view group; the Banner belongs to the chrome `Layout` renders.                                             | Plan     |

## Scope

**In scope:**

- the six views, the auth React components and the `Banner`;
- the sign-in, sign-up and lock endpoints' error handling;
- the new modules `auth-feedback.ts` and `manager-months.ts`, plus `roleLabel`;
- four kitchen sinks, route-inventory rows and screenshots;
- `SCOPE` additions;
- deleting `bg-cosmic` and `LibBadge`;
- CLAUDE.md and test-plan updates.

**Out of scope:**

- token value changes and new shadcn components;
- a return URL after sign-in;
- `/manager/availability`;
- smoke changes;
- the sign-up redirect target and the validation rules;
- the default `<title>`.

## Architecture / Approach

The contract comes before the pixels:

1. **Phase 1** writes pure, unit-tested message/read modules and switches the endpoints to them, with no visual change.
2. **Phases 2–4** restyle the views in three groups. Each view's body becomes a prop-driven component (`AuthPanel`, `DashboardPanel`, `AccessDeniedPanel`, `MonthLockRow`), so the page and its kitchen sink render the same markup.
3. **Phase 5** adds the kitchen sinks and screenshots.
4. **Phase 6** locks the result into `check:ui` and deletes the legacy contract.

## Phases at a Glance

| Phase                            | What it delivers                                                                                        | Key risk                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1. Baseline and message contract | Before shots, `tokens.md`, `auth-feedback.ts`, `manager-months.ts` + tests, endpoints log raw errors    | Breaking smoke's exact `UNLOCK_WITH_DRAFT_ERROR` or the `?error=` prefixes |
| 2. Auth views on tokens          | `Input`-based fields with `aria-invalid`/`describedby`, `Alert` server error, real pending, `AuthPanel` | The pending state must not block the native POST                           |
| 3. Dashboard, 403 and Banner     | `DashboardPanel` with role pill, `AccessDeniedPanel` with Go home, English `Alert` banner               | Keeping `data-dashboard` and "Access denied" for smoke                     |
| 4. `/manager/months` on tokens   | Fail-closed read, row feedback, token list, pending script                                              | Feedback placement on an invalid `?month=` (falls back to the top)         |
| 5. States and visual gate        | 4 kitchen sinks, Banner states, route-inventory rows, after screenshots                                 | Kitchen sinks must 404 in production                                       |
| 6. Make it stick                 | `SCOPE` additions, `bg-cosmic`/`LibBadge` deleted, CLAUDE.md and test-plan updated                      | Missing a file in `SCOPE` leaves it unguarded                              |

**Prerequisites:** S-06 and S-07 done (they are). Local Supabase stack for the smoke runs and screenshots; `.dev.vars` pointing at local (see memory: smoke env points at hosted).
**Estimated effort:** ~3–4 sessions across 6 phases (about 25 files, mostly small).

## Open Risks & Assumptions

- `useFormStatus` never firing is an inference from the React docs. The plan replaces it either way, so the risk is only in the "before" description.
- The supabase-js `ErrorCode` union may change; unknown codes fall back to the generic message, so the risk is a less specific message, not leaked text.
- Confirm-email has no reachable live state locally (confirmations are off), so its kitchen sink is its only visual check.

## Success Criteria (Summary)

- A user sees one consistent neutral UI from sign-in through every page, with accessible field errors and a working "Signing in…" state.
- No page shows text from the URL or the database. `/manager/months` never offers a Lock button it cannot back with a successful read.
- `npm run check:ui` covers every view, `bg-cosmic` no longer exists, and smoke, unit tests, lint and `astro check` pass.
