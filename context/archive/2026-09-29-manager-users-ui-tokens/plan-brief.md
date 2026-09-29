# /manager/users on Design Tokens — Plan Brief

> Full plan: `context/changes/manager-users-ui-tokens/plan.md`
> Research: `context/changes/manager-users-ui-tokens/research.md`

## What & Why

`/manager/users` is the one screen where a manager changes roles, and it still looks and behaves like the old starter:

- a `bg-cosmic` glass card with palette literals;
- hand-built alerts and buttons;
- a native select with a `text-black` hack;
- `?error=` text rendered verbatim at the top of the page.

This change rebuilds it on the token and component contract `/availability` already uses. It fixes the message path, which is spoofable, shows raw DB text and puts feedback far from the row. It then leaves a rule and a check, so the next view does not drift again.

## Starting Point

The dark neutral token theme, `Alert`, `Button` and `Input` are live and used by `/availability`. This view reads none of them: 0 token classes and 0 `ui/` imports, with 12 lines matching the hardcoded-value scan plus `bg-cosmic`. `role.ts` forwards raw PostgREST errors, and the redirect does not say which row a message belongs to. `CLAUDE.md` has no UI rule.

## Desired End State

`/manager/users` renders in the same neutral dark theme as `/availability`:

- a card list of accounts, each with a `NativeSelect` and a secondary `Save`;
- a "You" pill on the manager's own row;
- "No email · 3f2a9c1b" for accounts without an email.

After a save, the result appears as an `Alert` inside that row. Only allow-listed messages are shown, and "Cannot demote the last manager" still reads the same. A load failure shows one destructive alert instead of "No accounts found.". Save disables while posting. A dev-only kitchen sink shows all seven states. A `CLAUDE.md` UI block and `npm run check:ui` (run in pre-commit) keep the cleaned views free of colour literals.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Token source | Existing shadcn neutral dark tokens, no value changes | The contract is already proven on `/availability`; extend it, don't fork it. | Research |
| Select | `npx shadcn@latest add native-select`, rendered via a React `RoleSelect` wrapper | No new npm dependency; the wrapper keeps `<option>`s as React children so `selected` and the markup are correct. | Research / Plan |
| Feedback placement | In the affected row via `&user=<id>` after `error=`/`updated=1`; top alert as a fallback | The manager sees which row failed, and the smoke `startsWith("/manager/users?error=")` prefix still holds. | Plan (Q1) |
| Message path | Users-only allow-list in `src/lib/manager-users.ts`; raw errors logged, generic text shown | Removes spoofable and raw DB text without touching `/availability`. | Research / Plan |
| "(you)" marker | Token-built "You" pill (`bg-secondary text-secondary-foreground`) | Strong cue against self-demotion, and shadcn `badge` would add Radix. | Plan (Q2) |
| Pending state | Live: scoped copy of the `/availability` script (disable + `aria-busy`, `pageshow` reset) | Exercises the `disabled` state for real users and blocks double POSTs. | Plan (Q3) |
| Guard | `CLAUDE.md` UI block + `scripts/check-ui-literals.mjs` in lint-staged and `npm run check:ui` | A failing check beats a forgotten rule; no new dependency. | Plan (Q4) |
| Missing email | "No email · <first 8 chars of id>"; aria "Save role for user <short id>" | Distinguishes blank rows and names every control. | Plan (Q5) |
| Check scope | Colour literals only, in cleaned views + kitchen sinks | `ring-[3px]`-style sizes are shadcn convention; they stay a reviewed rule. | Plan |

## Scope

**In scope:**

- `native-select`;
- `src/lib/manager-users.ts`, `role.ts` redirects;
- `users.astro` rebuilt with `UserRoleRow.astro` and `RoleSelect.tsx`;
- the pending script;
- the `/dev/manager-users-states` kitchen sink;
- before/after screenshots;
- the `CLAUDE.md` UI block;
- `scripts/check-ui-literals.mjs` + lint-staged + `check:ui`.

**Out of scope:**

- other `bg-cosmic` views (`/manager/months` next);
- the sticky/fakeable flash (needs cookies);
- confirmation after self-demotion;
- app nav;
- sharing the allow-list or script with `/availability`;
- a CI step for the check;
- new dependencies or token value changes.

## Architecture / Approach

Form-POST + redirect stays the convention. `role.ts` validates input and lets RLS plus the last-manager trigger decide. It maps the outcome to a constant and redirects to `managerUsersUrl(result, userId)`, which keeps `error`/`updated` as the first param. The page separates `loadError` (its own read) from URL feedback (untrusted, resolved through the allow-list) and hands feedback to the `UserRoleRow` whose id matches `user`. React ui components render from `.astro` with no hydration; the only client JS is the inline pending script.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Library and token map | Before screenshots, `native-select`, `tokens.md` | shadcn CLI overwriting existing ui files or touching `package.json` |
| 2. Message contract | Allow-listed messages, `&user=` redirects, load error split from feedback | Breaking the smoke prefix or the `/last manager/i` match |
| 3. View on tokens and components | `UserRoleRow`, `RoleSelect`, token shell, row feedback, load/empty/blank-email states | Options passed as Astro children → invalid `<select>` markup / no preselection |
| 4. States and visual gate | Pending script, `/dev/manager-users-states`, after screenshots, 7-state matrix | Kitchen sink leaking into production builds |
| 5. Make it stick | `CLAUDE.md` UI block, `check-ui-literals.mjs`, lint-staged, `check:ui` | Check path normalisation on Windows letting hits through |

**Prerequisites:** local Supabase running with `supabase/seed.sql` applied (seeded manager and employee), dev server for screenshots.
**Estimated effort:** ~2 sessions across 5 phases.

## Open Risks & Assumptions

- The PostgREST `message` for the trigger equals `Cannot demote the last manager` exactly; smoke in Phase 2 confirms it, and anything else falls back to the generic text.
- The kitchen sink is the only place the load-failure state can be seen, because an unconfigured app redirects anonymous users before the page renders.
- A hand-made `?updated=1&user=<id>` can still show a fake "Role updated." (deferred D2).

## Success Criteria (Summary)

- A manager sees `/manager/users` as the same app as `/availability`, with every control focus-visible and named, including blank-email rows.
- Save results show up in the row they concern, with only known messages, and the last-manager rule still reads clearly.
- `npm run smoke` and `npm run check:ui` pass, and a commit that reintroduces a colour literal in a cleaned view is rejected.
