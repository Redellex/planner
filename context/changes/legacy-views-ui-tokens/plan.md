# Legacy Views on the Design Tokens (S-09) Implementation Plan

## Overview

This plan moves the last six legacy views onto the shadcn design tokens and the `ui/` components that every other view already uses. The six views are the dashboard `/`, sign-in, sign-up, confirm-email, the 403 page and `/manager/months`. The not-configured `Banner` comes along too.

Before any restyling, the plan fixes the two defects the audit found:

- these views render error text taken straight from the URL or the database;
- `/manager/months` fails open when its read fails.

The plan ends with four kitchen-sink pages, every view in `check:ui`, and the `bg-cosmic` legacy contract deleted. This is a `/10x-ui` change (roadmap S-09, MS-04, GitHub #44) run as **one change**. No token values change.

## Current State Analysis

- **Shared look.** All six pages render the same legacy shell: a `bg-cosmic` wrapper, a glass card (`border-white/10 bg-white/10 … backdrop-blur-xl`) and a gradient `h1`. The research's hardcoded-value scan counts 49 literal lines across 11 files (`research.md` › "Hardcoded-value scan").
- **Hand-built controls.** The auth React components hand-build their input, error and button:
  - `FormField.tsx:5-6,42-55` has a purple focus ring, colour-only errors, and no `aria-invalid` or `aria-describedby`.
  - `ServerError.tsx:11` is a red `<p>` with no role.
  - `SubmitButton.tsx:18,22` overrides `Button` with purple.
  - `PasswordToggle.tsx:13` uses `text-white/40`.
- **Raw error text (C3).** `auth/signin.astro:5,14` and `auth/signup.astro:5,14` pass `?error=` straight to the island. `api/auth/signin.ts:16` and `api/auth/signup.ts:16` redirect with Supabase's `error.message`. `manager/months.astro:8,23` renders `?error=` and `queryError.message`. `api/manager/months/lock.ts:67` redirects with the raw `error.message`.
- **Fail-open read (C4).** If the lock read in `manager/months.astro:15-29` fails, the page still lists every month as "Open" with a Lock button. Also, `error ??=` lets a stale `?error=` hide the read failure.
- **Dead pending state.** `SubmitButton` reads `useFormStatus().pending`, but the forms post to a URL (`SignInForm.tsx:43`, `SignUpForm.tsx:66`). React only tracks function actions, so the pending branch never renders.
- **Confirm-email copy.** `confirm-email.astro:4` switches its copy on `import.meta.env.DEV`. The page only renders for a visitor without a session, because it is a guest route (`route-access.ts:19`) and a signed-in user is redirected home. So whenever it renders, confirmation is still required, and the DEV "Registration successful" copy is wrong.
- **Not-configured banner.** `Banner.astro:27-41` styles itself with hex colours in a scoped `<style>`. Its copy is Polish: `Layout.astro:33,38` and `config-status.ts:15,17`.
- **Leftovers that keep the legacy contract alive:**
  - `@utility bg-cosmic` (`global.css:121-123`);
  - the dead `ui/LibBadge.astro`;
  - the stale path comment at `global.css:6`;
  - the CLAUDE.md "Legacy" bullet (`CLAUDE.md:86`);
  - none of these views is in `SCOPE` (`check-ui-literals.mjs:17-36`).

## Desired End State

- **Same shell and components.** Every page and component listed above renders the shell `flex-1 bg-background p-4` > `mx-auto max-w-*`, with a panel of `rounded-xl border bg-card p-4 text-card-foreground`. They use `Button`/`buttonVariants`, `Input` and `Alert` and contain no colour literal.
- **Allow-listed feedback.** A crafted `?error=` on `/auth/signin`, `/auth/signup` or `/manager/months` shows that page's generic message. Supabase and PostgREST text reach only the Worker log. Sign-in and sign-up show a specific message for:
  - invalid credentials;
  - an unconfirmed email;
  - an existing account;
  - a weak password;
  - rate limits.
- **Months fails closed.** When the lock read fails, `/manager/months` shows only the load error: no month list and no Lock/Unlock buttons. A lock or unlock result appears as an `Alert` inside the row of the month it concerns.
- **Working pending state.** Submitting sign-in or sign-up with valid input disables the button, sets `aria-busy` and shows "Signing in…" / "Creating account…". A Lock/Unlock click disables its button until the redirect. Going Back re-enables both.
- **Copy:**
  - The dashboard drops the starter line and shows the role as a "Manager"/"Employee" pill.
  - Confirm-email always says "Check your email", with a lucide icon.
  - 403 carries a "Go home" link and copy that is true on a direct visit.
  - The banner is an English `Alert`.
- **Kitchen sinks.** `/dev/auth-states`, `/dev/dashboard-states`, `/dev/access-denied-states` and `/dev/manager-months-states` render every state in dev and return 404 in production. `/dev/navigation-states` also shows the banner. Before/after screenshots are saved in `context/changes/legacy-views-ui-tokens/screenshots/`.
- **Nothing legacy is left.** The new and changed files are in `SCOPE`. `bg-cosmic`, `LibBadge.astro` and the CLAUDE.md "Legacy" bullet are gone. `rg bg-cosmic src` returns nothing.
- **Smoke and suites pass.** `npm run smoke` passes unchanged, and so do `npm test`, `npm run lint`, `npx astro check` and `npm run check:ui`.

### Key Discoveries:

- `Input` (`src/components/ui/input.tsx:9-13`) already styles `aria-invalid` (`aria-invalid:border-destructive`, destructive ring) and has the token focus ring. Passing `aria-invalid` + `aria-describedby` fixes the semantics and the colour at once.
- `AuthError.code` exists (`@supabase/auth-js` `errors.d.ts:20`). The `ErrorCode` union includes `invalid_credentials`, `email_not_confirmed`, `user_already_exists`, `email_exists`, `weak_password`, `over_request_rate_limit` and `over_email_send_rate_limit`.
- The allow-list pattern to copy is `src/lib/account.ts`: message constants, an `…_FEEDBACK_ERRORS` set, `resolve…FeedbackError(param)` → known text or generic, and `log…Error`. Its tests are in `src/lib/account.test.ts`.
- The fail-closed read pattern to copy is `buildTeamView` (`src/lib/team-availability.ts`) and `src/pages/account.astro:25-42,49-55`: ready | unknown, and unknown renders only the load `Alert`.
- The pending-script pattern to copy is `src/pages/manager/users.astro:95-121`: a delegated `submit` listener disables the submitter and sets `aria-busy`, and a `pageshow` listener with `event.persisted` clears both.
- Row feedback with a redirect param is the `/manager/users` pattern: `?error=…&user=<id>`, an `Alert` inside the row, and a fallback to a top `Alert` for an unknown id (`context/archive/2026-09-29-manager-users-ui-tokens/tokens.md`, "row feedback").
- Smoke contracts:
  - `data-dashboard` (`smoke.mjs:223`);
  - "Access denied" (`smoke.mjs:123-124`);
  - `<Layout>` on the auth pages, which carries `data-nav-link` (`:194-199`);
  - location prefix `/auth/signin?error=` (`:212`);
  - location prefix `/auth/confirm-email` after sign-up (`:207`);
  - location prefixes `/manager/months?updated=1` (`:418,431,570`) and `/manager/months?error=`;
  - `searchParams.get("error") === UNLOCK_WITH_DRAFT_ERROR` (`:552-557`).

  Smoke's location checks are prefix matches, so appending `&month=YYYY-MM` after the status param keeps them green.

- Every new `src/pages/dev/*.astro` needs a `"public"` row in `src/lib/route-inventory.test.ts:24-30`.
- A React component rendered from `.astro` without `client:*` renders static HTML. Kitchen sinks can render `FormField`, `ServerError` and `SubmitButton` with fixture props, uninteractive.

## What We're NOT Doing

- **No token value changes and no new palette.** `global.css` `:root`/`.dark` stay as they are, and there is no second `shadcn init`.
- **No new shadcn component.** `Input`, `Button`, `Alert` and `NativeSelect` cover every state. The auth `<label>` stays a native `label` with token classes; adding a shadcn `Label` is not needed.
- **No return URL after sign-in.** That is auth behaviour, deferred earlier (`context/archive/2026-09-28-availability-ui-tokens/plan.md:64`).
- **`/manager/availability` stays as it is.** It is parked outside MS-04 (`roadmap.md:152`).
- **No smoke changes.** Steps and expectations stay as they are, and no new smoke step is added for crafted `?error=` links: unit tests on the resolve functions cover them.
- **No change to the sign-up redirect target.** It stays `/auth/confirm-email`. A sign-up that already has a session is sent home by the middleware, as today.
- **No change to the client-side validation rules** or `MIN_PASSWORD_LENGTH` (the hosted minimum was not checked; out of scope).
- **The default `<title>` "10x Astro Starter" in `Layout.astro:11` stays.** No S-09 page uses it.

## Implementation Approach

Contract before pixels, as in the archived ui-tokens changes:

1. **Phase 1** writes the message contracts and the fail-closed read as pure, unit-tested modules, and switches the endpoints to them. There is no visual change yet.
2. **Phases 2–4** restyle the views in three groups: auth, the static pages + Banner, and months. Each page consumes the Phase 1 modules.
3. **Phase 5** adds the kitchen sinks and screenshots.
4. **Phase 6** puts everything into `SCOPE` and deletes the legacy contract, so the next agent has only one contract to copy.

Each kitchen sink needs to render the views from fixtures, so each view's body becomes a component that takes props: `DashboardPanel`, `AccessDeniedPanel`, `AuthPanel`, `MonthLockRow`. The page then only reads data and composes. The same component also gets the right states into the kitchen sink.

## Critical Implementation Details

- **Keep the exact unlock message.** `UNLOCK_WITH_DRAFT_ERROR` must still arrive in `?error=` exactly (smoke compares the decoded param). The months allow-list must accept it, and the status param must stay first in the URL (`?error=…&month=…`), so smoke's prefix `/manager/months?error=` still matches.
- **Pending state and native submission.** In the React forms, set the pending state only after `validate()` passes and without calling `preventDefault`, so the native POST proceeds. Do not move the form to a function action. The endpoint contract is form-post + redirect. `SubmitButton` takes `pending` as a prop instead of calling `useFormStatus`.
- **Separate allow-lists.** The auth allow-list is per form: the sign-in page accepts only sign-in messages, and the sign-up page only sign-up messages. A sign-up message pasted into a sign-in link therefore resolves to the sign-in generic text.

## Phase 1: Baseline and message contract

### Overview

Capture the "before" state and write the token map for the new rows only. Then move every error message these views can show into two allow-listed modules with unit tests, and make the endpoints log raw errors and redirect with known text. Pages do not change in this phase.

### Changes Required:

#### 1. Baseline screenshots

**File**: `context/changes/legacy-views-ui-tokens/screenshots/before/`

**Intent**: Record the legacy look before any change, so the after shots can be compared with it.

**Contract**: 1280 and 390 wide, full page, dev toolbar hidden, against `astro dev` and local Supabase. Files:

- `dashboard-*` (manager)
- `signin-*`
- `signin-error-1280.png` (`?error=Invalid%20login%20credentials`)
- `signup-*`
- `forbidden-*` (employee on `/manager/users`)
- `months-*` (manager)
- `months-error-1280.png` (`?error=anything`)

A short `screenshots/README.md` lists each file in the format of `context/archive/2026-09-29-manager-users-ui-tokens/screenshots/README.md`. Confirm-email is not reachable locally (no session-less sign-up), so it has no before shot; note that in the README.

#### 2. Token role map

**File**: `context/changes/legacy-views-ui-tokens/tokens.md`

**Intent**: Name the tokens and components the new rows use, reusing the archived rows unchanged.

**Contract**: A "Reused rows" section points at `context/archive/2026-09-28-availability-ui-tokens/tokens.md` and `context/archive/2026-09-29-manager-users-ui-tokens/tokens.md`. A "New rows" table adds:

| UI role                 | Token / component                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| auth panel              | page wrapper > `mx-auto w-full max-w-sm` panel, `h1 text-2xl font-semibold`                    |
| field with leading icon | `Input` with `pl-9`, icon `text-muted-foreground` absolutely placed                            |
| field error             | `text-destructive text-xs` + `CircleAlert`, tied with `aria-describedby`; `Input aria-invalid` |
| password toggle         | `text-muted-foreground hover:text-foreground`, token focus ring                                |
| text link               | `text-primary underline-offset-4 hover:underline` (or `buttonVariants({ variant: "link" })`)   |
| role pill               | the "You" pill composition                                                                     |
| lock status             | locked: `Lock` icon + `text-foreground`; open: `text-muted-foreground`                         |
| page notice / banner    | `Alert variant="destructive"` + `CircleAlert`                                                  |
| pending submit          | `Button disabled aria-busy` + `LoaderCircle animate-spin`                                      |

#### 3. Auth message module

**File**: `src/lib/auth-feedback.ts` (new), `src/lib/auth-feedback.test.ts` (new)

**Intent**: Turn a Supabase `AuthError` into a message the user may see, and let each page show only known texts (C3).

**Contract**:

- Message constants:
  - `INVALID_CREDENTIALS_ERROR` ("Wrong email or password.")
  - `EMAIL_NOT_CONFIRMED_ERROR` ("Confirm your email first: open the link we sent you.")
  - `ACCOUNT_EXISTS_ERROR` ("An account with this email already exists. Sign in instead.")
  - `WEAK_PASSWORD_ERROR` ("Choose a longer or stronger password.")
  - `RATE_LIMIT_ERROR` ("Too many attempts. Wait a minute and try again.")
  - `GENERIC_SIGNIN_ERROR` ("Could not sign in. Try again.")
  - `GENERIC_SIGNUP_ERROR` ("Could not create your account. Try again.")
  - `SUPABASE_NOT_CONFIGURED_ERROR`
- `describeAuthError(form: "signin" | "signup", error: { code?: string; message: string })` → message:
  - `invalid_credentials` → invalid credentials;
  - `email_not_confirmed` → not confirmed;
  - `user_already_exists` / `email_exists` → account exists;
  - `weak_password` → weak password;
  - `over_request_rate_limit` / `over_email_send_rate_limit` → rate limit;
  - anything else (including a missing code) → the form's generic message.
- `SIGNIN_FEEDBACK_ERRORS` and `SIGNUP_FEEDBACK_ERRORS` sets, and `resolveAuthFeedbackError(form, param)`: null for absent or empty, the param for a known message of that form, otherwise the form's generic message.
- `logAuthError(context, error)` logs `{ code, message }` with the `no-console` disable comment (as `logAccountError`). It never logs the email or password.
- Tests:
  - each mapped code → its message;
  - an unknown code and a missing code → generic, per form;
  - resolve: null/empty → null, a known text passes, a crafted sentence → generic, and the other form's message → this form's generic.

#### 4. Auth endpoints use the module

**File**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`

**Intent**: Stop putting Supabase's raw text in the URL.

**Contract**: On `error`, call `logAuthError` and redirect to `/auth/signin?error=<describeAuthError("signin", error)>` (or the signup equivalent). The not-configured branch uses `SUPABASE_NOT_CONFIGURED_ERROR`. Success redirects are unchanged (`/` and `/auth/confirm-email`).

#### 5. Months message and read module

**File**: `src/lib/manager-months.ts` (new), `src/lib/manager-months.test.ts` (new)

**Intent**: Allow-list `/manager/months` feedback, place it in the row of the month it concerns, and make a failed lock read an explicit unknown state (C3, C4).

**Contract**:

- Constants:
  - `INVALID_MONTH_ERROR` ("Invalid month") and `INVALID_ACTION_ERROR` ("Invalid action"), keeping today's texts;
  - `GENERIC_LOCK_WRITE_ERROR` ("Could not update the month. Try again.");
  - `MONTHS_LOAD_ERROR` ("Could not load the month locks. Reload the page.");
  - `MONTH_UPDATED_MESSAGE` ("Month updated.");
  - re-exported `UNLOCK_WITH_DRAFT_ERROR` / `UNLOCK_WITH_PUBLISHED_ERROR` from `src/lib/schedule.ts`;
  - `SUPABASE_NOT_CONFIGURED_ERROR`.
- `MONTHS_FEEDBACK_ERRORS` holds every `?error=` text the lock endpoint can send. `resolveMonthsFeedbackError(param)` returns null, the known text, or `GENERIC_LOCK_WRITE_ERROR`.
- `monthsUrl(result: { error: string } | { updated: true }, month?: string)` puts the status param first (`error=…` or `updated=1`), then `month=YYYY-MM` when given.
- `parseMonthParam` validates `?month=` via `parseMonth` and honours it only when it is one of `upcomingMonths()`. Otherwise feedback falls back to the top of the panel.
- `buildMonthLocks({ data, error })` → `{ state: "ready"; lockedAt: Map<string, string> }` | `{ state: "unknown" }`. Unknown is returned for an error or for `data === null`.
- `logMonthsError(context, error)`.
- Tests:
  - resolve: known, crafted, null;
  - URL builder order with and without the month;
  - `buildMonthLocks`: ready with rows, ready with no rows (all open), unknown on error, unknown on null data;
  - the exact `UNLOCK_WITH_DRAFT_ERROR` is allow-listed.

#### 6. Lock endpoint uses the module

**File**: `src/pages/api/manager/months/lock.ts`

**Intent**: Log the raw error and redirect with known text, carrying the month so the page can place the feedback.

**Contract**:

- Every redirect goes through `monthsUrl`.
- An invalid month or action redirects with no `month` param.
- The not-configured, 23503 (draft or published) and generic branches carry `month`.
- The fallback at `:67` becomes `logMonthsError` + `GENERIC_LOCK_WRITE_ERROR`.
- Success is `?updated=1&month=YYYY-MM`.
- The 23503 branch keeps its exact messages and its schedule read.

### Success Criteria:

#### Automated Verification:

- New unit tests pass: `npx vitest run src/lib/auth-feedback.test.ts src/lib/manager-months.test.ts`
- Whole suite passes: `npm test`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Smoke passes against a local build (sign-in wrong password still redirects with `/auth/signin?error=`, unlock-with-draft still matches exactly): `npm run smoke`

#### Manual Verification:

- Before screenshots and their README exist in `screenshots/before/`
- `tokens.md` lists only the new rows and points at the archived maps for the rest
- A wrong-password sign-in redirects with "Wrong email or password." and the Worker log shows the raw Supabase code/message

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Auth views on tokens

### Overview

Restyle sign-in, sign-up and confirm-email onto the tokens with real `Input`/`Alert`/`Button`, accessible field errors and a working pending state. Each page renders only allow-listed feedback.

### Changes Required:

#### 1. Field on `Input`

**File**: `src/components/auth/FormField.tsx`

**Intent**: Replace the hand-built input with `Input`, so focus and the invalid style come from the tokens, and tie each error to its field for screen readers (C2).

**Contract**:

- Render `Input` with `aria-invalid={Boolean(error)}`, plus `aria-describedby` pointing at `${id}-error` when there is an error, else at `${id}-hint` when a hint exists.
- The label uses token text (`text-sm font-medium`), the leading icon `text-muted-foreground`, and the error line follows the "field error" row.
- The props interface is unchanged, so `SignInForm`/`SignUpForm` call sites stay the same apart from the hint.
- Do not add `role="alert"` to field errors. The form already prevented submit, and `aria-invalid` with the description is enough. Focus moves to the first invalid field on a failed submit: add that in the form's `handleSubmit`.

#### 2. Toggle, server error and submit button

**File**: `src/components/auth/PasswordToggle.tsx`, `src/components/auth/ServerError.tsx`, `src/components/auth/SubmitButton.tsx`

**Intent**: Move the three helpers onto the tokens, give the server error `Alert` semantics, and make pending real.

**Contract**:

- **`PasswordToggle`**: token colours, a visible focus ring (`focus-visible:ring-ring/50` via `rounded-sm` + `outline-none focus-visible:ring-[3px]`, or `Button variant="ghost" size="icon"` sized to fit), and `aria-pressed={visible}`. The `aria-label` is kept.
- **`ServerError`**: `Alert variant="destructive"` + `CircleAlert` + `AlertDescription`. It still renders nothing without a message.
- **`SubmitButton`**: props `{ pending: boolean; pendingText; icon; children }`, with no `useFormStatus`. It renders `Button` (default variant, `w-full`) with `disabled={pending}` and `aria-busy={pending || undefined}`. While pending it shows `LoaderCircle` with `animate-spin` and the pending text; no class overrides colour.

#### 3. Forms track submitting

**File**: `src/components/auth/SignInForm.tsx`, `src/components/auth/SignUpForm.tsx`

**Intent**: Show the pending state during the real POST, and clear it when the page comes back from the bfcache.

**Contract**:

- A `submitting` state is set to `true` in `handleSubmit` only when `validate()` passes. Native submission is not prevented.
- A `useEffect` registers `pageshow` and resets `submitting` when `event.persisted`.
- `SubmitButton pending={submitting}`.
- The sign-up password hint uses `text-muted-foreground` and gets `id="password-hint"`, matching the `aria-describedby` from FormField.
- On a failed validation, focus moves to the first field with an error.

#### 4. Shared auth panel and pages

**File**: `src/components/auth/AuthPanel.astro` (new), `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`

**Intent**: Give the three auth pages one token shell, and render only allow-listed server errors (C1, C3).

**Contract**:

- `AuthPanel` props are `{ title: string }`, with an optional `icon` slot above the heading (confirm-email uses it). It renders the "auth panel" row (page wrapper `flex-1 bg-background p-4`, centred `max-w-sm` panel, `h1`) with a default slot and a `footer` slot.
- **Sign-in and sign-up:**
  - `serverError={resolveAuthFeedbackError("signin" | "signup", Astro.url.searchParams.get("error"))}`;
  - the island stays `client:load`;
  - the footer link follows the "text link" row;
  - `<Layout>` is kept.
- **Confirm-email:**
  - drop `import.meta.env.DEV` and render one fixed copy: `MailCheck` lucide icon (`size-10 text-muted-foreground`, `aria-hidden`), heading "Check your email", the existing description, and the link "Back to sign in";
  - the `<title>` becomes "Check your email".

### Success Criteria:

#### Automated Verification:

- `npm test`, `npm run lint`, `npx astro check` pass
- No literal hits in the auth files (they enter `SCOPE` in Phase 6): `rg "bg-cosmic|backdrop-blur|white/|blue-|purple-|red-" src/components/auth src/pages/auth` returns nothing
- `npm run smoke` passes (sign-in page renders the anonymous nav, sign-up → `/auth/confirm-email`, wrong password → `/auth/signin?error=`)

#### Manual Verification:

- `/auth/signin?error=Anything%20you%20like` shows "Could not sign in. Try again.", not the crafted text
- A wrong password shows "Wrong email or password." in a destructive `Alert`
- Submitting empty fields shows field errors, focus lands on the first invalid field, and a screen reader (or the accessibility tree) announces the input as invalid with its message
- A valid submit disables the button with the spinner and "Signing in…"; Back from the dashboard shows the button enabled again
- Tab order: email → password → toggle → submit → sign-up link, each with the token focus ring

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Dashboard, 403 and Banner on tokens

### Overview

Restyle the three static surfaces and apply the light content pass. None of them needs hydration.

### Changes Required:

#### 1. Dashboard panel

**File**: `src/components/dashboard/DashboardPanel.astro` (new), `src/pages/index.astro`

**Intent**: Show the home page on the token shell with token link buttons, and drop the starter copy.

**Contract**:

- `DashboardPanel` props: `{ email: string | undefined; role: AppRole | null; links: { href: string; label: string }[] }` (the `navLinksFor` return type).
- It renders a panel carrying `data-dashboard`, with `h1` "Dashboard" and "Signed in as <email>".
- When `role` is set, it shows a role pill ("Manager" or "Employee", the "You" pill composition). With `role === null` there is no pill.
- Links render with `buttonVariants({ variant: "outline" })` in a wrapping flex row.
- The starter line "This page is only for authenticated users." is removed.
- `index.astro` keeps the `navLinksFor(...)` minus Home computation and renders the wrapper `flex-1 bg-background p-4` > `mx-auto max-w-2xl`.
- A role label helper (`roleLabel(role: AppRole): string`) goes in `src/lib/roles.ts`, with a unit test in a new `src/lib/roles.test.ts`, so the pill text is not hard-coded in markup.

#### 2. Access denied panel

**File**: `src/components/system/AccessDeniedPanel.astro` (new), `src/pages/403.astro`

**Intent**: Show 403 on the tokens, with a way out and copy that holds on a direct visit.

**Contract**:

- The panel keeps `h1` "Access denied", which smoke's `isAccessDenied` matches.
- It shows the line "You don't have access to this page." and, in place of "This area is available to managers only.", the line "Some pages are available to managers only. Ask a manager if you need access."
- A "Go home" link uses `buttonVariants({ variant: "outline" })` with href `/`.
- A `ShieldAlert` icon (`aria-hidden`) is optional.
- `403.astro` keeps `Astro.response.status = 403` for any method.

#### 3. Not-configured banner

**File**: `src/components/Banner.astro`, `src/layouts/Layout.astro`, `src/lib/config-status.ts`

**Intent**: Replace the hex-styled strip with the token `Alert` and English copy.

**Contract**:

- `Banner` renders `Alert` (destructive for `error`; default with `TriangleAlert` + `text-warning` for `warning`; default with `Info` for `info`) inside a full-width strip with the page gutter. The scoped `<style>` and every hex value are deleted.
- In `Layout`, "Uwaga" becomes "Warning:" and the "Dokumentacja" fallback becomes "Documentation".
- `config-status.ts` gets the message "Supabase is not configured — sign-in and data features are disabled." and the docs label "See the setup instructions".
- Links inside follow the "text link" row.
- The existing `role` behaviour is kept: `alert` for error, `status` otherwise.

### Success Criteria:

#### Automated Verification:

- `npm test` (including the new `roleLabel` test), `npm run lint`, `npx astro check` pass
- No literal hits: `rg "bg-cosmic|white/|blue-|purple-|#[0-9a-fA-F]{3,8}" src/pages/index.astro src/pages/403.astro src/components/dashboard src/components/system src/components/Banner.astro` returns nothing
- `npm run smoke` passes (`data-dashboard`, "Access denied" on every 403 step)

#### Manual Verification:

- `/` as manager shows the Manager pill and the manager links; as employee the Employee pill; link buttons show the token hover and focus ring
- An employee on `/manager/users` sees the token 403 panel with "Go home" leading to `/`
- With `SUPABASE_URL` unset in `.dev.vars`, every page shows the English destructive banner above the top bar (restore the value afterwards)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: `/manager/months` on tokens

### Overview

Make the months page fail closed, show allow-listed feedback in the row it concerns, restyle the list, and stop double submits.

### Changes Required:

#### 1. Month row

**File**: `src/components/manager-months/MonthLockRow.astro` (new)

**Intent**: Show one month with its lock state, its action and its own feedback, from props, so the page and the kitchen sink render the same row.

**Contract**:

- Props: `{ month: string; label: string; lockedAt: string | null; feedback: { kind: "error" | "success"; message: string } | null }`.
- The row is `li` with `flex flex-wrap items-center justify-between gap-3 py-3`:
  - the label is `text-sm font-medium`;
  - the status follows the "lock status" row ("Locked since <formatStationInstant>" with a `Lock` icon, or "Open" muted);
  - the form keeps the same POST to `/api/manager/months/lock` with hidden `month`/`action`;
  - the button is `Button size="sm"`, `variant="secondary"` for Lock and `outline` for Unlock, with the existing `aria-label`s.
- Feedback renders under the row as an `Alert`: destructive + `CircleAlert`, or `role="status"` + `CircleCheck`.

#### 2. Page composition and honest read

**File**: `src/pages/manager/months.astro`

**Intent**: Read the locks through `buildMonthLocks` and render only the load error when the read is unknown. Resolve feedback through the allow-list and place it on its month.

**Contract**:

- Wrapper `flex-1 bg-background p-4` > `mx-auto max-w-2xl`, `h1` "Months" plus the existing explanation in `text-muted-foreground`, and a panel holding a `ul class="divide-y"` of `MonthLockRow`.
- No Supabase client → the not-configured `Alert` only.
- Read error → `logMonthsError` + `MONTHS_LOAD_ERROR` `Alert` only. No list and no buttons. A `?error=` in the URL is not shown in this state.
- `?error=` goes through `resolveMonthsFeedbackError`, and `?updated=1` gives `MONTH_UPDATED_MESSAGE`. The feedback goes to the row whose month equals the `?month=` from `parseMonthParam`; without a valid month it shows as a top `Alert` above the list.
- The unused `cn` import and `buttonClass` are removed.

#### 3. Pending script

**File**: `src/pages/manager/months.astro` (Astro `<script>`)

**Intent**: Stop a double click from sending two lock writes, and show the disabled state live.

**Contract**: A copy of the `src/pages/manager/users.astro:95-121` pattern with `WRITE_ACTION_PREFIX = "/api/manager/months/"`. The submitter gets `disabled` + `aria-busy="true"`, and `pageshow` with `persisted` clears both.

### Success Criteria:

#### Automated Verification:

- `npm test`, `npm run lint`, `npx astro check` pass
- No literal hits: `rg "bg-cosmic|white/|blue-|purple-|red-|green-" src/pages/manager/months.astro src/components/manager-months` returns nothing
- `npm run smoke` passes (`?updated=1` prefixes, `?error=` prefix, exact `UNLOCK_WITH_DRAFT_ERROR`, lock refused for an employee)

#### Manual Verification:

- Locking and unlocking a month shows "Month updated." inside that month's row
- Unlocking a month with a draft shows the discard-first message in that row
- `/manager/months?error=crafted%20text&month=<an upcoming month>` shows "Could not update the month. Try again." in that row; with no or an invalid `month` it shows at the top
- With the lock read forced to fail (e.g. temporarily misspell the table name locally), the page shows only "Could not load the month locks. Reload the page." with no list or buttons; restore afterwards
- A double click on Lock sends one POST (network tab), and Back re-enables the button

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: States and visual gate

### Overview

Add the dev-only kitchen sinks that render every state from fixtures, register them in the route inventory, and capture the after screenshots.

### Changes Required:

#### 1. Kitchen sinks

**File**: `src/pages/dev/auth-states.astro`, `src/pages/dev/dashboard-states.astro`, `src/pages/dev/access-denied-states.astro`, `src/pages/dev/manager-months-states.astro` (all new), `src/pages/dev/navigation-states.astro`

**Intent**: Show each view's full state matrix side by side, so screenshots and later edits have one place to check.

**Contract**:

- Each page follows `src/pages/dev/account-states.astro:16-21`: 404 outside dev, fixtures only, no database, forms inert. The header states which matrix states are N/A and why.
- **`auth-states`:**
  - sign-in and sign-up `AuthPanel`s with empty fields;
  - every field error (`FormField` rendered directly with `error`), and the sign-up password hint;
  - each allow-listed server error for both forms, with the generic message shown last;
  - `SubmitButton` with `pending` true and false;
  - the confirm-email panel.
- **`dashboard-states`:** `DashboardPanel` for a manager, an employee and `role: null`, each with its `navLinksFor` links.
- **`access-denied-states`:** the `AccessDeniedPanel`.
- **`manager-months-states`:**
  - an open row, a locked row;
  - row success, row error (draft, published, generic);
  - the top fallback feedback;
  - the load-error-only page state;
  - the not-configured state;
  - a disabled `aria-busy` button.
- **`navigation-states`:** add a "Not-configured banner" section rendering `Banner` with `error`, `warning` and `info` and the Layout copy.

#### 2. Route inventory

**File**: `src/lib/route-inventory.test.ts`

**Intent**: Every new page needs its expected access, or the inventory guard fails.

**Contract**: Add `"/dev/auth-states"`, `"/dev/dashboard-states"`, `"/dev/access-denied-states"` and `"/dev/manager-months-states"` as `"public"` next to the existing dev rows.

#### 3. After screenshots

**File**: `context/changes/legacy-views-ui-tokens/screenshots/after/`, `screenshots/README.md`

**Intent**: The visual gate. It shows each view on the tokens at desktop and phone width, and the interaction states that a static shot of the page cannot show.

**Contract**:

- Every kitchen sink at 1280 and 390, full page.
- The live views at 1280 and 390: dashboard (manager), signin, signup, 403 (employee), months (manager).
- Viewport shots:
  - focus on the sign-in email input;
  - focus on the password toggle;
  - an invalid field with its error;
  - focus on a dashboard link button;
  - hover on a months Lock button.
- The README gets a file table and a "Before → after" list in the archived format: surface, controls, feedback, load failure, focus, pending, copy.

### Success Criteria:

#### Automated Verification:

- Route inventory and navigation tests pass: `npx vitest run src/lib/route-inventory.test.ts src/lib/navigation.test.ts`
- `npm test`, `npm run lint`, `npx astro check` pass
- Production build returns 404 for each kitchen sink: `npm run build && npm run preview`, then `curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/dev/auth-states` (and the other three) prints `404`

#### Manual Verification:

- Each kitchen sink renders every listed state in `astro dev` with no console errors, and its forms do not submit
- After screenshots and the README exist; reviewer compares before/after and accepts the look at 1280 and 390 (no horizontal scroll at 390)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 6: Make it stick

### Overview

Put every cleaned file into the colour-literal check, delete the legacy contract, and update the rules and the test plan, so no agent has a second contract to copy.

### Changes Required:

#### 1. Colour-literal scope

**File**: `scripts/check-ui-literals.mjs`

**Intent**: Guard the cleaned views against literals coming back.

**Contract**: Add to `SCOPE`:

- `src/pages/index.astro`
- `src/pages/403.astro`
- `src/pages/auth/`
- `src/pages/manager/months.astro`
- `src/components/auth/`
- `src/components/dashboard/`
- `src/components/system/`
- `src/components/manager-months/`
- `src/components/Banner.astro`
- the four new kitchen sinks

#### 2. Delete the legacy contract

**File**: `src/styles/global.css`, `src/components/ui/LibBadge.astro`

**Intent**: Remove what only the legacy views used, and fix the stale pointer.

**Contract**:

- Delete `@utility bg-cosmic` (`global.css:121-123`).
- Delete `LibBadge.astro`, after a repo grep confirms 0 imports.
- `global.css:6` points at `context/archive/2026-09-28-availability-ui-tokens/tokens.md`.

#### 3. Rules and docs

**File**: `CLAUDE.md`, `context/foundation/test-plan.md`

**Intent**: Make the token contract the only one documented, and record the new modules and the re-evaluated exclusion.

**Contract**:

- **CLAUDE.md:**
  - delete the "Legacy" UI bullet;
  - in the "Feedback" bullet, add `src/lib/auth-feedback.ts` and `src/lib/manager-months.ts` to the allow-list modules;
  - in the auth "API endpoints" bullet, say that errors map `AuthError.code` to allow-listed messages (raw text logged);
  - in the "Auth pages" bullet, say that confirm-email shows one "Check your email" copy;
  - where `/manager/months` is described (Availability › Routes), add the fail-closed read and the row feedback with `&month=`.
- **Test plan:**
  - in §7, remove "and legacy `bg-cosmic` views" from the kitchen-sink exclusion (kitchen sinks stay excluded) and note that S-09 moved them onto tokens and added unit tests for their message modules;

### Success Criteria:

#### Automated Verification:

- Colour check passes on the whole scope: `npm run check:ui`
- `rg -n "bg-cosmic" src` returns nothing; `rg -n "LibBadge" src` returns nothing
- `npm test`, `npm run lint`, `npx astro check`, `npm run build` pass
- `npm run smoke` passes against a fresh local build
- A deliberately added `text-purple-300` in `src/pages/manager/months.astro` makes `node scripts/check-ui-literals.mjs src/pages/manager/months.astro` exit non-zero (revert afterwards)

#### Manual Verification:

- CLAUDE.md no longer mentions legacy views or `bg-cosmic` as a pattern, and the new modules are named where an agent will look for feedback rules
- A quick visual pass over every app page in `astro dev` shows no remaining purple/blue gradient surface

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `src/lib/auth-feedback.test.ts`:
  - each mapped `AuthError.code` → its message;
  - unknown and missing code → the form's generic message;
  - `resolveAuthFeedbackError`: null/empty, a known text per form, a crafted sentence, and a message from the other form → generic.
- `src/lib/manager-months.test.ts`:
  - `resolveMonthsFeedbackError`: known, including the exact `UNLOCK_WITH_DRAFT_ERROR` and `UNLOCK_WITH_PUBLISHED_ERROR`; crafted; null;
  - `monthsUrl` parameter order;
  - `parseMonthParam`: an upcoming month is kept, a past or invalid month is dropped;
  - `buildMonthLocks`: ready with and without rows, unknown on error and on null data.
- `src/lib/roles.test.ts`: `roleLabel` for both roles.
- Existing guards keep running: route inventory (new dev rows) and navigation.

### Integration Tests:

- `npm run smoke` unchanged. It covers the sign-up/sign-in redirects, `data-dashboard`, "Access denied" and the months lock/unlock including the exact unlock-refused message.

### Manual Testing Steps:

1. Sign in with a wrong password, then with a crafted `?error=` link: specific message, then the generic one.
2. Submit sign-up with mismatched passwords: field errors announced, focus on the first invalid field. Then a valid sign-up: spinner, then confirm-email or home.
3. As an employee, open `/manager/months`: 403 token panel, "Go home" works.
4. As a manager, lock and unlock a month (row feedback), unlock a month with a draft (discard-first message in the row), and force a read failure (load error only).
5. Unset Supabase secrets locally: English banner on every page.

## Performance Considerations

None material. The months page adds a small inline script, and the auth islands keep their size; `useFormStatus` is replaced by local state.

## Migration Notes

No database change. The redirect URLs from the lock endpoint gain `&month=YYYY-MM` after the status param. Bookmarked `?error=` links with raw text now show the generic message.

## References

- Research: `context/changes/legacy-views-ui-tokens/research.md`
- Archived pattern: `context/archive/2026-09-29-manager-users-ui-tokens/plan.md` (phases, row feedback, pending script, kitchen sink, screenshots)
- Archived token maps: `context/archive/2026-09-28-availability-ui-tokens/tokens.md`, `context/archive/2026-09-29-manager-users-ui-tokens/tokens.md`
- Allow-list model: `src/lib/account.ts`, `src/lib/account.test.ts`
- Honest read model: `src/lib/team-availability.ts`, `src/pages/account.astro:25-55`
- Pending script model: `src/pages/manager/users.astro:95-121`
- Kitchen-sink model: `src/pages/dev/account-states.astro:16-21`
- Roadmap: `context/foundation/roadmap.md` S-09

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Baseline and message contract

#### Automated

- [x] 1.1 New unit tests pass: `npx vitest run src/lib/auth-feedback.test.ts src/lib/manager-months.test.ts` — 21742a2
- [x] 1.2 Whole suite passes: `npm test` — 21742a2
- [x] 1.3 Lint passes: `npm run lint` — 21742a2
- [x] 1.4 Type check passes: `npx astro check` — 21742a2
- [x] 1.5 Smoke passes against a local build (sign-in wrong password still redirects with `/auth/signin?error=`, unlock-with-draft still matches exactly): `npm run smoke` — 21742a2

#### Manual

- [x] 1.6 Before screenshots and their README exist in `screenshots/before/` — 21742a2
- [x] 1.7 `tokens.md` lists only the new rows and points at the archived maps for the rest — 21742a2
- [x] 1.8 A wrong-password sign-in redirects with "Wrong email or password." and the Worker log shows the raw Supabase code/message — 21742a2

### Phase 2: Auth views on tokens

#### Automated

- [x] 2.1 `npm test`, `npm run lint`, `npx astro check` pass — 11a8a35
- [x] 2.2 No literal hits in the auth files (they enter `SCOPE` in Phase 6): `rg "bg-cosmic|backdrop-blur|white/|blue-|purple-|red-" src/components/auth src/pages/auth` returns nothing — 11a8a35
- [x] 2.3 `npm run smoke` passes (sign-in page renders the anonymous nav, sign-up → `/auth/confirm-email`, wrong password → `/auth/signin?error=`) — 11a8a35

#### Manual

- [x] 2.4 `/auth/signin?error=Anything%20you%20like` shows "Could not sign in. Try again.", not the crafted text — 11a8a35
- [x] 2.5 A wrong password shows "Wrong email or password." in a destructive `Alert` — 11a8a35
- [x] 2.6 Submitting empty fields shows field errors, focus lands on the first invalid field, and a screen reader (or the accessibility tree) announces the input as invalid with its message — 11a8a35
- [x] 2.7 A valid submit disables the button with the spinner and "Signing in…"; Back from the dashboard shows the button enabled again — 11a8a35
- [x] 2.8 Tab order: email → password → toggle → submit → sign-up link, each with the token focus ring — 11a8a35

### Phase 3: Dashboard, 403 and Banner on tokens

#### Automated

- [x] 3.1 `npm test` (including the new `roleLabel` test), `npm run lint`, `npx astro check` pass — 278003f
- [x] 3.2 No literal hits: `rg "bg-cosmic|white/|blue-|purple-|#[0-9a-fA-F]{3,8}" src/pages/index.astro src/pages/403.astro src/components/dashboard src/components/system src/components/Banner.astro` returns nothing — 278003f
- [x] 3.3 `npm run smoke` passes (`data-dashboard`, "Access denied" on every 403 step) — 278003f

#### Manual

- [x] 3.4 `/` as manager shows the Manager pill and the manager links; as employee the Employee pill; link buttons show the token hover and focus ring — 278003f
- [x] 3.5 An employee on `/manager/users` sees the token 403 panel with "Go home" leading to `/` — 278003f
- [x] 3.6 With `SUPABASE_URL` unset in `.dev.vars`, every page shows the English destructive banner above the top bar (restore the value afterwards) — 278003f

### Phase 4: `/manager/months` on tokens

#### Automated

- [x] 4.1 `npm test`, `npm run lint`, `npx astro check` pass — 867c53b
- [x] 4.2 No literal hits: `rg "bg-cosmic|white/|blue-|purple-|red-|green-" src/pages/manager/months.astro src/components/manager-months` returns nothing — 867c53b
- [x] 4.3 `npm run smoke` passes (`?updated=1` prefixes, `?error=` prefix, exact `UNLOCK_WITH_DRAFT_ERROR`, lock refused for an employee) — 867c53b

#### Manual

- [x] 4.4 Locking and unlocking a month shows "Month updated." inside that month's row — 867c53b
- [x] 4.5 Unlocking a month with a draft shows the discard-first message in that row — 867c53b
- [x] 4.6 `/manager/months?error=crafted%20text&month=<an upcoming month>` shows "Could not update the month. Try again." in that row; with no or an invalid `month` it shows at the top — 867c53b
- [x] 4.7 With the lock read forced to fail (e.g. temporarily misspell the table name locally), the page shows only "Could not load the month locks. Reload the page." with no list or buttons; restore afterwards — 867c53b
- [x] 4.8 A double click on Lock sends one POST (network tab), and Back re-enables the button — 867c53b

### Phase 5: States and visual gate

#### Automated

- [x] 5.1 Route inventory and navigation tests pass: `npx vitest run src/lib/route-inventory.test.ts src/lib/navigation.test.ts` — 4341812
- [x] 5.2 `npm test`, `npm run lint`, `npx astro check` pass — 4341812
- [x] 5.3 Production build returns 404 for each kitchen sink: `npm run build && npm run preview`, then `curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/dev/auth-states` (and the other three) prints `404` — 4341812

#### Manual

- [x] 5.4 Each kitchen sink renders every listed state in `astro dev` with no console errors, and its forms do not submit — 4341812
- [ ] 5.5 After screenshots and the README exist; reviewer compares before/after and accepts the look at 1280 and 390 (no horizontal scroll at 390)

### Phase 6: Make it stick

#### Automated

- [x] 6.1 Colour check passes on the whole scope: `npm run check:ui`
- [x] 6.2 `rg -n "bg-cosmic" src` returns nothing; `rg -n "LibBadge" src` returns nothing
- [x] 6.3 `npm test`, `npm run lint`, `npx astro check`, `npm run build` pass
- [x] 6.4 `npm run smoke` passes against a fresh local build
- [x] 6.5 A deliberately added `text-purple-300` in `src/pages/manager/months.astro` makes `node scripts/check-ui-literals.mjs src/pages/manager/months.astro` exit non-zero (revert afterwards)

#### Manual

- [x] 6.6 CLAUDE.md no longer mentions legacy views or `bg-cosmic` as a pattern, and the new modules are named where an agent will look for feedback rules
- [x] 6.7 A quick visual pass over every app page in `astro dev` shows no remaining purple/blue gradient surface
