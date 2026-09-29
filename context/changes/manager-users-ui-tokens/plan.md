# /manager/users on Design Tokens Implementation Plan

## Overview

Rebuild the `/manager/users` view on the design-system contract that `/availability` already uses:

- the shadcn "new-york" neutral dark tokens in `src/styles/global.css`;
- the repo's shared components (`Alert`, `Button`/`buttonVariants`), plus shadcn `native-select` added through the CLI.

Along the way, close the view's accidental-architecture charges:

- spoofable or raw error text;
- feedback far from the row it concerns;
- a load failure rendered as "No accounts found.";
- blank rows for accounts without an email;
- no rule that keeps the next view on the contract.

The result is gated by a dev-only kitchen sink and screenshots, and ends with a `CLAUDE.md` UI rule plus a scoped pre-commit colour-literal check. This is a `/10x-ui` change: one view plus its endpoint, with no new token values.

## Current State Analysis

(From `research.md`, at commit 1b5d028.)

- **The contract is live, and this view reads none of it.** `<html class="dark">` (`src/layouts/Layout.astro:13`) and `color-scheme: dark` (`global.css:43`) are active app-wide. `src/components/ui/` has `alert.tsx`, `button.tsx` and `input.tsx`. `users.astro` imports none of them (`:2-5`) and uses no semantic class. 12 lines match the hardcoded-value scan (31, 32, 36, 43, 49, 51, 57, 59, 69, 72, 80, 93), plus `bg-cosmic` (`:30`).
- **Hand-rolled controls.** Red and green `<p>` boxes (`:35-47`); Save and "Back to dashboard" share one `bg-white/10` string (`:80`, `:93`); a native `<select>` with an `<option class="text-black">` hack (`:66-76`). No select exists in `src/components/ui/`.
- **Message path.**
  - `?error=` is rendered verbatim (`users.astro:9,35-38`).
  - `role.ts:31-32` forwards the raw PostgREST `error.message`, and `users.astro:22` shows the raw read error.
  - `??=` lets a URL error hide a real load failure (`:14,22`).
  - All feedback renders at the top of the card, and the redirect carries no user id (`role.ts:8-9,43`).
- **Empty and blank states.** "No accounts found." renders under a load error (`:48-49`). A profile can have `email = ''` (`20260926120000_handle_new_user_null_email.sql:10`), which renders an empty label and the accessible names `Role for ` / `Save role for ` (`:58,64,79`).
- **Smoke contract** (`scripts/smoke.mjs`):
  - `/manager/users` returns 403 for an employee (`:143`) and 200 for the manager (`:154`, `:164`).
  - The last-manager demotion must return 302 with a location that *starts with* `/manager/users?error=` (prefix match at the step runner) and an `error` param matching `/last manager/i` (`:155-162`).
  - No step reads the page body.
- **The last-manager message has no `errcode`.** `raise exception 'Cannot demote the last manager'` (`supabase/migrations/20260925120000_create_profiles_and_roles.sql:110`) arrives as generic `P0001`, so the only reliable signal is the message text.
- **No guard.** `CLAUDE.md` has no UI block. lint-staged runs only `eslint --fix` / `prettier --write` (`package.json:58-65`).

## Desired End State

- **No literal colours.** `/manager/users` and its components contain no palette class, hex, `bg-cosmic` or gradient text. Every colour, radius and state comes from tokens or from `Alert`, `Button`/`buttonVariants` and `NativeSelect`.
- **Shell.** The page shell matches `/availability`: `min-h-screen bg-background p-4` > `mx-auto max-w-2xl`, `h1 text-2xl font-semibold`, the list in a `bg-card` panel, and "Back to dashboard" as `buttonVariants({ variant: "outline" })`.
- **Row feedback.**
  - The endpoint redirects with `&user=<id>` after `error=`/`updated=1`.
  - The page shows the resulting `Alert` (destructive + `CircleAlert`, or `role="status"` + `CircleCheck`) inside the matching row.
  - Feedback whose `user` matches no loaded row falls back to a top `Alert`.
- **Allow-listed messages only.** The endpoint and the page use a fixed set of messages. Unknown `?error=` text becomes a generic message. Raw DB errors are logged with `console.error` and never shown. The last-manager rejection still reads "Cannot demote the last manager".
- **Load failure.** A failed or unconfigured load shows only a destructive `Alert`, with no list and no "No accounts found.". The empty message remains only for a truly empty result.
- **Self marker and blank emails.** The manager's own row carries a token-built "You" pill. A row with no email shows "No email · <first 8 chars of id>", and its controls are named "Role for user <short id>" / "Save role for user <short id>".
- **Pending state.** Clicking Save disables it with `aria-busy="true"` until navigation, and it is re-enabled on a bfcache restore.
- **Visual gate.** `/dev/manager-users-states` renders every state from fixtures in dev and returns 404 in production builds. Before and after screenshots at 1280px and 390px are saved in the change folder.
- **Guard.** `CLAUDE.md` has a UI block outside the 10x-cli managed block. `npm run check:ui` and a lint-staged step reject colour literals in the cleaned views and kitchen sinks.
- **Contracts intact.** `npm run smoke` passes unchanged. `/availability` looks and behaves unchanged.

### Key Discoveries:

- `src/pages/availability.astro:119-121,148-154` is the page-shell pattern to copy, including the top load-error `Alert` and the outline back link.
- `src/components/availability/DayPanel.astro:48-59` is the feedback pattern: destructive `Alert` + `CircleAlert`, and `Alert role="status"` + `CircleCheck` + `AlertTitle`. `Alert` hard-codes `role="alert"`, so status notices override it.
- `src/pages/availability.astro:160-192` is the pending script to copy: a delegated `submit` listener on a path prefix plus a `pageshow` re-enable.
- `src/lib/availability.ts:221-283` is the allow-list pattern: message constants, `AVAILABILITY_FEEDBACK_ERRORS`, `resolveFeedbackError`, `logAvailabilityError`, and `describeWriteError` with a logged generic fallback.
- `src/pages/dev/availability-states.astro:22-27` is the kitchen-sink pattern: `Astro.response.status = 404` when `!import.meta.env.DEV`, fixtures only, no DB.
- shadcn `native-select` (new-york v4) imports only `react`, `cn` and `lucide-react`, so it adds no new npm dependency. `NativeSelectOption` uses `bg-[Canvas] text-[CanvasText]`, which follows `color-scheme`.
- The current `/availability` files have 0 colour-literal hits; the only scan hits are sizes (`ring-[3px]`, `text-[10px]`). A colour-only check therefore passes on them today.

## What We're NOT Doing

These are the deferred charges from `research.md`, each with its reason:

- **D1, other views** (`/manager/months`, `/dashboard`, auth pages, 403, `Welcome`, still on `bg-cosmic`): one view per change. `/manager/months` is the natural next change.
- **D2, sticky or fakeable flash.** `?updated=1`/`?error=` stay in the URL, and a hand-made `?updated=1&user=<id>` still shows "Role updated.". Fixing it needs a flash mechanism (cookie or session), which is not a UI concern; `/availability` deferred the same charge.
- **D3, no confirmation after self-demotion.** The redirect to `/dashboard` stays silent; a message would render on a different view.
- **D5, app shell / nav.** It spans every view.
- **Sharing the allow-list or pending script with `/availability`.** Generalising either would touch a second view; this change keeps users-only copies.
- **Arbitrary-value (`-[Npx]`) enforcement in the check.** The pre-commit check targets colour literals only. Size arbitraries such as shadcn's `ring-[3px]` stay a rule in `CLAUDE.md`, reviewed by hand.
- **CI step for the check.** It stays pre-commit plus `npm run check:ui`; `.github/workflows/ci.yml` is unchanged.
- **New dependencies.** No shadcn `badge` (Radix), no `label`, no Playwright, no theme toggle, and no token value changes.

## Implementation Approach

Follow the `/10x-ui` order: library, then contract, then the one view, then states, then guard.

- **Phase 1** adds `native-select` and records the role map, without touching the view.
- **Phase 2** fixes the message contract in plain TypeScript, so smoke can verify it before any markup changes.
- **Phase 3** rebuilds the view from a reusable row component.
- **Phase 4** adds the pending state, the kitchen sink and the screenshots.
- **Phase 5** writes the rule and the check.

Everything stays form-POST + redirect with server-rendered HTML. The only client JS is the small inline pending script.

**Charge → phase:** T1 → 3; C1 → 3; C2 → 3 (and 4 for focus/pending); C3 → 1 + 3; A1 → 2; A2 → 2 (URL) + 3 (render); A3 → 3; A4 → 5; D4 → 4 (pulled in).

## Critical Implementation Details

- **Smoke prefix.** Every error redirect must keep `error=` as the *first* query param (`/manager/users?error=<enc>&user=<id>`), because the smoke runner matches the location with `startsWith("/manager/users?error=")`. The last-manager message text must still match `/last manager/i`.
- **Options must be React children, not Astro children.** Astro passes an `.astro` file's children to a React component as a pre-rendered static HTML slot (a slot wrapper element). Inside `<select>`, that is invalid markup, and it also bypasses React's `defaultValue` → `selected` handling. Render `NativeSelect` and its `NativeSelectOption`s together inside a small React component (`RoleSelect.tsx`) that sets `defaultValue`. The page renders it from `.astro` without `client:*`. Verify in the page source that the current role's `<option>` carries `selected` and that no slot element sits inside `<select>`.
- **Pending script and bfcache.** As on `/availability`: disabling the submitter inside `submit` does not cancel native submission, and Save carries no `name`, so no form data is lost. Re-enable on `pageshow` when `event.persisted`.

## Phase 1: Library and token map

### Overview

Capture the "before" state, add shadcn `native-select` through the CLI, and record the role map this view uses. No view changes.

### Changes Required:

#### 1. Baseline screenshots

**File**: `context/changes/manager-users-ui-tokens/screenshots/before/`

**Intent**: Record the current view so later phases have a visual delta to explain.

**Contract**: `/manager/users` (signed in as the seeded manager) at 1280px and 390px, plus `/manager/users?error=Cannot%20demote%20the%20last%20manager` at 1280px, and `/availability` at 1280px as the unchanged reference. Files are named `<route-slug>-<width>.png`.

#### 2. Add `native-select`

**File**: `src/components/ui/native-select.tsx` (generated)

**Intent**: Bring in the missing select through the stack's own path, instead of a hand-rolled one.

**Contract**: `npx shadcn@latest add native-select`. `alert.tsx`, `button.tsx` and `input.tsx` are not overwritten, and `package.json`/`package-lock.json` gain no dependency. The generated file is kept as generated, apart from lint/format fixes.

#### 3. Token role map

**File**: `context/changes/manager-users-ui-tokens/tokens.md`

**Intent**: Deposit the role → token/component mapping for this view, extending the archived `/availability` map instead of re-deriving it.

**Contract**:

- A pointer to `context/archive/2026-09-28-availability-ui-tokens/tokens.md` for the rows it reuses: page, panel, secondary text, focus, error, success, buttons, inputs.
- New rows:
  - select → `NativeSelect size="sm"` via `RoleSelect.tsx`;
  - self marker → "You" pill `rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground` (a token composition, not a new component);
  - list divider → `divide-y` over the base `border-border`;
  - row feedback → `Alert` inside the row;
  - missing-email label → `text-muted-foreground`.
- A one-line source note: shadcn new-york, `baseColor: neutral`, no value changes.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- No new dependencies: `git diff --quiet -- package.json package-lock.json`
- `src/components/ui/native-select.tsx` exists and the other ui components are unchanged: `git diff --quiet -- src/components/ui/alert.tsx src/components/ui/button.tsx src/components/ui/input.tsx`

#### Manual Verification:

- Baseline screenshots exist in `screenshots/before/` for the routes and widths listed above
- `tokens.md` lists every row above and points to the archived map

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Message contract

### Overview

Make every message the view can show come from a fixed set, never show raw database text, and carry the affected user id in the redirect. The smoke script passes unchanged.

### Changes Required:

#### 1. Users message module

**File**: `src/lib/manager-users.ts` (new)

**Intent**: Give the role endpoint and the page one home for user-facing messages, the redirect URL and the account label, mirroring the `/availability` allow-list without touching it.

**Contract**:

- `USER_ID_PATTERN`, moved from `role.ts:5`.
- Message constants:
  - `INVALID_USER_ID_ERROR` "Invalid user id"
  - `INVALID_ROLE_ERROR` "Invalid role"
  - `SUPABASE_NOT_CONFIGURED_ERROR` "Supabase is not configured"
  - `USER_NOT_FOUND_ERROR` "User not found or not permitted"
  - `LAST_MANAGER_ERROR` "Cannot demote the last manager"
  - `GENERIC_ROLE_WRITE_ERROR` "Could not update the role. Try again."
  - `GENERIC_USERS_LOAD_ERROR` "Could not load accounts. Reload the page."
  - `ROLE_UPDATED_MESSAGE` "Role updated."
- A readonly `ROLE_FEEDBACK_ERRORS` set of the six write-side errors.
- `resolveRoleFeedbackError(param: string | null): string | null`: `null` for a missing or empty param, the param when it is in the set, `GENERIC_ROLE_WRITE_ERROR` otherwise.
- `parseFeedbackUser(param: string | null): string | null`: the param if it matches `USER_ID_PATTERN`, else `null`.
- `logManagerUsersError(context: string, error: unknown): void`, which calls `console.error`.
- `describeRoleWriteError(error: { code: string; message: string }): string`: `LAST_MANAGER_ERROR` when `error.message` equals the trigger text; otherwise it logs `{code, message}` and returns `GENERIC_ROLE_WRITE_ERROR`.
- `managerUsersUrl(result: { error: string } | { updated: true }, userId?: string): string`. It builds `/manager/users?error=<enc>` or `/manager/users?updated=1`, then appends `&user=<id>` when a valid id is given. The first param is always `error`/`updated` (see Critical Implementation Details).
- `accountLabel(profile: { id: string; email: string }): { text: string; missingEmail: boolean; accessibleName: string }`: the email, or "No email · <id.slice(0, 8)>" with the accessible name "user <id.slice(0, 8)>".

#### 2. Endpoint uses the module

**File**: `src/pages/api/manager/users/role.ts`

**Intent**: Stop forwarding raw PostgREST text, and tell the page which row the result belongs to.

**Contract**:

- Every redirect goes through `managerUsersUrl` with the matching constant.
- An invalid id redirects without `user`. Every later branch passes the validated `userId`.
- The update error goes through `describeRoleWriteError`.
- Success → `managerUsersUrl({ updated: true }, userId)`.
- The self-demotion redirect to `/dashboard` is unchanged.
- RLS and the trigger stay the enforcement.

#### 3. Page splits feedback from load errors

**File**: `src/pages/manager/users.astro` (frontmatter only)

**Intent**: Separate "result of the last save" (from the URL, untrusted) from "this page failed to load", and never render untrusted or raw text.

**Contract**:

- `feedbackError = resolveRoleFeedbackError(url error param)`.
- `saved = updated === "1" && !feedbackError`.
- `feedbackUser = parseFeedbackUser(url user param)`.
- `loadError` is `SUPABASE_NOT_CONFIGURED_ERROR` when the client is null, or `GENERIC_USERS_LOAD_ERROR` (raw error logged) when the query fails. It no longer uses `??=` on the URL value.
- In this phase, the existing top box renders `loadError ?? feedbackError`, and the green box renders when `saved`. Placement changes in Phase 3.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- Smoke passes against a local server with the seeded DB: `npm run smoke`
- No raw message reaches a redirect or the page: `grep -nE 'error\.message|queryError\.message' src/pages/api/manager/users/role.ts src/pages/manager/users.astro` returns nothing

#### Manual Verification:

- `/manager/users?error=Your%20account%20is%20suspended` shows "Could not update the role. Try again."
- Demoting the last manager from the UI shows "Cannot demote the last manager", and the URL is `/manager/users?error=Cannot%20demote%20the%20last%20manager&user=<id>`
- Promoting the seeded employee shows "Role updated.", and the URL ends with `&user=<employee id>` (set the employee back afterwards)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: The view on tokens and shared components

### Overview

Extract the row into a component the kitchen sink can reuse, rebuild the view on tokens and shared components, move save feedback into the affected row, and give load failures and blank emails real states.

### Changes Required:

#### 1. Role select wrapper

**File**: `src/components/manager/RoleSelect.tsx` (new)

**Intent**: Render `NativeSelect` together with its options in React, so the current role is preselected and the markup inside `<select>` is valid (see Critical Implementation Details).

**Contract**:

- Props `{ id: string; name: string; value: AppRole }`.
- Renders `NativeSelect size="sm"` with `id`, `name` and `defaultValue={value}`, and one `NativeSelectOption` per entry in `APP_ROLES`. It sets no `aria-label`: the row's `sr-only` `<label for={id}>` names it "Role for <accessibleName>".
- No hooks and no state, so it is server-rendered without `client:*`.

#### 2. User row

**File**: `src/components/manager/UserRoleRow.astro` (new)

**Intent**: Render one account with its role form and any feedback about it, from tokens and shared components only.

**Contract**:

- Props `{ profile: { id; email; role }; isSelf: boolean; feedback: { kind: "error" | "success"; message: string } | null; pending?: boolean; idPrefix?: string }`.
- Account text:
  - uses `accountLabel`;
  - a missing email renders "No email" in `text-muted-foreground` with the short id;
  - the self row adds the "You" pill from `tokens.md`.
- Form:
  - `method="POST" action="/api/manager/users/role"`;
  - a native hidden `userId` input;
  - an `sr-only` `<label for>` "Role for <accessibleName>";
  - `RoleSelect`;
  - `Button type="submit" variant="secondary" size="sm"` "Save", with `aria-label` "Save role for <accessibleName>";
  - `pending` renders Save `disabled aria-busy="true"`.
- Feedback renders as a full-width `Alert` below the account/form line:
  - error → `Alert variant="destructive"` + `CircleAlert` + `AlertDescription`;
  - success → `Alert role="status"` + `CircleCheck` + `AlertTitle`.
- Layout: `li` with a `flex flex-wrap items-center justify-between gap-3` line that wraps at 390px without horizontal scroll.

#### 3. Page composition

**File**: `src/pages/manager/users.astro`

**Intent**: Keep data loading in the page, compose the rows, and style the page only with tokens.

**Contract**:

- Remove `bg-cosmic`, the glass card, the gradient `h1`, both hand-built message boxes and every palette class.
- Shell as in `availability.astro:119-121`, with the list in `rounded-xl border bg-card p-4 text-card-foreground` and `ul class="divide-y"`.
- `loadError` → destructive `Alert` + `CircleAlert` in place of the list, and nothing else renders in the panel.
- Otherwise:
  - an empty `profiles` list → `text-muted-foreground` "No accounts found.";
  - feedback (`feedbackError` → error, `saved` → success with `ROLE_UPDATED_MESSAGE`) is passed to the row whose id equals `feedbackUser`;
  - if no row matches, it renders as a top `Alert` above the panel.
- "Back to dashboard" → `<a class:list={buttonVariants({ variant: "outline" })}>`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- Smoke passes: `npm run smoke`
- No literal colours in the view: `grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b|bg-cosmic|bg-gradient|text-transparent|backdrop-blur' src/pages/manager/users.astro src/components/manager/*` returns nothing
- No hydration directives: `grep -n 'client:' src/pages/manager/users.astro src/components/manager/*` returns nothing

#### Manual Verification:

- `/manager/users` renders in the neutral dark theme at 1280px and 390px with no horizontal scroll, and looks like the same app as `/availability`
- The page source shows `selected` on each row's current role option and no slot wrapper element inside `<select>`
- After a rejected last-manager demotion, the destructive alert appears inside the manager's own row; after a successful change, "Role updated." appears inside the changed row
- The self row shows the "You" pill; a profile with `email = ''` (set one in Studio, then restore it) shows "No email · <short id>", and a screen reader or the accessibility tree names its Save "Save role for user <short id>"

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: States and visual gate

### Overview

Add the live pending state, build the kitchen sink that shows all seven states, and run the screenshot gate.

### Changes Required:

#### 1. Pending submit state

**File**: `src/pages/manager/users.astro` (Astro `<script>`)

**Intent**: Exercise the `disabled` state live and stop double clicks from sending the same update twice.

**Contract**:

- A copy of the `availability.astro:160-192` pattern with the prefix `/api/manager/users/`.
- The delegated `submit` listener sets `submitter.disabled = true` and `aria-busy="true"`.
- A `pageshow` listener with `event.persisted` clears both.
- No framework island.

#### 2. Kitchen sink

**File**: `src/pages/dev/manager-users-states.astro` (new)

**Intent**: Render every state of the view side by side from fixtures, using the real components, as review evidence and the visual gate.

**Contract**:

- Outside dev, `Astro.response.status = 404` with an empty body, as in `availability-states.astro:22-27`. No DB access.
- A header comment names the change.
- Labelled sections:
  - rows: default employee; self manager with the "You" pill; missing email; row error (`LAST_MANAGER_ERROR` on the self row); row success; pending (Save disabled);
  - page level: load failure (destructive `Alert`, no list), true-empty list, and top-level fallback feedback (`INVALID_USER_ID_ERROR`);
  - a note: "loading — N/A: SSR + full-page form POST".
- Each row gets a unique `idPrefix`.
- Focus and hover are captured in screenshots by keyboard and pointer, not faked with classes.

#### 3. Screenshots

**File**: `context/changes/manager-users-ui-tokens/screenshots/after/`

**Intent**: Record the visual delta for review.

**Contract**:

- The kitchen sink and `/manager/users` at 1280px and 390px.
- One screenshot each with keyboard focus on a `RoleSelect`, on Save, and on "Back to dashboard".
- One with the pointer hovering Save.
- `/availability` at 1280px (unchanged).
- A short `screenshots/README.md` explaining the before → after delta, and marking the 7-state matrix cell by cell as shown or N/A with a reason.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- Smoke passes: `npm run smoke`
- The kitchen sink is dev-only: against `npm run preview`, `curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/dev/manager-users-states` prints `404`
- No literal colours in the kitchen sink: the Phase 3 grep run on `src/pages/dev/manager-users-states.astro` returns nothing

#### Manual Verification:

- `/dev/manager-users-states` in dev shows every row and page-level state listed above, readable at 1280px and 390px
- A visible token focus ring appears on the select, Save and "Back to dashboard" when tabbing; tab order runs row by row (select → Save)
- Clicking Save disables it until the redirect; a fast double click sends one POST (network tab); Back after a save restores an enabled Save
- `screenshots/after/` and `screenshots/README.md` exist, and every 7-state cell is shown or marked N/A with a reason

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Make it stick

### Overview

Tell the next agent where the contract lives, and fail a commit that brings colour literals back into the views that are already clean.

### Changes Required:

#### 1. UI rule block

**File**: `CLAUDE.md`

**Intent**: Give the next agent the contract in the rules file it already reads, outside the CLI-managed block that is rewritten on every `get`.

**Contract**:

- A new `### UI` subsection under `## Architecture`, before `<!-- BEGIN @przeprogramowani/10x-cli -->`. It says:
  - tokens live in `global.css` `:root`/`.dark` and are published via `@theme inline`; the app is dark via `class="dark"` on `<html>`;
  - a short role map: page, panel, secondary text, focus, error/success `Alert`, `Button`/`buttonVariants`, `Input`, `NativeSelect` via a React wrapper, the "You" pill;
  - check `src/components/ui/` before building a control, and add missing ones with `npx shadcn@latest add <name>`;
  - render ui components from `.astro` without `client:*`; pass options or other structured children from a React wrapper, not as Astro children;
  - no literal colours, palette classes, `bg-cosmic` or gradient text in views, and no one-off arbitrary values;
  - feedback goes next to the control it concerns, from an allow-list (`src/lib/availability.ts`, `src/lib/manager-users.ts`);
  - kitchen sinks live at `src/pages/dev/*-states.astro` (dev-only 404 pattern);
  - views still on `bg-cosmic` are legacy and must not be copied.
- Commands gains `npm run check:ui`, and the pre-commit line mentions it.
- The Roles bullet's manager-UI redirect note becomes `?updated=1&user=<id>` / `?error=…&user=<id>`.

#### 2. Colour-literal check

**File**: `scripts/check-ui-literals.mjs` (new), `package.json`

**Intent**: A dependency-free check that fails when a cleaned view regains a colour literal. The scope list is its single source of truth.

**Contract**:

- The script holds the scoped list:
  - `src/pages/availability.astro`, `src/pages/manager/users.astro`;
  - `src/components/availability/`, `src/components/manager/`;
  - `src/pages/dev/availability-states.astro`, `src/pages/dev/manager-users-states.astro`.
- With file arguments, it checks only the arguments inside that scope (normalising Windows backslashes and absolute paths to repo-relative). With no arguments, it checks the whole scope.
- It reports `file:line: match` and exits 1 on any hit of the Phase 3 colour regex (without the arbitrary-size part).
- `package.json`:
  - adds `"check:ui": "node scripts/check-ui-literals.mjs"`;
  - lint-staged gains a `"*.{astro,tsx}"` entry running `node scripts/check-ui-literals.mjs`. The existing `eslint --fix` entry is unchanged.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- The whole scope is clean: `npm run check:ui` exits 0
- The check catches a regression: a temporary `src/components/manager/Probe.astro` containing `text-red-300` makes `npm run check:ui` exit 1 with `Probe.astro:1` in the output (delete the probe afterwards)
- Files outside the scope are ignored: `node scripts/check-ui-literals.mjs src/pages/dashboard.astro` exits 0

#### Manual Verification:

- The `### UI` block sits above `<!-- BEGIN @przeprogramowani/10x-cli -->` and reads as a complete, short contract
- Committing a staged scoped file that contains `bg-white/10` is rejected by the pre-commit hook (then revert)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None: the repo has no unit-test runner, and adding one is out of scope. `src/lib/manager-users.ts` stays pure, so a later runner can cover `resolveRoleFeedbackError`, `describeRoleWriteError`, `managerUsersUrl` param order and `accountLabel`.

### Integration Tests:

- `npm run smoke` after Phases 2–4 covers the 403/200 access checks and the last-manager redirect contract (prefix plus `/last manager/i`).

### Manual Testing Steps:

1. As the seeded manager, demote yourself (last manager) and check that the error appears in your own row.
2. Promote `employee@example.com`, check "Role updated." in that row, then demote them back.
3. Open `/manager/users?error=<arbitrary text>` and `?updated=1&user=<unknown uuid>`, and check for the generic message and the top fallback.
4. Tab through the page at 390px: focus ring on each control, no horizontal scroll.
5. Walk `/dev/manager-users-states` against the 7-state matrix.

## Performance Considerations

None: the same single `profiles` query, server-rendered, plus a ~20-line inline script.

## Migration Notes

No schema change and no type regeneration. The `&user=` param is additive; old `?error=` / `?updated=1` links still render (as a top alert, with unknown text replaced by the generic message).

## References

- Research: `context/changes/manager-users-ui-tokens/research.md`
- Previous UI change: `context/archive/2026-09-28-availability-ui-tokens/plan.md`, `tokens.md`
- Page shell and pending script: `src/pages/availability.astro:119-154,160-192`
- Feedback pattern: `src/components/availability/DayPanel.astro:48-59`
- Allow-list pattern: `src/lib/availability.ts:221-283`
- Kitchen-sink pattern: `src/pages/dev/availability-states.astro:22-27`
- Smoke contract: `scripts/smoke.mjs:143,154-164`
- Last-manager trigger: `supabase/migrations/20260925120000_create_profiles_and_roles.sql:110`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Library and token map

#### Automated

- [x] 1.1 Lint passes: `npm run lint`
- [x] 1.2 Type check passes: `npx astro check`
- [x] 1.3 Build passes: `npm run build`
- [x] 1.4 No new dependencies: `git diff --quiet -- package.json package-lock.json`
- [x] 1.5 `src/components/ui/native-select.tsx` exists and the other ui components are unchanged

#### Manual

- [x] 1.6 Baseline screenshots exist in `screenshots/before/` for the listed routes and widths
- [x] 1.7 `tokens.md` lists every new row and points to the archived map

### Phase 2: Message contract

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Type check passes: `npx astro check`
- [ ] 2.3 Build passes: `npm run build`
- [ ] 2.4 Smoke passes against a local server with the seeded DB: `npm run smoke`
- [ ] 2.5 No raw message reaches a redirect or the page (grep returns nothing)

#### Manual

- [ ] 2.6 An unknown `?error=` shows "Could not update the role. Try again."
- [ ] 2.7 Last-manager demotion shows "Cannot demote the last manager" with `&user=<id>` in the URL
- [ ] 2.8 Promoting the seeded employee shows "Role updated." with `&user=<employee id>`

### Phase 3: The view on tokens and shared components

#### Automated

- [ ] 3.1 Lint passes: `npm run lint`
- [ ] 3.2 Type check passes: `npx astro check`
- [ ] 3.3 Build passes: `npm run build`
- [ ] 3.4 Smoke passes: `npm run smoke`
- [ ] 3.5 No literal colours in the view (grep returns nothing)
- [ ] 3.6 No hydration directives (grep returns nothing)

#### Manual

- [ ] 3.7 `/manager/users` renders in the neutral dark theme at 1280px and 390px with no horizontal scroll
- [ ] 3.8 Page source shows `selected` on the current role option and no slot wrapper inside `<select>`
- [ ] 3.9 Error and success feedback appear inside the affected row
- [ ] 3.10 Self row shows the "You" pill; a blank-email row shows "No email · <short id>" with named controls

### Phase 4: States and visual gate

#### Automated

- [ ] 4.1 Lint passes: `npm run lint`
- [ ] 4.2 Type check passes: `npx astro check`
- [ ] 4.3 Build passes: `npm run build`
- [ ] 4.4 Smoke passes: `npm run smoke`
- [ ] 4.5 The kitchen sink returns 404 under `npm run preview`
- [ ] 4.6 No literal colours in the kitchen sink (grep returns nothing)

#### Manual

- [ ] 4.7 `/dev/manager-users-states` shows every row and page-level state at 1280px and 390px
- [ ] 4.8 Visible token focus ring on select, Save and back link; tab order row by row
- [ ] 4.9 Save disables until redirect; double click sends one POST; Back restores an enabled Save
- [ ] 4.10 `screenshots/after/` and `README.md` exist with every 7-state cell shown or marked N/A

### Phase 5: Make it stick

#### Automated

- [ ] 5.1 Lint passes: `npm run lint`
- [ ] 5.2 Type check passes: `npx astro check`
- [ ] 5.3 Build passes: `npm run build`
- [ ] 5.4 `npm run check:ui` exits 0 on the whole scope
- [ ] 5.5 A probe file with `text-red-300` makes `npm run check:ui` exit 1
- [ ] 5.6 Files outside the scope are ignored by the check

#### Manual

- [ ] 5.7 The `### UI` block sits above the 10x-cli managed block and reads as a complete contract
- [ ] 5.8 The pre-commit hook rejects a staged scoped file containing `bg-white/10`
