---
date: 2026-09-29T13:04:42+02:00
researcher: Claude (Opus 5.5) for Redellex
git_commit: 1b5d0281194f6d6e273627069b0db70c1d8e78dc
branch: manager-users-ui-tokens
repository: Redellex/planner
topic: "UI audit of /manager/users against the repo's shadcn neutral tokens and shared components"
tags: [research, ui, design-tokens, shadcn, tailwind, manager, roles]
status: complete
last_updated: 2026-09-29
last_updated_by: Claude (Opus 5.5)
---

# Research: UI audit of /manager/users against the repo's design-system contract

**Date**: 2026-09-29T13:04:42+02:00
**Researcher**: Claude (Opus 5.5) for Redellex
**Git Commit**: 1b5d0281194f6d6e273627069b0db70c1d8e78dc (the working tree adds only untracked tooling dirs and this change folder; every cited `src/`, `scripts/` and `supabase/` file is unmodified at this commit)
**Branch**: manager-users-ui-tokens
**Repository**: Redellex/planner

## Research Question

Per `change.md` and `/10x-ui`, audit the one view `/manager/users` (`src/pages/manager/users.astro`, POST target `src/pages/api/manager/users/role.ts`) in both directions:

- **Source → view:** which tokens and `src/components/ui/` components exist, and which of them this view reads.
- **View → source:** for each literal in the view, which token or component should cover it.

Output: 3–5 charges (plus deferred ones) with file:line and user impact under `## Charges`, grouped as missing tokens, missing shared component and accidental architecture. Also settle the select strategy, error placement and kitchen-sink reuse named in the hand-off.

Scope was one view plus one endpoint, so the investigation ran locally (no sub-agents).

## Summary

- **The contract is live, and this view reads none of it.** The dark token theme is active app-wide (`<html lang="en" class="dark">`, `src/layouts/Layout.astro:13`; `color-scheme: dark`, `src/styles/global.css:43`). `src/components/ui/` ships `alert.tsx`, `button.tsx` and `input.tsx`, and `/availability` renders with them. `users.astro` imports none of them (its imports are `users.astro:2-5`) and uses no semantic token class.
- **12 lines match the hardcoded-value scan** in `users.astro` (lines 31, 32, 36, 43, 49, 51, 57, 59, 69, 72, 80, 93), plus `bg-cosmic` on line 30, a hex-gradient utility at `global.css:115-117`.
- **Each hand-rolled control has a direct replacement in the repo or the registry.** The alerts and buttons map to the existing `Alert`/`Button` (as `DayPanel.astro:49-58,107` already does). The `<select>` maps to shadcn `native-select`, which adds no npm dependency (registry item fetched 2026-09-29; details below).
- **The worst problems are on the message path, not the colours.** `?error=` is rendered verbatim (`users.astro:9,35-38`) and the endpoint forwards raw PostgREST text (`role.ts:31-32`). This is the same spoofable-alert charge `/availability` already fixed with an allow-list (`src/lib/availability.ts`, `AVAILABILITY_FEEDBACK_ERRORS` / `resolveFeedbackError`). The smoke test pins one message: the rejected last-manager demotion must still redirect to `/manager/users?error=…` with text matching `/last manager/i` (`scripts/smoke.mjs:155-162`).
- **No rule keeps the next view on the contract.** `CLAUDE.md` has no UI/token block, and neither the archived plan nor the plan-brief for `availability-ui-tokens` contains a rule step (grep for `CLAUDE.md|agent rules|make it stick|guard` in both files: 0 hits).

## Detailed Findings

### Source → view (what exists, what this view reads)

- **Values:** shadcn neutral `:root` / `.dark` in `src/styles/global.css` (the `.dark` block starts at `:42`, `color-scheme: dark` at `:43`, `--destructive` at `:23` / `:58`), published through `@theme inline`. The archived role map (`context/archive/2026-09-28-availability-ui-tokens/tokens.md`) gives the mapping for page, panel, secondary text, focus, error, success, buttons and inputs.
- **Theme activation:** `Layout.astro:13` sets `class="dark"` on `<html>` for every page, so this view already renders over dark `bg-background`, but the full-screen `bg-cosmic` wrapper (`users.astro:30`) hides it.
- **Components:** `src/components/ui/alert.tsx` (`Alert` with `default`/`destructive` variants; root hard-codes `role="alert"`, `alert.tsx:21-23`), `button.tsx` (variants and `buttonVariants`), `input.tsx` (`Input` with `focus-visible:ring-ring/50 ring-[3px]`, `aria-invalid` and `disabled` styles, `input.tsx:8-13`). There is no select component in `src/components/ui/`.
- **Usage by this view:** 0 imports from `@/components/ui/*`, 0 semantic colour classes, 0 `focus` classes, 0 `disabled` usages (inspected: all 100 lines of `users.astro`).
- **Reference usage elsewhere** (the pattern to copy):
  - Page shell: `availability.astro` renders `min-h-screen bg-background p-4` > `mx-auto max-w-2xl` > `h1 text-2xl font-semibold` (`availability.astro:119-121`).
  - Destructive alert with icon: `DayPanel.astro:49-52` (`Alert variant="destructive"` + `CircleAlert`).
  - Success with `role="status"`: `DayPanel.astro:55-58` (`Alert role="status"` + `AlertTitle`).
  - Submit button in a row: `DayPanel.astro:107` (`Button type="submit" variant="secondary" size="sm" aria-label=…`).
  - Link styled as a button: `availability.astro:152` (`class:list={buttonVariants({ variant: "outline" })}`).
  - Pending state: the inline script at `availability.astro:160-190`, scoped to `form[action^="/api/availability/"]` (so it does not cover `/api/manager/*`), with a `pageshow` re-enable for bfcache.

### shadcn `native-select` (registry, fetched 2026-09-29)

- `npx shadcn@latest view native-select` returns one file, `registry/new-york-v4/ui/native-select.tsx`. Its only imports are `react`, `cn` and `lucide-react` (`ChevronDownIcon`), and it lists no Radix dependency. `lucide-react` is already a dependency of this repo. Install path: `npx shadcn@latest add native-select` (Context7 `/shadcn-ui/ui`, `native-select.mdx`).
- `NativeSelect` renders a wrapper `div` (`has-[select:disabled]:opacity-50`) around a `select` with the same token classes as `Input`: `border-input`, `dark:bg-input/30`, `focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50`, `aria-invalid:border-destructive`. It has a `size` prop (`sm` | `default`).
- `NativeSelectOption` sets `bg-[Canvas] text-[CanvasText]`, i.e. system colours that follow `color-scheme`. That is the token-safe replacement for the `text-black` hack at `users.astro:72`.
- It is a plain server-renderable component (no hooks), so it renders from `.astro` without `client:*`, like `Input` does in `DayPanel.astro:86`.

### Endpoint and message path

- `role.ts` redirects with these `?error=` values: `"Invalid user id"` (`:17-18`), `"Invalid role"` (`:20-21`), `"Supabase is not configured"` (`:25-26`), the raw `error.message` of any failed update (`:31-32`), and `"User not found or not permitted"` (`:34-35`). Success redirects to `/manager/users?updated=1` (`:43`). A self-demotion redirects to `/dashboard` with no message (`:39-41`).
- The last-manager rejection comes from `raise exception 'Cannot demote the last manager'` (`supabase/migrations/20260925120000_create_profiles_and_roles.sql:110`), which has no `errcode`, so PostgREST reports it with the default `P0001` code. The message reaches the user only through the raw pass-through at `role.ts:31-32`.
- The page reads `?error=` and `?updated=1` directly (`users.astro:8-9`) and uses `??=`, so a URL-supplied error hides a real load failure (`users.astro:14,22`).
- **Smoke contract** (`scripts/smoke.mjs`): `/manager/users` returns 403 for an employee (`:143`) and 200 for the manager (`:154`, `:164`). The demotion step expects status 302 with a location starting with `/manager/users?error=` (prefix match, `:195`) and an `error` param matching `/last manager/i` (`:155-162`). No smoke step reads the page body of `/manager/users`.

### Entry points (what happens arriving by other routes)

- Logged out: `middleware.ts` redirects `/manager/*` to `/auth/signin` (`src/middleware.ts:39-42`). A non-manager is rewritten to `/403` (`:43-45`). Both are guarded; no charge.
- Supabase unconfigured: `users.astro:13-14` sets the error, and the page renders the error and "No accounts found." together (`:35-38`, `:48-49`).
- A profile row with an empty email is possible: signup stores `coalesce(new.email, '')` (`supabase/migrations/20260926120000_handle_new_user_null_email.sql:10`). Such a row renders an empty label (`users.astro:58`), a label of `Role for ` (`:64`) and a button name of `Save role for ` (`:79`).

## Charges

Each charge is recorded as **evidence (file:line)**, then **effect on the user**. The scope column is a proposal for `/10x-plan`, not a decision.

### Missing tokens

| #   | Evidence | Token / role that should cover it | Effect on the user | Proposed scope |
| --- | -------- | --------------------------------- | ------------------ | -------------- |
| T1  | `users.astro:30-32`: `bg-cosmic` wrapper, glass card `border-white/10 bg-white/10 text-white backdrop-blur-xl`, gradient `h1` `from-blue-200 to-purple-200 … text-transparent`. `:49,51,57,59`: `text-blue-100/60`, `divide-white/10`, `text-blue-100/90`, `text-purple-200` for "(you)". | page `bg-background text-foreground`; panel `bg-card text-card-foreground border rounded-xl`; `divide-border`; secondary text `text-muted-foreground`; "(you)" as a token-coloured marker (see Q2) | A manager moving between `/availability` and this page sees two different apps, and a token change does not reach this page. The "(you)" marker, the only cue that keeps a manager from demoting themselves by mistake, is a faint purple tint. | in |

### Missing shared component

| #   | Evidence | Component it shadows | Effect on the user | Proposed scope |
| --- | -------- | -------------------- | ------------------ | -------------- |
| C1  | `users.astro:35-47`: hand-built red (`:36`) and green (`:43`) `<p>` message boxes. | `Alert variant="destructive"` + `CircleAlert`; `Alert role="status"` + `CircleCheck` (the `DayPanel.astro:49-58` pattern) | Error and success differ only by colour, with no icon or title; that fails the "not colour alone" floor for colour-blind users. | in |
| C2  | `users.astro:77-83` Save and `:91-95` "Back to dashboard": the same hand-built `border-white/20 bg-white/10 … hover:bg-white/20` string. | `Button variant="secondary" size="sm"` (`DayPanel.astro:107`); `buttonVariants({ variant: "outline" })` on the `<a>` (`availability.astro:152`) | Keyboard focus falls back to the global outline (no `ring` token), and there is no disabled or pending look. The row's primary action looks identical to the page's exit link. | in |
| C3  | `users.astro:66-76`: native `<select>` with `border-white/20 bg-white/10 text-white`, and `<option class="text-black">` at `:72`. No select exists in `src/components/ui/`. | `NativeSelect` / `NativeSelectOption` via `npx shadcn@latest add native-select` (no new npm dependency) | No focus ring and no invalid style. With `color-scheme: dark` (`global.css:43`) the opened option list is likely dark, so `text-black` options may be black on dark and unreadable (inferred from code; confirm on the first screenshot). | in |

### Accidental architecture

| #   | Evidence | What the user sees arriving that way | Proposed scope |
| --- | -------- | ------------------------------------ | -------------- |
| A1  | `users.astro:9,35-38` renders `?error=` verbatim; `role.ts:31-32` forwards raw PostgREST `error.message`; `users.astro:22` shows the raw read error; `??=` lets a URL error hide a real load failure (`:14,22`); `?updated=1` (`:8,40-46`) can be faked. | Anyone can send a manager a link showing arbitrary text as an app error (escaped, so not XSS, but spoofable), or a fake "Role updated.". Real failures show raw database text. | in: a fixed allow-list of role messages, mirroring `resolveFeedbackError` in `src/lib/availability.ts`; the raw error is logged. The last-manager message must still match `/last manager/i` (`smoke.mjs:155-162`). |
| A2  | All feedback renders at the top of the card (`users.astro:35-47`), and the redirect carries no user id (`role.ts:8-9,43`). After a rejected save the row re-renders the database value. | After "Cannot demote the last manager", the row they just changed snaps back with no mark, and on a long list the manager cannot tell which row failed or which row "Role updated." refers to. | in or partial: attach feedback to the row via an extra param after `error=` (keeps the `startsWith` prefix at `smoke.mjs:195`), or keep a top-only message that names the user. The plan decides (Q1). |
| A3  | `users.astro:48-49`: "No accounts found." renders whenever `profiles` is empty, including after a failed or unconfigured load (`:13-14,21-22`). For a manager, RLS returns at least their own row (`users.astro:16`), so an empty list in practice means a load failure. Rows with `email = ''` render an empty label and unnamed controls (`:58,64,79`). | Under a red error, "No accounts found." reads as if every account were gone. A user without an email shows as a blank row whose Save button a screen reader announces as "Save role for". | in: the load-failure state replaces the list and the empty message; blank emails get a fallback label (for example the user id). |
| A4  | `CLAUDE.md` has no UI/token block: only the shadcn location line mentions shadcn (`CLAUDE.md:43`), and nothing says to use tokens or avoid literals. The archived `availability-ui-tokens` plan had no rule step. `lint-staged` runs only `eslint --fix` / `prettier --write` (`package.json`). Seven other files still use `bg-cosmic` (`Welcome.astro:5`, `403.astro:9`, `auth/{confirm-email:22,signin:9,signup:9}.astro`, `dashboard.astro:9`, `manager/months.astro:36`). | The next manager view (or an edit to `/manager/months`) copies the nearest literal-styled page, and the drift comes back. This change and the previous one would both be undone one view at a time. | in: add the UI rule block to `CLAUDE.md`; the check (a grep in lint-staged scoped to the cleaned views) is proposed, and the learner decides. |

### Deferred (recorded, not planned here)

| #   | Evidence | Reason |
| --- | -------- | ------ |
| D1  | Other `bg-cosmic`/glass/gradient views (list under A4) | `/10x-ui`: one view per change; `/manager/months` is the natural next change. |
| D2  | Sticky flash: `?updated=1` / `?error=` stay in the URL (`role.ts:8-9,43`), so refresh or back shows the message again. | Needs a flash mechanism (cookie/session), not a UI concern; `/availability` deferred the same charge (archived plan, "What We're NOT Doing"). |
| D3  | Self-demotion redirects to `/dashboard` with no confirmation (`role.ts:39-41`). | The message would render on `/dashboard`, a different view. |
| D4  | No pending state on Save (no script covers `/api/manager/*`; the `/availability` script is scoped at `availability.astro:165`). A double click sends the same update twice. | Low impact: the update is idempotent, so no false error appears (unlike `/availability`). The plan may still include it cheaply for the `disabled` state (Q3). |
| D5  | No app shell or nav (only "Back to dashboard", `users.astro:90-97`). | Spans every view; `/availability` deferred the same charge (A6 there). |

## States inventory (for the plan's states phase and the kitchen sink)

| State | Where today | Observation |
| ----- | ----------- | ----------- |
| default | whole view | literal classes only (T1) |
| hover | `:80`, `:93` `hover:bg-white/20` | no token; the select has no hover |
| focus-visible | none (0 `focus` classes in the file) | global `outline-ring/50` only; no `ring` on select or buttons (C2, C3) |
| disabled | none | no pending or disabled state (D4); the select and Save are always enabled |
| error | `:35-38` top box | colour-only (C1), verbatim URL text (A1), not tied to a row (A2) |
| empty | `:48-49` | in practice a load failure (A3) |
| loading | N/A | SSR plus full-page form POST: no client loading state to render (same as `/availability`) |
| success | `:40-47` | colour-only (C1), fakeable (A1), sticky (D2) |

Visual gate tooling: there is no screenshot-test runner in `package.json`. The gate is a dev-only kitchen sink, following `src/pages/dev/availability-states.astro` (it sets `Astro.response.status = 404` when `!import.meta.env.DEV`, `:24-27`, and renders the real components from fixture data), plus manual screenshots at desktop and one mobile width.

## Code References

- `src/pages/manager/users.astro:8-26`: flash params, Supabase client, profiles query, `??=` error handling
- `src/pages/manager/users.astro:30-32`: `bg-cosmic`, glass card, gradient heading
- `src/pages/manager/users.astro:35-47`: hand-built error/success boxes
- `src/pages/manager/users.astro:48-89`: empty message, list, per-row form (select + Save)
- `src/pages/manager/users.astro:90-97`: "Back to dashboard" link
- `src/pages/api/manager/users/role.ts:8-9,17-43`: redirect helper and every `?error=` value
- `supabase/migrations/20260925120000_create_profiles_and_roles.sql:90-120`: last-manager trigger (`raise exception` at `:110`)
- `supabase/migrations/20260926120000_handle_new_user_null_email.sql:10`: empty-email profiles
- `scripts/smoke.mjs:143,154-164,195`: manager-page status checks, last-manager redirect contract, prefix matching
- `src/middleware.ts:39-45`: manager route guard
- `src/layouts/Layout.astro:13`, `src/styles/global.css:43,115-117`: dark theme activation, `color-scheme`, `bg-cosmic`
- `src/components/availability/DayPanel.astro:49-58,107`, `src/pages/availability.astro:152,160-190`: reference usage of `Alert`, `Button`, `buttonVariants`, pending script
- `src/lib/availability.ts`: `AVAILABILITY_FEEDBACK_ERRORS`, `resolveFeedbackError`, `logAvailabilityError` (allow-list pattern for A1)
- `src/pages/dev/availability-states.astro`: kitchen-sink pattern

## Architecture Insights

- **Extend, do not fork.** The token layer, the dark theme and three components are already in place and proven on `/availability`. This change is the "fresh starter whose screens ignore its own tokens" playbook, with phase 1 reduced to adding `native-select`; there are no token values to choose.
- **Message allow-lists are per view today.** `/availability` keeps its messages and allow-list in `src/lib/availability.ts`. The role endpoint has five fixed messages plus one database-originated message. Either a small `src/lib/roles.ts`-adjacent list mirrors the availability pattern, or both are generalised; generalising touches `/availability`, which is outside this change's one-view scope.
- **Form-POST + redirect stays the convention** (`CLAUDE.md`, `role.ts`). Row-level feedback fits it as an extra query param; no JSON API is needed.

## Historical Context (from prior changes)

- `context/archive/2026-09-28-availability-ui-tokens/research.md`: recorded this view as having 12 literal lines, the glass card at `manager/users.astro:31`, the secondary-button string at `:80,93`, the red alert at `:36` and the green status at `:43`. **Supported**: all five still hold at this commit.
- Same file, "Dark mode is never switched on … `Layout.astro:14` renders a plain `<html lang="en">`". **Contradicted now**: that change added `class="dark"` (`Layout.astro:13`) and `color-scheme: dark` (`global.css:43`).
- Same file, "`src/components/ui/` holds exactly one shadcn component, `button.tsx`". **Contradicted now**: `alert.tsx` and `input.tsx` were added by that change.
- `context/archive/2026-09-28-availability-ui-tokens/plan.md` ("What We're NOT Doing"): deferred "Other views: … manager pages … each needs its own change". **Supported**: this change is that follow-up for `/manager/users`.
- `context/archive/2026-09-28-availability-ui-tokens/tokens.md`: the token role map this change reuses. **Supported** for page, panel, secondary text, focus, error, success, buttons and inputs; it has no entry for selects (C3 adds one) or for a "self" marker (Q2).
- `context/archive/2026-09-25-role-aware-access-control/`: created this view and the endpoint; its contracts (RLS, last-manager trigger, form-POST + redirect) are unchanged here.
- `context/foundation/lessons.md` does not exist.

## Related Research

- `context/archive/2026-09-28-availability-ui-tokens/research.md`: the same audit for `/availability`.
- `context/archive/2026-09-25-role-aware-access-control/`: functional research for roles and this view.

## Open Questions

1. **Q1: row-level feedback (A2).** (a) Add `&user=<id>` after `error=`/`updated=1` and render the `Alert` inside that row, keeping a top alert only for load failures. This keeps the smoke prefix. (b) Keep feedback at the top but name the user in the text. Recommendation: (a), matching how `/availability` moved write feedback into the day panel.
2. **Q2: the "(you)" marker.** No badge component exists; shadcn `badge` lists a Radix dependency in the v4 registry, which would be a new dependency. Alternatives: `text-muted-foreground` text, or a `bg-secondary text-secondary-foreground rounded-md px-1.5` pill built from tokens. Recommendation: token text or pill; no new dependency.
3. **Q3: pending/disabled state (D4).** Either deferred (idempotent writes), or a copy of the `/availability` inline script scoped to `form[action^="/api/manager/users/"]` so the `disabled` cell of the 7-state matrix is exercised live, not only in the kitchen sink.
4. **Q4: the check half of "make it stick" (A4).** A grep of the hardcoded-value regex over the cleaned views (`availability.astro`, `components/availability/*`, `manager/users.astro`) as a lint-staged step needs no new dependency. The learner decides whether to add it or keep the rule only.
5. **Q5: message list location (A1).** A users-only list next to the endpoint, or a shared helper also used by `/availability` (the latter touches a second view).
