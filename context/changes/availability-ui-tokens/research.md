---
date: 2026-09-28T18:46:18+02:00
researcher: Claude (Opus 5.5) for Redellex
git_commit: 5b4001c4bcdf49182b7cad189db28e95a14468a4
branch: employee-availability-management
repository: Redellex/planner
topic: "UI audit of /availability against the repo's shadcn neutral tokens and shared components"
tags: [research, ui, design-tokens, shadcn, tailwind, availability]
status: complete
last_updated: 2026-09-28
last_updated_by: Claude (Opus 5.5)
---

# Research: UI audit of /availability against the repo's design-system contract

**Date**: 2026-09-28T18:46:18+02:00
**Researcher**: Claude (Opus 5.5) for Redellex
**Git Commit**: 5b4001c4bcdf49182b7cad189db28e95a14468a4 (working tree has only untracked tooling dirs; all cited `src/` files are unmodified at this commit)
**Branch**: employee-availability-management
**Repository**: Redellex/planner

## Research Question

Per `change.md` and `/10x-ui`:

- **Audit.** Locate this repo's source of values and its shared-components directory, and find which views read them.
- **Reference.** The motif is the existing shadcn "new-york" neutral token set already in the repo, with no new palette.
- **Output.** A charge list for the one view `/availability` (`src/pages/availability.astro`). Each charge carries a file:line and its effect on the user, grouped as missing tokens, missing shared component, or accidental architecture.

## Summary

- **The repo has both halves of the contract, and the view reads neither.**
  - Values: `src/styles/global.css:6-39` (`:root`) and `:41-73` (`.dark`), published by `@theme inline` at `:75-111`.
  - Components: `src/components/ui/`, which holds exactly one shadcn component, `button.tsx`. The other file there, `LibBadge.astro`, is imported nowhere.
- **No page uses the tokens.** Semantic token classes appear in only 2 files in `src/`: `components/ui/button.tsx` and `styles/global.css`. No page uses a semantic class.
- **`availability.astro` is all literals.** It contains 57 occurrences of literal colour utilities (34 distinct, counting `hover:` variants), across the white/xx, purple, blue, red and green palettes plus `bg-cosmic` and `text-transparent`. It has no token class, and no `focus` or `disabled` class.
- **The dark look is a de-facto theme that lives outside the token system.** Every page repeats the same three pieces:
  - the `bg-cosmic` hex gradient (`global.css:113-115`)
  - a `bg-white/10 backdrop-blur-xl` glass card
  - a `from-blue-200 to-purple-200` gradient `h1`

  Dark mode is never switched on: nothing in `src/` adds `.dark`, sets `color-scheme` or checks `prefers-color-scheme`, and `Layout.astro:14` renders a plain `<html lang="en">`. So the neutral tokens resolve to the **light** `:root` values, and `body` is white underneath the cosmic wrapper (`global.css:121-123`).

- **This is the "fresh starter whose screens ignore its own tokens" playbook.** The first job is making `/availability` read the existing neutral tokens and shadcn components. That forces one decision the plan must settle first: which token theme the view renders in (see Open Questions, Q1).
- **The worst accidental-architecture problems are on the entry side, not the colours.**
  - The `?error=` query value is rendered verbatim in a `role="alert"`, so the alert text can be spoofed.
  - Raw Postgres messages pass through to users.
  - Errors appear only at the top of the page, and the user's typed values are cleared.
  - There is no pending state, so a double submit produces a false error.

## Detailed Findings

### Source of values (tokens)

- **`global.css`:**
  - `:root` holds the full shadcn neutral set: `--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--muted(-foreground)`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, the chart and sidebar tokens, and `--radius: 0.625rem` (`src/styles/global.css:6-39`).
  - `.dark` holds the matching dark values (`:41-73`).
- **Publishing is done correctly.** `@theme inline` maps each value to `--color-*` through `var(...)`, with no raw colours in the theme block (`global.css:75-111`), so `bg-primary`, `text-muted-foreground` and the rest all exist. Radius tokens `--radius-sm…xl` are at `:76-79`.
- **Dark variant:** `@custom-variant dark (&:is(.dark *))` (`global.css:4`). It fires only for descendants of an element with class `.dark`, and no such element is ever rendered (Layout.astro:14, 21). There is no `color-scheme` declaration in `src/`.
- **Values outside the token system:**
  - `@utility bg-cosmic` uses three hex literals (`#0a0e1a`, `#0f1529`) (`global.css:113-115`).
  - `Banner.astro:27-41` has its own hex palette in a scoped `<style>`.
- **Base layer:**
  - `* { @apply border-border outline-ring/50 }` (`global.css:118-119`): a bare `border` renders the light `--border` (oklch 0.922), and focus outlines take the light `--ring` at 50%.
  - `body { @apply bg-background text-foreground }` (`:121-123`) produces a white body.

### Shared components

- `src/components/ui/button.tsx`: the shadcn new-york v4 Button.
  - It has cva variants `default`, `destructive`, `outline`, `secondary`, `ghost` and `link`, and sizes `default`, `sm`, `lg` and `icon` (`button.tsx:7-37`).
  - It has a built-in `focus-visible:ring-ring/50 ring-[3px]` and `disabled:opacity-50` (`:8`).
  - `buttonVariants` is exported (`:50`) but imported nowhere.
  - The only `Button` import is `src/components/auth/SubmitButton.tsx:3`, which overrides the primary token with `bg-purple-600` (`:18`).
- `components.json`: new-york style, neutral base colour, `cssVariables: true`, `css: src/styles/global.css`, `ui: @/components/ui`, lucide icons. It is ready for `npx shadcn@latest add <name>`.
- **Installed dependencies** relevant to adding components (`package.json:19-36`): `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css`, `@astrojs/react`.
  - No other `@radix-ui/*` package is installed, so adding shadcn `label` or `checkbox` would add a new Radix dependency.
  - `input` and `alert` need nothing new (plain elements plus cva).
- **Using them from Astro:** no `.astro` file renders a React UI component today.
  - Astro can render a React component server-side without a `client:*` directive. That produces static HTML, which is enough for submit buttons in plain forms.
  - `buttonVariants(...)` can style an `<a>` directly.
  - This follows from Astro's islands model rather than an existing repo precedent, so the plan should verify it in phase 1.

### Which views read the tokens

- **No page reads them.** Every view and component that matched literal palette classes (per-line tallies from the component sweep): `availability.astro` 30 lines, `Welcome.astro` 20, `manager/users.astro` 12, `Topbar.astro` 11, `dashboard.astro` 11, `Banner.astro` 9 (hex), `manager/months.astro` 9, `403.astro` 5, `FormField.tsx` 5, and 4 each in `auth/{signin,signup,confirm-email}.astro`.
- **Shared literal patterns** (out of scope for this change, recorded for context):
  - The glass card shell `rounded-2xl border border-white/10 bg-white/10 … backdrop-blur-xl` appears in 8 files, for example `availability.astro:112`, `dashboard.astro:10` and `manager/users.astro:31`.
  - `bg-cosmic` appears on 9 pages or components.
  - The gradient `h1` appears on 8 pages.
  - The secondary-button string appears at `manager/months.astro:31-32`, `manager/users.astro:80,93`, `dashboard.astro:28,36,44,53` and `403.astro:18`.
  - The red alert string appears at `manager/months.astro:45`, `manager/users.astro:36` and `auth/ServerError.tsx:11`.
  - The green status string appears at `manager/months.astro:52` and `manager/users.astro:43`.

### Reference: shadcn new-york v4 (Context7 `/shadcn-ui/ui`, fetched 2026-09-28)

- **Input** (`registry/new-york-v4/ui/input.tsx`): `h-9 rounded-md border border-input bg-transparent px-3 py-1 shadow-xs … dark:bg-input/30`.
  - Focus: `focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50`.
  - Invalid: `aria-invalid:border-destructive aria-invalid:ring-destructive/20`.
  - Disabled: `disabled:cursor-not-allowed disabled:opacity-50`.
  - No new dependency.
- **Alert** (`registry/new-york-v4/ui/alert.tsx`): variants `default` and `destructive`, with `AlertTitle` and `AlertDescription`.
  - The root sets `role="alert"` by default. A success or locked notice should override it with `role="status"`, which matches today's semantics at `availability.astro:123,150`.
- **Dark mode in Astro** (shadcn docs `dark-mode/astro`): the class-based `.dark` goes on `document.documentElement`, set by an inline script that reads localStorage or `prefers-color-scheme`. A static `class="dark"` on `<html>` is the zero-JS variant.

### Charge list for `/availability`

Each charge is recorded as **file:line**, then **effect on the user**. The scope column is a proposal for `/10x-plan`; it is not decided here.

#### Missing tokens

| #   | Evidence                                                                                                                                                       | Token that should cover it                                                                                          | Effect on the user                                                                                                                                                                                                                            | Proposed scope          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| T1  | `availability.astro:111-113`: `bg-cosmic`, glass card `bg-white/10 border-white/10 text-white`, gradient `h1` `from-blue-200 to-purple-200 … text-transparent` | `bg-background`, `bg-card text-card-foreground border`, `text-foreground`                                           | The page ignores the app theme. Changing a token changes nothing here, and the gradient heading reads as a marketing banner rather than a working screen title.                                                                               | in                      |
| T2  | `availability.astro:117`, `:124`, `:151`: error `red-500/30 red-900/30 red-300`, success `green-*`, locked `purple-*` boxes                                    | `destructive` for errors; `muted`/`accent` + `foreground` for status and locked; no success token exists in the set | Three one-off colour families for three message types, with no shared meaning. The user cannot learn "red means error" from the design system, only from this page.                                                                           | in                      |
| T3  | `availability.astro:138-139,143,160,187-188,194-195`: month tabs, weekday header, day cells and window dots use `purple-*`/`blue-100/*`/`white/*`              | `primary`/`accent` for selected and has-windows, `muted-foreground` for secondary text, `border`                    | "Selected day" (`border-purple-200 bg-white/25 ring-1 ring-purple-200`, :188) and "has windows" (`border-purple-300/40 bg-purple-500/15`, :187) are both purple tints, so which day is selected is hard to tell from which days have windows. | in                      |
| T4  | `Layout.astro:14`: `.dark` never applied, no `color-scheme`; `global.css:121-123` renders a white body                                                         | Activate the token theme at the root (Q1)                                                                           | The native `type=time` inputs (`:237,249,293,297`) and the unstyled checkbox (`:304`) render with light-mode UA chrome on a dark card. This is inferred from code, not seen rendered; confirm on the first screenshot.                        | in (global token layer) |

#### Missing shared component

| #   | Evidence                                                                  | Component it shadows                                                                                             | Effect on the user                                                                                                                                                | Proposed scope               |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| C1  | `availability.astro:106-107` `buttonClass`, used at `:258,:269,:299,:313` | `Button` / `buttonVariants` (`ui/button.tsx`)                                                                    | Save, Delete, Add and "Back to dashboard" look identical. The destructive Delete (`:266-271`) is not distinguished from Save, and none of them has a focus style. | in                           |
| C2  | `availability.astro:105` `inputClass`, used at `:243,:255,:293,:297`      | shadcn `Input` (add with `npx shadcn@latest add input`)                                                          | Inputs have no focus ring, no invalid style and no disabled style.                                                                                                | in                           |
| C3  | `availability.astro:116-128,148-157`: three hand-built message boxes      | shadcn `Alert` (add with `npx shadcn@latest add alert`)                                                          | Messages carry no icon or title, only colour, which is weak for colour-blind users (a11y floor).                                                                  | in                           |
| C4  | `availability.astro:303-306`: bare `<input type="checkbox">`              | native checkbox styled with `accent-primary`, or shadcn `checkbox` (new `@radix-ui` dependency, needs hydration) | The repeat toggle is the only unstyled control on the page.                                                                                                       | in (plan picks the approach) |

#### Accidental architecture

| #   | Evidence                                                                                                                                                                                                                                         | What the user sees arriving that way                                                                                                                                                                                                                                  | Proposed scope                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `availability.astro:30,116-120` renders `?error=` verbatim. `lib/availability.ts:229` (`default: return error.message`) passes raw PostgREST text through, as do `update.ts:46` and the page's own read errors at `availability.astro:71,76,82`. | Anyone can send a link that shows arbitrary text as an app error (escaped HTML, so not XSS, but spoofable), and `?updated=1` can fake "Availability saved." Users also see raw Postgres messages. `??=` means a URL error hides a real read failure (`:49,71,76,82`). | in: the view renders messages from a fixed code→text map, not free text                                                         |
| A2  | Error shown only at page top (`:116-120`). The create inputs have no `value` (`:293,297`), the checkbox resets (`:304`), and update rows re-render with DB values (`:242,254`).                                                                  | After "Overlaps an existing window" the user scrolls back down, re-types everything, and cannot tell which row or which repeated date failed. A repeat batch is all-or-nothing (`api/availability/create.ts:35-37`).                                                  | partial: moving the message next to the form fits this view; preserving typed values needs endpoint changes and may be deferred |
| A3  | No `disabled`, pending state or client JS on the page. The only pending UI in the app is `auth/SubmitButton.tsx:12-23` (`useFormStatus`).                                                                                                        | A double click on Add gives a false "Overlaps an existing window" after a successful save, and a double Delete gives a false "Not found, locked or not permitted".                                                                                                    | in or deferred: needs a small island or inline script; the plan decides                                                         |
| A4  | Flash params are sticky (`lib/availability.ts:237-247` puts `updated=1`/`error=` in the redirect URL; nothing strips them).                                                                                                                      | Refresh, bookmark or back/forward shows "Availability saved." or the error again.                                                                                                                                                                                     | deferred candidate                                                                                                              |
| A5  | `middleware.ts:5,35`: `/availability` is protected, but the sign-in redirect has no return URL, and sign-in lands on `/` (`api/auth/signin.ts:19`).                                                                                              | A shared or bookmarked `/availability?month=…&day=…` link opened while signed out lands on `/` after sign-in, and the deep link is lost.                                                                                                                              | deferred: cross-cutting auth flow, not this view                                                                                |
| A6  | No app shell. `Topbar.astro` is used only by `Welcome.astro:18` (index). The only exit is "Back to dashboard" (`availability.astro:313`).                                                                                                        | Once on the page, the only way out is the button at the bottom of a long page. There is no sign-out, no nav, and no link to `/manager/months` for managers.                                                                                                           | deferred: an app-shell change spans every view                                                                                  |
| A7  | `availability.astro:32-37`: an invalid, past or out-of-range `?month`/`?day` falls back silently. `?month=2020-01` shows the first upcoming month with no notice, and the current month is never viewable (`lib/availability.ts:70-73`).         | A link to a past or garbage month shows a different month without saying so.                                                                                                                                                                                          | deferred candidate (low impact)                                                                                                 |
| A8  | A read failure of windows or carry-over (`:70-79`) leaves `windows = []` with forms enabled if the month is unlocked.                                                                                                                            | The red alert sits above a calendar that says "no windows" everywhere, and the user may re-add windows that already exist (the overlap constraint catches it).                                                                                                        | deferred candidate                                                                                                              |

A loading state does not apply: the page is SSR with full-page form POSTs, so there is no client loading state to render.

### States inventory (for the plan's states phase and the kitchen sink)

| State              | Where today                                                      | Observation                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| default            | whole view                                                       | literal classes only (T1–T3)                                                                                                                                                      |
| hover              | `:139` tabs, `:188` day cells, `buttonClass`                     | `hover:bg-white/15` / `hover:bg-white/20`; no token                                                                                                                               |
| focus              | none in the file (0 matches for `focus`)                         | falls back to global `outline-ring/50` (light `--ring` oklch 0.708 at 50%) on a translucent dark card; nothing distinguishes focus from selected (`ring-1 ring-purple-200`, :188) |
| disabled           | none (0 matches for `disabled`)                                  | the locked month hides the forms rather than disabling them (`:227,282`); there is no pending-disabled state (A3)                                                                 |
| error              | `:116-120`                                                       | the only error surface is the top alert (A1, A2)                                                                                                                                  |
| empty              | `:219` "— No windows"; cell aria-label "no windows" `:179`       | no month-level empty state                                                                                                                                                        |
| locked (read-only) | `:148-157`, forms hidden `:227,282`, "(Locked)" tab label `:143` | fail-closed `lockStateUnknown` variant `:153-154`                                                                                                                                 |
| success            | `:121-128`                                                       | sticky flash (A4)                                                                                                                                                                 |

### Visual gate tooling

There is no Playwright or other screenshot-test runner in `package.json` and no `tests/` or `e2e/` directory. Per `/10x-ui`, the gate for this change is a kitchen-sink page plus manual screenshots (desktop and one mobile width). The skill says not to install a runner just to satisfy the gate.

## Code References

- `src/styles/global.css:4`: `dark` custom variant (`.dark *`)
- `src/styles/global.css:6-39` / `:41-73`: `:root` / `.dark` neutral values
- `src/styles/global.css:75-111`: `@theme inline` publishing `--color-*` and `--radius-*`
- `src/styles/global.css:113-115`: `bg-cosmic` hex utility
- `src/styles/global.css:118-123`: base `border-border outline-ring/50`, `body bg-background`
- `src/layouts/Layout.astro:14,21`: plain `<html>`/`<body>`, no theme class
- `src/components/ui/button.tsx:7-37,50`: Button variants, `buttonVariants` export
- `src/components/auth/SubmitButton.tsx:3,12-23`: only Button use; pending state via `useFormStatus`
- `src/pages/availability.astro:105-107`: local `inputClass`/`buttonClass`
- `src/pages/availability.astro:111-128`: backdrop, card, heading, error/success alerts
- `src/pages/availability.astro:130-157`: month nav, locked notice
- `src/pages/availability.astro:159-212`: calendar grid and day cells
- `src/pages/availability.astro:214-310`: selected-day panel, update/delete/create forms
- `src/lib/availability.ts:220-231`: `describeWriteError` (3 mapped codes, raw default)
- `src/lib/availability.ts:237-247`: `availabilityUrl` redirect builder (flash via query string)
- `src/middleware.ts:5,33-36`: protected routes, sign-in redirect without return URL

## Architecture Insights

- **The repo has a token source and one shared component, but its real theme is a copy-pasted literal pattern.** The cosmic backdrop, glass card and gradient `h1` repeat across roughly 8–9 files. Extending the existing shadcn system is the contract, and forking a "cosmic" palette would be a second system, so this change should not codify the cosmic look as new tokens (the user chose the existing neutral set).
- **Activating a theme at the root is a global token-layer edit**, which the skill allows ("one view + global tokens"). The blast radius of adding `.dark`/`color-scheme` on `<html>`, from the inspected code:
  - `body` turns dark (hidden under `bg-cosmic` on every page today).
  - The base `border-border`/`outline-ring` become the dark values.
  - `button.tsx`'s `dark:` variants activate. It is used only by `SubmitButton`, whose background is overridden.
  - `Banner.astro` is unaffected (scoped hex).

  Other pages keep their hard-coded look. Confirm with screenshots of `/`, `/dashboard` and `/auth/signin`.

- **Form-POST + redirect is the established convention** (CLAUDE.md, `lib/availability.ts:237-247`). Message fixes should keep that convention, for example by passing a message **code** in the query string and resolving it through a fixed map in the view, rather than introducing a JSON API.

## Historical Context (from prior changes)

- `context/archive/2026-09-26-employee-availability-management/` (plan, research, plan-brief): no UI or design-token decisions recorded. A search for cosmic, token, glass, shadcn, "dark mode" and "visual" returned no hits in those files. The current view shape came from that change's functional plan.
- `context/foundation/prd.md:74`: FR-007 "simple visual grid" (schedule view, not this one). No design-system requirement is stated in the PRD or `tech-stack.md`.
- `context/foundation/lessons.md` does not exist, so there are no recorded UI pitfalls.

## Related Research

- `context/archive/2026-09-26-employee-availability-management/research.md`: functional research for the same view (data model, RLS, lock semantics).

## Open Questions

1. **Q1 (blocking for the plan): which token theme does `/availability` render in?**
   - (a) Add `class="dark"` (and `color-scheme: dark` in `.dark`) on `<html>` in `Layout.astro`. The view uses `bg-background`/`bg-card`/… and so renders neutral dark, visually close to the other still-cosmic pages. This is the recommended option: smallest global blast radius, and the dark UA chrome fixes T4.
   - (b) Keep light `:root`. The view becomes the only light page in the app, which is jarring when moving from `/dashboard`.
   - (c) Re-value the tokens to cosmic colours. This contradicts the chosen motif and codifies a second palette.
2. **Q2: drop `bg-cosmic` on this view or keep it as the page backdrop?** Dropping it is consistent with (a). Keeping it means one literal utility survives, which should be recorded as a deferred charge.
3. **Q3: success token.** The shadcn neutral set has no `success` role. Either render success with the neutral `Alert` default variant plus an icon, or add a `--success` value/publish pair in `global.css` (a small, justified token addition). The plan decides.
4. **Q4: scope of A2/A3.** Should endpoint changes (preserving typed values, a message-code redirect) and a small client island for the pending state be part of this visual change, or should they be deferred with reasons?
5. **Q5: verify SSR-only React `Button` in `.astro`.** Rendering it without `client:*`, or using `buttonVariants` on native elements, is the expected path. Confirm in phase 1 with a build.
