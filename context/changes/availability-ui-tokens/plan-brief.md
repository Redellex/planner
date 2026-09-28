# /availability on Design Tokens — Plan Brief

> Full plan: `context/changes/availability-ui-tokens/plan.md`
> Research: `context/changes/availability-ui-tokens/research.md`

## What & Why

`/availability` is the core employee screen. It was built feature by feature from copy-pasted literal classes, while the repo's own shadcn token set and `Button` component went unused. This change makes the view read the existing design-system contract: tokens plus in-repo components. It also closes the rendering-side problems the audit found:

- spoofable or raw error text;
- feedback far from the form;
- false errors after a double submit.

## Starting Point

- `global.css` ships shadcn neutral `:root`/`.dark` values published through `@theme inline`, but no page reads them.
- Dark mode is never switched on. The dark look is a hex `bg-cosmic` gradient, a glass card and a gradient heading, repeated across about 8 pages.
- `availability.astro` has 57 literal colour occurrences, local `inputClass`/`buttonClass` strings, and no focus or disabled states.
- It renders `?error=` verbatim and passes raw Postgres messages through.

## Desired End State

- The app renders in the shadcn neutral **dark** theme.
- `/availability` uses only tokens plus `Button`, `Input` and `Alert`, with zero literal colours.
- Feedback appears in the selected-day panel and only from a fixed message list.
- Selected, has-windows and focused day cells are clearly distinct, and submit buttons go pending on click.
- A dev-only kitchen-sink page shows every state for screenshot review.
- The smoke script still passes unchanged.

## Key Decisions Made

| Decision          | Choice                                                                  | Why (1 sentence)                                                                                         | Source   |
| ----------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| Token source      | Existing shadcn new-york neutral values; no new palette                 | Extend the system already in the repo instead of forking a "cosmic" one.                                 | Research |
| Theme             | Global `class="dark"` on `<html>` + `color-scheme: dark`                | One token-layer edit that keeps the view close to the other dark pages and fixes native-control chrome.  | Plan     |
| Backdrop          | Drop `bg-cosmic`, glass card and gradient `h1` on this view             | Zero literal colours left in the view.                                                                   | Plan     |
| Success styling   | Default `Alert` + check icon, no new `--success` token                  | The meaning comes from icon and text rather than colour, and the token contract is not widened.          | Plan     |
| Error text safety | Allow-list of known messages in `lib/availability.ts`; generic fallback | Redirect URLs stay identical, so smoke is untouched, and the endpoints only swap literals for constants. | Plan     |
| Form UX scope     | Pending-disable script + feedback in day panel; typed values deferred   | Fixes the false overlap error without changing endpoint URL contracts.                                   | Plan     |
| Checkbox          | Native `<input type="checkbox">` with `accent-primary` + focus ring     | No Radix dependency and no hydration for one control.                                                    | Plan     |
| Visual gate       | Dev-only `/dev/availability-states` (404 in prod) + screenshots         | There is no screenshot runner in the repo, and the kitchen sink reuses the real components.              | Plan     |
| React in Astro    | `Button`/`Input`/`Alert` rendered SSR without `client:*`                | They are pure markup; `@astrojs/react` is already registered.                                            | Plan     |

## Scope

**In scope:**

- `.dark` activation plus a token source note in `global.css`, and `tokens.md` (role → token map)
- `npx shadcn@latest add input alert`
- Message constants, `resolveFeedbackError` and a generic fallback in `lib/availability.ts`; endpoints use the constants
- `MonthTabs`, `AvailabilityCalendar` and `DayPanel` components on tokens; `availability.astro` composes them
- Focus and hover on day cells, a pending-submit script, a kitchen-sink page, and before/after screenshots

**Out of scope:**

- Other views (dashboard, manager pages, auth, Topbar, 403) and their cosmic styling
- Sticky flash params, preserving typed values, return-URL after sign-in, app shell, silent month fallback
- A light theme gate, a theme toggle, shadcn `label`/`checkbox`, Playwright

## Architecture / Approach

The page keeps all data loading and the form-POST + redirect contract. It passes plain props to three Astro components that render shadcn React components server-side, with no hydration. `lib/availability.ts` becomes the single source of user-facing messages: endpoints emit constants, and the page shows `?error=` only when it matches that set. The only client JS is an inline delegated `submit`/`pageshow` listener for the pending state.

## Phases at a Glance

| Phase                         | What it delivers                                                       | Key risk                                                              |
| ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1. Token layer and components | Dark token theme live, `input`/`alert` added, baseline screenshots     | The global `.dark` visibly changes another page                       |
| 2. Message contract           | Allow-listed messages, no raw DB text; smoke still green               | Allow-list drifts from the endpoint literals (mitigated by constants) |
| 3. View on tokens             | Three token-based components, feedback in the day panel, zero literals | Breaking the smoke markup contract (`name="id" value=`)               |
| 4. States and visual gate     | Focus/hover/pending states, kitchen sink, after screenshots            | The dark `--ring` is too faint, so a token-level tweak is needed      |

**Prerequisites:** Local Supabase running with `supabase/seed.sql` applied (for smoke and manual checks); a browser for screenshots.
**Estimated effort:** ~2 sessions across 4 phases.

## Open Risks & Assumptions

- **Assumption:** other pages hide the body/border change under their hard-coded classes. Phase 1 screenshots verify this.
- **Assumption:** the shadcn CLI adds `input`/`alert` without new dependencies and without touching `button.tsx`. Phase 1 criteria check both.
- **Risk:** focus-ring contrast on `bg-card` in dark. If it is too faint, the fix goes in `--ring` (`.dark`), not in classes.
- **Accepted:** `?updated=1` can still be forged to show "Availability saved." (harmless; deferred).

## Success Criteria (Summary)

- A keyboard or mouse user on `/availability` can always tell the selected day, days with windows and the focused control apart, and sees feedback next to the form they used.
- A crafted `?error=` link or a database failure never puts arbitrary or raw text in front of the user.
- The kitchen sink shows every state in the new theme at desktop and mobile widths, and `npm run smoke` passes unchanged.
