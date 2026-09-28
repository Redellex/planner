# /availability on Design Tokens Implementation Plan

## Overview

Rebuild the `/availability` view on the design-system contract the repo already ships:

- the shadcn "new-york" neutral tokens in `src/styles/global.css`, rendered in a globally activated dark theme;
- the repo's shared components (`Button`, plus the new shadcn `Input` and `Alert`).

Along the way, close the view's accidental-architecture charges that sit on the rendering side:

- spoofable or raw error text;
- feedback shown far from the form;
- double submit producing false errors.

The result is gated by a dev-only kitchen-sink page and screenshots. This is a `/10x-ui` change: one view plus global tokens.

## Current State Analysis

(From `research.md`, all at commit 5b4001c.)

- **Tokens exist, but nothing reads them.** `:root`/`.dark` values are at `src/styles/global.css:6-73`, published correctly via `@theme inline` (`:75-111`). No page uses a semantic class. `availability.astro` has 57 literal colour-utility occurrences and zero `focus`/`disabled` classes.
- **Dark mode is never active.** No element gets `.dark` (`src/layouts/Layout.astro:14`), there is no `color-scheme`, and `body` is `bg-background` = white (`global.css:121-123`). The dark look is the `bg-cosmic` hex gradient, the glass card and the gradient `h1`, copy-pasted across about 8 pages.
- **The view hand-rolls its components.** It defines `inputClass`/`buttonClass` strings (`availability.astro:105-107`) and three hand-built message boxes (`:116-128`, `:148-157`) instead of `src/components/ui/button.tsx` (the only shadcn component; `buttonVariants` is exported but never imported).
- **Error rendering:**
  - `?error=` is rendered verbatim (`availability.astro:30,116-120`).
  - `describeWriteError` falls back to the raw PostgREST message (`src/lib/availability.ts:229`), and so does `update.ts:46`.
  - Page read errors show raw DB text (`availability.astro:71,76,82`).
  - The error box sits at page top, far from the forms.
  - There is no pending or disabled state, so a double submit yields false "Overlaps…" / "Not found…" errors.
- **Smoke contract** (`scripts/smoke.mjs`):
  - Exact redirect URLs `…&error=Overlaps%20an%20existing%20window` (`:106`) and `…&error=This%20month%20is%20locked%20or%20no%20longer%20editable` (`:175`).
  - `…&updated=1` (`:101,112,132,141`).
  - The page body must contain `name="id" value="<uuid>"` (`:120`).
- **Tooling:** `@astrojs/react` is registered (`astro.config.mjs:12`). There is no screenshot-test runner and no unit-test runner.

## Desired End State

- **Theme.** The app renders in the shadcn neutral **dark** token theme (`<html class="dark">`, `color-scheme: dark`).
- **No literal colours.** `/availability` and its new components contain no literal colour utility, hex, `bg-cosmic` or gradient text. Every colour, radius and state comes from tokens or from `Button`, `Input` and `Alert`.
- **Feedback placement.** Write feedback (error or success) appears as an `Alert` inside the selected-day panel. Page-load failures appear as a destructive `Alert` at the top.
- **Only known messages.** Only messages from a fixed allow-list are shown. Unknown `?error=` text and raw DB errors become a generic message, and the raw text goes to `console.error`.
- **Distinct states.** Day cells distinguish _selected_, _has windows_ and _keyboard focus_ at a glance. Every control has a visible focus ring. Clicking a submit button disables it (with `aria-busy`) until navigation.
- **Visual gate.** `/dev/availability-states` renders every state side by side in dev and returns 404 in production builds. Desktop (1280px) and mobile (390px) screenshots are saved in the change folder.
- **Contracts intact.** All smoke steps pass unchanged, and `/`, `/dashboard` and `/auth/signin` look unchanged.

Verify with lint, `astro check`, build, `npm run smoke`, the literal-colour grep in Phase 3, and the screenshots in Phase 4.

### Key Discoveries:

- `global.css:4`: `@custom-variant dark (&:is(.dark *))`, so `.dark` on `<html>` activates both the `.dark` values and every `dark:` variant (including `button.tsx:8-18`).
- `global.css:118-119`: the base layer puts `border-border outline-ring/50` on `*`, so a bare `border` already reads the token.
- `button.tsx:7-37`: the `default`/`secondary`/`destructive`/`outline`/`ghost` variants and `sm` size already carry `focus-visible:ring-ring/50 ring-[3px]` and `disabled:opacity-50`.
- The shadcn new-york v4 `Input` and `Alert` need no new dependency (Context7 `/shadcn-ui/ui`, fetched 2026-09-28). `Alert` hard-codes `role="alert"`, so status notices override it with `role="status"`.
- `lib/availability.ts:237-247` (`availabilityUrl`) is the only redirect builder, and the three endpoints call it with either literal strings or `describeWriteError(...)`.

## What We're NOT Doing

These are the deferred charges from `research.md`, each with its reason:

- **Other views:** Topbar, dashboard, manager pages, auth, 403, Welcome and their `bg-cosmic`/glass/gradient copies. `/10x-ui` allows one view per change, so each needs its own change.
- **A4, sticky `?updated=1`/`?error=` on refresh or bookmark**, and the fact that `?updated=1` can still fake "Availability saved." The effect is harmless, and fixing it needs a flash mechanism (cookie or session), which is not a UI concern.
- **A2 (part), preserving typed start/end/repeat values after an error redirect.** It would change the endpoints and the exact redirect URLs asserted by `smoke.mjs`.
- **A5, return-URL after sign-in.** Cross-cutting auth flow.
- **A6, app shell / nav on `/availability`.** It spans every view.
- **A7, silent fallback for an invalid or past `?month`/`?day`**, and the current month not being viewable. Product rule, low impact.
- **A8, forms stay enabled when reading windows fails.** Only the message text changes here.
- **Light theme.** `:root` light values stay in the file but are unused and not screenshot-gated after this change.
- **New dependencies.** No shadcn `label`/`checkbox` (Radix dependencies), no Playwright, no theme toggle.

## Implementation Approach

Follow the `/10x-ui` order: environment and library, then values, then the one view, then states.

- **Phase 1** makes the token layer live and adds the two components, without touching the view.
- **Phase 2** fixes the message contract in plain TypeScript, so it can be verified by smoke on its own.
- **Phase 3** rewrites the view on tokens and components, extracted into Astro components the kitchen sink can reuse.
- **Phase 4** adds focus, pending and states work, then builds the kitchen sink and runs the visual gate.

Everything stays form-POST + redirect with server-rendered HTML. The only client JS is a small inline pending script.

## Critical Implementation Details

- **Smoke markup contract.** Hidden inputs must stay native `<input type="hidden" name="id" value={row.id} />` with `name` before `value`, because `smoke.mjs:120` parses the body with the regex `name="id" value="…"`.
- **React inside Astro.** Render `Button`, `Input` and `Alert` from `.astro` without any `client:*` directive: they are pure markup and must not hydrate. Use `buttonVariants(...)` for `<a>` elements.
- **Pending script and bfcache.** Disabling the submitter inside the `submit` handler does not cancel native submission, and the buttons carry no `name`, so no form data is lost. Buttons must be re-enabled on `pageshow` with `event.persisted`; otherwise Back from the redirect target restores a page whose buttons are stuck disabled.

## Phase 1: Token layer and components

### Overview

Activate the neutral dark token theme globally, record the token source, and add shadcn `Input` and `Alert` through the stack's own CLI. No view changes yet.

### Changes Required:

#### 1. Baseline screenshots

**File**: `context/changes/availability-ui-tokens/screenshots/before/`

**Intent**: Capture the current `/availability`, `/`, `/dashboard` and `/auth/signin` at 1280px and 390px before anything changes, so later phases have a visual delta to explain.

**Contract**: PNG files named `<route-slug>-<width>.png`.

#### 2. Activate the dark theme

**File**: `src/layouts/Layout.astro`, `src/styles/global.css`

**Intent**: Put the app in the shadcn neutral dark theme at the token layer, rather than per-component, and make native controls (time inputs, checkbox, select) render dark chrome.

**Contract**:

- `<html lang="en" class="dark">`.
- The `.dark` block in `global.css` gains `color-scheme: dark;`.
- A one-line comment above `:root` names the value source: shadcn/ui new-york, `baseColor: neutral` (`components.json`), with a pointer to `context/changes/availability-ui-tokens/tokens.md`.
- No token values change.

#### 3. Token role map

**File**: `context/changes/availability-ui-tokens/tokens.md`

**Intent**: Deposit in the repo the role→token mapping this view will use, so the next change reuses it instead of reinventing it.

**Contract**: A table of UI role → token/component with the following rows:

- page → `bg-background text-foreground`
- panel → `bg-card text-card-foreground border rounded-xl`
- secondary text → `text-muted-foreground`
- selected day → `bg-primary text-primary-foreground`
- has-windows day → `bg-secondary` + `bg-primary` dot
- focus → `ring-ring/50 ring-[3px]`
- error → `Alert variant="destructive"`
- success / locked → `Alert` default + icon
- buttons → `Button` variants
- inputs → `Input`

Plus a one-line source note.

#### 4. Add shadcn components

**File**: `src/components/ui/input.tsx`, `src/components/ui/alert.tsx` (generated)

**Intent**: Bring in the two missing shared components through the stack's own path, instead of hand-rolling them in the view.

**Contract**: Run `npx shadcn@latest add input alert`. `button.tsx` is not overwritten, and `package.json` gains no new dependency. Generated files are kept as generated, apart from lint/format fixes.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- No new dependencies: `git diff --quiet -- package.json`
- `src/components/ui/input.tsx` and `src/components/ui/alert.tsx` exist and `src/components/ui/button.tsx` is unchanged: `git diff --quiet -- src/components/ui/button.tsx`

#### Manual Verification:

- Baseline screenshots exist in `screenshots/before/` for the 4 routes at 1280px and 390px
- `/`, `/dashboard` and `/auth/signin` look unchanged against the baseline in dev
- On current `/availability`, the native time inputs and checkbox now render with dark chrome

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Message contract

### Overview

Make every message the view can show come from a fixed set, and never show raw database text. Redirect URLs stay byte-identical, so the smoke script passes unchanged.

### Changes Required:

#### 1. Message constants and resolver

**File**: `src/lib/availability.ts`

**Intent**: Give the fixed set of user-facing availability messages a single home, and add a resolver the page uses to turn a `?error=` value into safe text.

**Contract**:

- Export named constants for every message the endpoints emit today:
  - "Invalid date"
  - "Invalid time"
  - "Invalid window id"
  - "Invalid month"
  - "Not found, locked or not permitted"
  - "Supabase is not configured"
  - the three `describeWriteError` texts
- Also export:
  - a new `GENERIC_WRITE_ERROR` ("Could not save your availability. Try again.");
  - `GENERIC_LOAD_ERROR` ("Could not load your availability. Reload the page.");
  - a readonly set of the allowed messages.
- Add `resolveFeedbackError(param: string | null): string | null`. It returns `null` for a missing or empty param, the param itself when it is in the set, and `GENERIC_WRITE_ERROR` otherwise.
- `describeWriteError`'s `default` branch logs the raw `{code, message}` with `console.error` and returns `GENERIC_WRITE_ERROR`.
- The existing three mapped texts are unchanged; `smoke.mjs:106,175` depends on them.

#### 2. Endpoints use the constants

**File**: `src/pages/api/availability/create.ts`, `update.ts`, `delete.ts`

**Intent**: Keep the allow-list in sync by construction, and remove the last raw-message passthrough.

**Contract**:

- Replace each literal error string with the matching constant. The resulting redirect URLs are identical.
- `update.ts:46` logs `readError` and redirects with `GENERIC_WRITE_ERROR` instead of `readError.message`.

#### 3. Page splits feedback from load errors

**File**: `src/pages/availability.astro`

**Intent**: Separate "result of the user's last write" (from the URL) from "this page failed to load", and never render untrusted or raw text.

**Contract**:

- `feedbackError = resolveFeedbackError(url error param)`.
- `saved = updated === "1" && !feedbackError`.
- `loadError` is set to `GENERIC_LOAD_ERROR` (raw error to `console.error`) when any of the three reads fails, or to the Supabase-not-configured constant.
- Load errors no longer use `??=` on the URL value, so a URL error can no longer hide a real read failure.
- `lockStateUnknown` behaviour is unchanged.
- Markup placement changes happen in Phase 3; in this phase, the existing top box renders `loadError ?? feedbackError`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- Smoke passes against a local server with the seeded DB: `npm run smoke`
- No raw `.message` reaches a redirect or the page: `grep -nE 'error\.message|readError\.message' src/pages/availability.astro src/pages/api/availability/*.ts` returns nothing

#### Manual Verification:

- `/availability?error=Your%20account%20is%20suspended` shows "Could not save your availability. Try again."
- `/availability?error=Overlaps%20an%20existing%20window` shows "Overlaps an existing window"

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: The view on tokens and shared components

### Overview

Extract the view's presentational parts into Astro components and rebuild them on tokens, `Button`/`buttonVariants`, `Input` and `Alert`. Drop the cosmic backdrop, the glass card and the gradient heading, and move write feedback into the day panel.

### Changes Required:

#### 1. Month tabs

**File**: `src/components/availability/MonthTabs.astro` (new)

**Intent**: Render the month switcher as token-styled links with the current month clearly marked.

**Contract**:

- Props `{ months: string[]; current: string; lockedMonths: Set<string> }`.
- `<nav aria-label="Months">` with `<a>` elements styled `buttonVariants({ variant: current ? "default" : "outline", size: "sm" })`.
- `aria-current="page"` preserved.
- Locked label rendered in `text-muted-foreground`.

#### 2. Calendar grid

**File**: `src/components/availability/AvailabilityCalendar.astro` (new)

**Intent**: Render the Monday-first grid on tokens so that _selected_ (solid primary fill) and _has windows_ (secondary fill + primary dot) are distinct, and neither is expressed as a ring, which is reserved for focus in Phase 4.

**Contract**:

- Props `{ month; weeks; windowsByDay: Map<string, WindowRow[]>; carryOver: WindowRow | null; carryOverLabel: string | null; selectedDay: string }`.
- Keep the existing `href`, `aria-current="date"`, `aria-label` summary and mobile dot/count behaviour (`availability.astro:166-210`).
- Weekday header in `text-muted-foreground`.
- Rounded corners from the radius tokens.

#### 3. Day panel

**File**: `src/components/availability/DayPanel.astro` (new)

**Intent**: Render the selected-day heading, write feedback, the window list with update/delete forms, and the add form on tokens and shared components. Feedback appears next to the forms it concerns.

**Contract**:

- Props `{ month; selectedDay; selectedLabel; windows: WindowRow[]; carryOverText: string | null; locked: boolean; lockStateUnknown: boolean; feedback: { kind: "error" | "success"; message: string } | null }`.
- Panel: `bg-card text-card-foreground border rounded-xl`.
- Feedback:
  - error → `Alert variant="destructive"` with a lucide `CircleAlert` icon;
  - success → `Alert` default with a `CircleCheck` icon and `role="status"`;
  - locked / lock-unknown notice → `Alert` default with a `Lock` icon and `role="status"`, keeping today's texts (`availability.astro:153-155`).
- Times use `Input type="time"`.
- Buttons: Save → `Button variant="secondary" size="sm"`, Delete → `Button variant="destructive" size="sm"`, Add → `Button size="sm"`.
- Existing `aria-label`s, `sr-only` labels, form actions, hidden inputs (see Critical Implementation Details) and the `(+1)` marker are preserved.
- Repeat checkbox stays native: `size-4 accent-primary`, with a label in `text-sm`.
- Empty text "No windows" is rendered in `text-muted-foreground`.

#### 4. Page composition

**File**: `src/pages/availability.astro`

**Intent**: Keep data loading in the page and compose the three components, with the page and container styled only by tokens.

**Contract**:

- Remove `inputClass`/`buttonClass`, `bg-cosmic`, the glass classes and the gradient `h1`.
- Page wrapper: `min-h-screen bg-background p-4`, with container `max-w-2xl`.
- `h1`: `text-2xl font-semibold`.
- `loadError` renders as a destructive `Alert` above the month tabs.
- Feedback passed to `DayPanel` is `feedbackError` → error, `saved` → success.
- "Back to dashboard" uses `buttonVariants({ variant: "outline" })`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- Smoke passes: `npm run smoke`
- No literal colours in the view: `grep -nE '(bg|text|border|ring|from|via|to)-(white|black)\b|(purple|blue|red|green|gray|slate|zinc|neutral)-[0-9]|#[0-9a-fA-F]{3,8}\b|bg-cosmic|text-transparent|bg-gradient|inputClass|buttonClass' src/pages/availability.astro src/components/availability/*.astro` returns nothing
- No hydration directives on the view: `grep -n 'client:' src/pages/availability.astro src/components/availability/*.astro` returns nothing

#### Manual Verification:

- `/availability` renders in the neutral dark theme at 1280px and 390px; selected day and days with windows are distinguishable at a glance
- Delete is visually distinct from Save; error and success feedback appears inside the day panel after a create that overlaps and a create that succeeds
- A locked month shows the locked notice and no forms; the mobile layout keeps the dot/count indicators and does not scroll horizontally

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: States and visual gate

### Overview

Finish the named states (focus, hover, disabled/pending, error, empty, locked, success), build the kitchen sink, and run the screenshot gate. Loading is not applicable because the page is SSR with full-page form posts.

### Changes Required:

#### 1. Focus and hover on custom interactive elements

**File**: `src/components/availability/AvailabilityCalendar.astro`

**Intent**: Give day cells the same visible focus treatment as `Button`/`Input`, so keyboard users can tell focus from selection. Hover uses the accent token, and the selected cell keeps its fill on hover.

**Contract**:

- Day-cell `<a>`: `outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50`.
- Non-selected cells: `hover:bg-accent hover:text-accent-foreground`.
- If the focus ring is not clearly visible on `bg-card` in the dark theme, adjust `--ring` in the `.dark` block of `global.css`, not the component classes, and record the change in `tokens.md`.

#### 2. Pending submit state

**File**: `src/pages/availability.astro` (Astro `<script>`)

**Intent**: Stop double submits from producing false errors by disabling the clicked submit button while the POST is in flight.

**Contract**:

- One delegated `submit` listener on `document` for forms whose `action` starts with `/api/availability/`. It sets `event.submitter.disabled = true` and `aria-busy="true"`.
- A `pageshow` listener with `event.persisted` clears both on all submitters (see Critical Implementation Details).
- No framework island.

#### 3. Kitchen sink

**File**: `src/pages/dev/availability-states.astro` (new)

**Intent**: Render every state of the view side by side from fixture data using the real components, as review evidence and the visual gate.

**Contract**:

- Outside dev, the page returns `new Response(null, { status: 404 })` (`!import.meta.env.DEV`).
- Sections, each labelled:
  - `MonthTabs` with one locked month;
  - a calendar containing empty days, a single window, multiple windows, a carry-over on day 1 and the selected day;
  - a `DayPanel` for each state: default with windows, empty, error feedback, success feedback, locked, lock state unknown, and pending (Add rendered `disabled aria-busy="true"`).
- No DB access.
- Focus and hover are captured by keyboard and pointer in the screenshots.

#### 4. Screenshots

**File**: `context/changes/availability-ui-tokens/screenshots/after/`

**Intent**: Record the visual delta for review.

**Contract**:

- Kitchen sink and `/availability` at 1280px and 390px.
- One screenshot with keyboard focus on a day cell and one on an `Input`.
- `/`, `/dashboard` and `/auth/signin` at 1280px.
- A short `screenshots/README.md` explaining the before→after delta per route.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- Smoke passes: `npm run smoke`
- The kitchen sink returns 404 in the production preview: `curl -s -o /dev/null -w '%{http_code}' http://localhost:4321/dev/availability-states` prints `404` against `npm run preview`

#### Manual Verification:

- The kitchen sink shows all listed states side by side at 1280px and 390px, with screenshots saved in `screenshots/after/`
- Tabbing through `/availability` shows a visible focus ring on month tabs, day cells, inputs, checkbox and buttons, and focus is distinguishable from the selected day
- Double-clicking Add on a free slot saves once and shows "Availability saved." (no false overlap error); Back after a submit leaves buttons enabled
- `screenshots/README.md` explains the before→after delta for every captured route; `/`, `/dashboard` and `/auth/signin` show no unexplained change

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None. The repo has no unit-test runner, and this change does not add one. `resolveFeedbackError` and `describeWriteError` are exercised through smoke and the manual URL checks.

### Integration Tests:

- `npm run smoke` after Phases 2, 3 and 4. It covers the redirect-URL contract (overlap and locked messages, `updated=1`) and the `name="id" value=` markup contract for the new components.

### Manual Testing Steps:

1. Open `/availability?error=anything` and confirm the generic message; open it with a known message and confirm that text appears in the day panel.
2. Add a window, then add the same window again. Confirm success, then "Overlaps an existing window", both inside the day panel.
3. Lock the upcoming month in `/manager/months` and confirm `/availability` shows the locked notice and no forms. Unlock it afterwards.
4. Keyboard-only pass: Tab through tabs, cells, inputs, checkbox and buttons, and confirm the focus ring is visible and distinct from the selected day.
5. Check the kitchen sink at 1280px and 390px, and confirm no horizontal scroll on mobile.

## Performance Considerations

None material. The page remains server-rendered HTML, and the only added client JS is a few lines of inline listener.

## Migration Notes

No data or schema change. Globally adding `.dark` affects only token-reading code. Before this change that means `body`, the base border and outline colours, and `button.tsx`'s `dark:` variants (used by the auth `SubmitButton`, whose background is overridden). All of these are covered by the Phase 1 and Phase 4 screenshot checks. Rollback is reverting the `class="dark"` line.

## References

- Research: `context/changes/availability-ui-tokens/research.md`
- Change identity and motif: `context/changes/availability-ui-tokens/change.md`
- Token source: `src/styles/global.css:4-123`, `components.json`
- Shared components: `src/components/ui/button.tsx:7-50`
- Smoke contract: `scripts/smoke.mjs:101-141,175`
- Redirect builder and message mapping: `src/lib/availability.ts:220-247`
- shadcn new-york v4 Input and Alert sources and the Astro dark-mode docs (Context7 `/shadcn-ui/ui`, fetched 2026-09-28)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Token layer and components

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — a350310
- [x] 1.2 Type check passes: `npx astro check` — a350310
- [x] 1.3 Build passes: `npm run build` — a350310
- [x] 1.4 No new dependencies: `git diff --quiet -- package.json` — a350310
- [x] 1.5 `src/components/ui/input.tsx` and `src/components/ui/alert.tsx` exist and `src/components/ui/button.tsx` is unchanged: `git diff --quiet -- src/components/ui/button.tsx` — a350310

#### Manual

- [x] 1.6 Baseline screenshots exist in `screenshots/before/` for the 4 routes at 1280px and 390px — a350310
- [x] 1.7 `/`, `/dashboard` and `/auth/signin` look unchanged against the baseline in dev — a350310
- [x] 1.8 On current `/availability`, the native time inputs and checkbox now render with dark chrome — a350310

### Phase 2: Message contract

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 6cd5dbd
- [x] 2.2 Type check passes: `npx astro check` — 6cd5dbd
- [x] 2.3 Build passes: `npm run build` — 6cd5dbd
- [x] 2.4 Smoke passes against a local server with the seeded DB: `npm run smoke` — 6cd5dbd
- [x] 2.5 No raw `.message` reaches a redirect or the page: `grep -nE 'error\.message|readError\.message' src/pages/availability.astro src/pages/api/availability/*.ts` returns nothing — 6cd5dbd

#### Manual

- [x] 2.6 `/availability?error=Your%20account%20is%20suspended` shows "Could not save your availability. Try again." — 6cd5dbd
- [x] 2.7 `/availability?error=Overlaps%20an%20existing%20window` shows "Overlaps an existing window" — 6cd5dbd

### Phase 3: The view on tokens and shared components

#### Automated

- [x] 3.1 Lint passes: `npm run lint` — 5076dd9
- [x] 3.2 Type check passes: `npx astro check` — 5076dd9
- [x] 3.3 Build passes: `npm run build` — 5076dd9
- [x] 3.4 Smoke passes: `npm run smoke` — 5076dd9
- [x] 3.5 No literal colours in the view: `grep -nE '(bg|text|border|ring|from|via|to)-(white|black)\b|(purple|blue|red|green|gray|slate|zinc|neutral)-[0-9]|#[0-9a-fA-F]{3,8}\b|bg-cosmic|text-transparent|bg-gradient|inputClass|buttonClass' src/pages/availability.astro src/components/availability/*.astro` returns nothing — 5076dd9
- [x] 3.6 No hydration directives on the view: `grep -n 'client:' src/pages/availability.astro src/components/availability/*.astro` returns nothing — 5076dd9

#### Manual

- [x] 3.7 `/availability` renders in the neutral dark theme at 1280px and 390px; selected day and days with windows are distinguishable at a glance — 5076dd9
- [x] 3.8 Delete is visually distinct from Save; error and success feedback appears inside the day panel after a create that overlaps and a create that succeeds — 5076dd9
- [x] 3.9 A locked month shows the locked notice and no forms; the mobile layout keeps the dot/count indicators and does not scroll horizontally — 5076dd9

### Phase 4: States and visual gate

#### Automated

- [x] 4.1 Lint passes: `npm run lint` — 6006713
- [x] 4.2 Type check passes: `npx astro check` — 6006713
- [x] 4.3 Build passes: `npm run build` — 6006713
- [x] 4.4 Smoke passes: `npm run smoke` — 6006713
- [x] 4.5 The kitchen sink returns 404 in the production preview: `curl -s -o /dev/null -w '%{http_code}' http://localhost:4321/dev/availability-states` prints `404` against `npm run preview` — 6006713

#### Manual

- [x] 4.6 The kitchen sink shows all listed states side by side at 1280px and 390px, with screenshots saved in `screenshots/after/` — 6006713
- [x] 4.7 Tabbing through `/availability` shows a visible focus ring on month tabs, day cells, inputs, checkbox and buttons, and focus is distinguishable from the selected day — 6006713
- [x] 4.8 Double-clicking Add on a free slot saves once and shows "Availability saved." (no false overlap error); Back after a submit leaves buttons enabled — 6006713
- [x] 4.9 `screenshots/README.md` explains the before→after delta for every captured route; `/`, `/dashboard` and `/auth/signin` show no unexplained change — 6006713
