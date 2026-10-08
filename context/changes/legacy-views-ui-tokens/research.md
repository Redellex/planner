---
date: 2026-10-08T14:12:18+02:00
researcher: Claude (Opus 5.5) for Redellex
git_commit: 19c6cb3dced302110a7a4253cffd81276b0394a7
branch: docs/s07-done
repository: Redellex/planner
topic: "Legacy views on the design tokens (S-09): two-way audit of the dashboard, auth pages, 403 and /manager/months"
tags: [research, ui, design-tokens, shadcn, auth, manager-months, dashboard, 403, check-ui, kitchen-sink]
status: complete
last_updated: 2026-10-08
last_updated_by: Claude (Opus 5.5)
---

# Research: Legacy views on the design tokens (S-09)

**Date**: 2026-10-08T14:12:18+02:00
**Researcher**: Claude (Opus 5.5) for Redellex
**Git Commit**: 19c6cb3
**Branch**: docs/s07-done
**Repository**: Redellex/planner

## Research Question

Roadmap S-09 (`context/foundation/roadmap.md:122-133`, GitHub #44): what do the dashboard `/`, the sign-in, sign-up and confirm-email pages, the 403 page and `/manager/months` need in order to move onto the shadcn design tokens? Each must end with a kitchen sink and be inside the `check:ui` scope. This document is the `/10x-ui` two-way audit (source → views and view → source). It also covers what the restyle must not break and which decisions are left for `/10x-plan`.

## Summary

- **Literals.** The six legacy views plus their React auth components have **49 lines with colour literals** (hardcoded-value scan below, run on 11 files). Exactly one import from `src/components/ui/` exists: `Button` in `src/components/auth/SubmitButton.tsx:3`, and line 18 overrides its colour with `bg-purple-600`.
- **Styling.** All six pages use the same legacy shell: `bg-cosmic`, a glass card (`bg-white/10 backdrop-blur-xl`) and a gradient-text `h1`.
- **Token source.** The tokens these views need already exist: page, panel, muted text, `Alert`, `Button`/`buttonVariants`, `Input`, divider and the "You" pill. They are in `src/styles/global.css` and the role maps in `context/archive/2026-09-28-availability-ui-tokens/tokens.md` and `context/archive/2026-09-29-manager-users-ui-tokens/tokens.md`. No new token or shadcn component is required for the default state.
- **Two architecture defects matter more than the colours:**
  1. **Raw error text.** The auth pages (`?error=` → `ServerError`) and `/manager/months` (`?error=` and `queryError.message`) render any text from the URL or from the database as-is. The rule in `CLAUDE.md` ("Feedback") forbids this.
  2. **`/manager/months` fails open.** When the lock read fails, every month is shown as "Open" with a Lock button.
- **Loading state.** `SubmitButton`'s pending state is very probably never reached. The forms post to a URL, and `useFormStatus` tracks form submissions that React manages (inference from the React docs; see "Auth forms").
- **Guards.** The restyle has to keep these smoke contracts:
  - `data-dashboard`
  - the text "Access denied"
  - `<Layout>` on the auth pages, which renders `AppNav`'s `data-nav-link`
  - `?error=` on a wrong password
  - the exact unlock-refused message in the redirect URL
- **New kitchen sinks.** Each new kitchen sink also needs a `"public"` row in `src/lib/route-inventory.test.ts:24-29`.

## Charges

The `/10x-ui` audit uses three categories: T = missing tokens, C = missing shared component, A = accidental architecture. Each charge gives file:line evidence and its effect on the user.

| #   | Cat. | Charge                                                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Effect on the user                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ---- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | T    | Six pages render the legacy shell instead of page/panel tokens           | `bg-cosmic` wrapper at `src/pages/index.astro:12`, `403.astro:9`, `auth/signin.astro:9`, `auth/signup.astro:9`, `auth/confirm-email.astro:22`, `manager/months.astro:36`. Glass card (`border-white/10 bg-white/10 … text-white backdrop-blur-xl`) on the next line of each. Gradient `h1` (`from-blue-200 to-purple-200 bg-clip-text text-transparent`) at `index.astro:17`, `403.astro:11`, `signin.astro:11`, `signup.astro:11`, `confirm-email.astro:25`, `months.astro:38`. Muted text as `text-blue-100/50…/80` and links as `text-purple-300` across the same files | The first pages a user sees (sign-in, then home) and the 403 page look like a different app from the token views (`/availability`, `/schedule`, `/account`). Their blue/purple text on a hex gradient is outside the contrast of the neutral tokens.                                                                                                                                                                                                                                                                    |
| C2  | C    | Hand-built controls shadow `Input`, `Alert` and `Button`                 | **Input:** `FormField.tsx:5-6,42-55` (`bg-white/10`, `focus:ring-purple-400`, `border-red-400/60` on error). **Alert:** `ServerError.tsx:11` and `months.astro:45` (red) and `:52` (green). **Button:** `months.astro:31-32,72-78` (button string) and `index.astro:32-37` (dashboard links). **Overrides:** `SubmitButton.tsx:18,22` (purple and a white spinner over `Button`) and `PasswordToggle.tsx:13` (`text-white/40`)                                                                                                                                             | Focus differs from the rest of the app: purple ring on auth inputs, global `outline-ring/50` elsewhere. A field error is shown only in colour plus a small icon: no `aria-invalid`, and the message is not tied to its input with `aria-describedby` (`FormField.tsx:42-61`), so a screen reader does not hear which field failed. The server error and the months alerts (`ServerError.tsx:11`, `months.astro:45`) have no `Alert` semantics. The error `<p>` in months has `role="alert"`; `ServerError` has no role. |
| C3  | A    | Error text comes straight from the URL or the database                   | **Auth:** `auth/signin.astro:5,14` and `auth/signup.astro:5,14` pass `Astro.url.searchParams.get("error")` to `ServerError`, which renders it (`ServerError.tsx:13`). `api/auth/signin.ts:16` and `api/auth/signup.ts:16` redirect with Supabase's raw `error.message`. **Months:** `months.astro:8` renders `?error=` as-is (`:44-47`) and `:23` puts `queryError.message` there. **Lock endpoint:** `api/manager/months/lock.ts:67` redirects with raw `error.message` for every error except the unlock 23503                                                           | Anyone can send a link like `/auth/signin?error=<any sentence>` and the sign-in page shows that sentence in an error box. Database or auth internals reach the screen. Every other view uses an allow-list (`resolveScheduleFeedbackError` at `src/lib/schedule.ts:82-87`, `resolveAccountFeedbackError` used at `src/pages/account.astro:17`).                                                                                                                                                                         |
| C4  | A    | `/manager/months` fails open on a failed read                            | `months.astro:15-29`: on `queryError` the `lockedAt` map stays empty, and `:58-79` still lists every month as "Open" with a **Lock** button. `error ??= …` (`:16,23`) lets a `?error=` already in the URL hide the read error. Recorded as an accepted legacy gap in `context/foundation/test-plan.md:237`                                                                                                                                                                                                                                                                 | When the read fails, a manager sees a locked month as "Open" and is offered "Lock" for it. With a stale `?error=` in the URL, the manager does not learn that the page failed to load at all.                                                                                                                                                                                                                                                                                                                           |
| C5  | A    | Nothing guards these views, and leftovers keep the legacy contract alive | None of the six views is in `SCOPE` (`scripts/check-ui-literals.mjs:16-35`). There is no kitchen sink (`src/pages/dev/` holds 6 others). `@utility bg-cosmic` (`src/styles/global.css:121-123`) exists only for these views. `src/components/ui/LibBadge.astro` (2 literal lines, `:10,12`) is imported nowhere (repo grep: 0 imports). `CLAUDE.md` "Legacy" bullet lists the views as do-not-copy. `global.css:6` points at `context/changes/availability-ui-tokens/tokens.md`, a path that moved to `context/archive/`                                                   | Without a scope entry, a later edit can bring the literals back unnoticed. While `bg-cosmic` and the legacy markup exist, an agent has a second contract to copy.                                                                                                                                                                                                                                                                                                                                                       |

**Candidate or deferred (the plan decides; not counted among the charges):**

- **`src/components/Banner.astro:27-41`** carries 9 hex-literal lines in a scoped `<style>`: a light-blue/amber/red strip on the dark app. It also has Polish copy ("Uwaga", "Dokumentacja") at `src/layouts/Layout.astro:33,38` in an English UI.
  - It renders on every page, but only while Supabase secrets are missing (`Layout.astro:31-44`, `src/lib/config-status.ts:21`).
  - `Layout.astro` is in the `check:ui` scope (`check-ui-literals.mjs:31`); `Banner.astro` is not, so the check does not see it.
  - It is not one of the S-09 views. Fold it in or defer it with that reason.
- **Return URL after sign-in** (deferred earlier: `context/archive/2026-09-28-availability-ui-tokens/plan.md:64`). This is auth behaviour, not UI.
- **`/manager/availability`** is parked as outside MS-04 (`roadmap.md:152`).

## Detailed Findings

### Hardcoded-value scan (pre-audit counts)

This is the `/10x-ui` grep, extended with `bg-cosmic|backdrop-blur|text-transparent`. Counts are lines with a hit, at commit 19c6cb3:

| File                                      | Lines  | Hit lines                     |
| ----------------------------------------- | ------ | ----------------------------- |
| `src/pages/index.astro`                   | 9      | 12,15,17,20,21,24,26,29,34    |
| `src/pages/403.astro`                     | 5      | 9,10,11,14,15                 |
| `src/pages/auth/signin.astro`             | 5      | 9,10,11,15,17                 |
| `src/pages/auth/signup.astro`             | 5      | 9,10,11,15,17                 |
| `src/pages/auth/confirm-email.astro`      | 5      | 22,23,25,28,29                |
| `src/pages/manager/months.astro`          | 10     | 32,36,37,38,41,45,52,57,64,65 |
| `src/components/auth/FormField.tsx`       | 5      | 6,37,41,53,59                 |
| `src/components/auth/PasswordToggle.tsx`  | 1      | 13                            |
| `src/components/auth/ServerError.tsx`     | 1      | 11                            |
| `src/components/auth/SignInForm.tsx`      | 0      | —                             |
| `src/components/auth/SignUpForm.tsx`      | 1      | 59                            |
| `src/components/auth/SubmitButton.tsx`    | 2      | 18,22                         |
| **Total (S-09 views + their components)** | **49** |                               |
| `src/components/Banner.astro` (candidate) | 9      | 28-30,33-35,38-40             |
| `src/components/ui/LibBadge.astro` (dead) | 2      | 10,12                         |

`node scripts/check-ui-literals.mjs src/pages/index.astro` exits 0 today only because the file is outside `SCOPE`. Archived counts from before S-06/S-07 (for example "dashboard.astro 11", `context/archive/2026-09-28-availability-ui-tokens/research.md:85-92`) are stale. The counts above replace them.

### Dashboard `/` (`src/pages/index.astro`)

- **Links.** It renders `navLinksFor(...)` without Home (`:8`) as hand-built link pills (`:31-38`). Use `buttonVariants` for these, as the CLAUDE.md role map says ("actions `Button` / `buttonVariants` (links too)").
- **Copy:**
  - Starter text "This page is only for authenticated users." (`:29`).
  - The role is shown as the raw enum value, with purple for manager (`:23-28`).
  - Both are content choices for the plan, not token issues.
- **Smoke marker.** `data-dashboard` on the card (`:14`) is checked by `scripts/smoke.mjs:223`. Keep it.
- **States.** It has no data read, so there is no empty, error or loading state. A signed-in user with `role === null` hides the role line (`:23`). That is the one variant the kitchen sink needs besides employee and manager.

### Auth pages and forms

- **Pages.** `signin.astro` and `signup.astro` are thin shells around React islands (`client:load`, `:14`). They need interactivity (client validation, password toggle), so `client:load` is justified under "React components only where interactivity is needed".
- **`FormField.tsx` input.** It hand-rolls the input (C2). The repo's `Input` (`src/components/ui/input.tsx:9-13`) already has token focus (`focus-visible:ring-ring/50 ring-[3px]`) and invalid styling through `aria-invalid:border-destructive`. Passing `aria-invalid` plus `aria-describedby` to an error id fixes the semantics and the colour together.
- **`FormField.tsx` icon.** The leading icon sits at `left-3` with `pl-10` on the input (`FormField.tsx:6,41`). It needs a `pl-*` className override on `Input`.
- **Field errors are component state** (`SignInForm.tsx:16`, `SignUpForm.tsx:20`), so a kitchen sink cannot show them through `SignInForm`/`SignUpForm` as they are. Options for the plan:
  - render `FormField` directly with an `error` prop, or
  - add an initial-errors prop.
- **Server error** (`ServerError.tsx`) is shown below the fields (`SignInForm.tsx:80`), next to the submit action. That position is fine; the semantics are not (C2), and neither is the source of the text (C3).
- **Supabase error codes.** `AuthError` has a `code` (`node_modules/@supabase/auth-js/dist/module/lib/errors.d.ts:20`). The `ErrorCode` union (`…/lib/error-codes.d.ts:6`, `@supabase/auth-js` 2.116.0) includes `invalid_credentials`, `email_not_confirmed`, `user_already_exists`, `email_exists`, `weak_password`, `over_request_rate_limit`, `over_email_send_rate_limit`, `signup_disabled` and `email_address_invalid`. That makes a code → message map possible, logging the raw message, the way `src/lib/account.ts` does. Which codes to map is a plan decision. Smoke only needs a redirect starting with `/auth/signin?error=` on a wrong password (`smoke.mjs:211-212`).
- **Loading state.**
  - `SubmitButton` reads `useFormStatus().pending` (`SubmitButton.tsx:12`). The forms are native posts to a URL (`SignInForm.tsx:43`, `SignUpForm.tsx:66`).
  - React's docs say `status.action` is `null` when the form's `action` is a URI. Their pending examples all use function actions (react.dev `useFormStatus` reference, via Context7).
  - **Inference, not run:** `pending` never becomes `true` here, so "Signing in…" and the spinner (`:20-24`) never show, and the button is never disabled during submit.
  - The plan can either drop the dead branch or, as in earlier changes, mark loading "N/A for SSR + full-page post" and show the disabled look in the kitchen sink. Verify in a browser before deleting it.
- **Password minimum.** `SignUpForm.tsx:8` uses `MIN_PASSWORD_LENGTH = 6`, matching local `supabase/config.toml:175`. The hosted value was not checked.
- **`confirm-email.astro`:**
  - It switches its copy on `import.meta.env.DEV` (`:4`), not on whether confirmation is on.
  - Locally, sign-up redirects there (`api/auth/signup.ts:19`), but with `enable_confirmations = false` (`supabase/config.toml:209`) the new user already has a session. `/auth/confirm-email` is a guest route (`src/lib/route-access.ts:19`), so the middleware sends that user to `/` (archived as `context/archive/2026-10-08-dashboard-as-home/plan.md:50`). Its two states can be seen only in a kitchen sink.
  - It uses emoji as the icon (`:8,14`). A lucide icon would match the rest of the UI (plan choice).

### 403 (`src/pages/403.astro`)

- **Rendering.** The status is set for any method (`:5`). It is reached by a middleware rewrite whenever `routeAccess` returns `forbidden`, which happens only for `MANAGER_ROUTES` with a signed-in non-manager (`src/lib/route-access.ts:40-46`, `src/middleware.ts:32-33`). So the copy "This area is available to managers only." (`:15`) is true on that path.
- **Direct visits.** `/403` is also public when visited directly (`src/lib/route-inventory.test.ts:16`), where the line does not apply. This is minor.
- **Smoke.** `smoke.mjs:123-124` (`isAccessDenied`) matches the text "Access denied". Keep it.
- **States.** The kitchen sink needs only one state.

### `/manager/months` (`src/pages/manager/months.astro`)

- **List.** It is a plain list of `upcomingMonths()` with Lock/Unlock forms (`:57-83`). The rows match the manager-users role map: `divide-y` list, row with action, `Button` (outline or secondary).
- **Lock status line** (`:65-67`, `text-purple-200` when locked). The schedule views already have a "locked" treatment to reuse; the availability map uses "success / locked → `Alert` default + icon". Plan choice.
- **Allow-list for page feedback** (C3):
  - Known messages: `"Invalid month"` and `"Invalid action"` (`lock.ts:22,25`), `SUPABASE_NOT_CONFIGURED_ERROR`, `UNLOCK_WITH_DRAFT_ERROR` and `UNLOCK_WITH_PUBLISHED_ERROR` (`src/lib/schedule.ts:23-30`).
  - Anything else becomes a generic message, and `lock.ts:67` should log the raw text the way `:45-49` already does.
  - Smoke compares the redirect URL's `error` param with `UNLOCK_WITH_DRAFT_ERROR` exactly (`smoke.mjs:552-557`), so the endpoint must keep sending that exact message. The page allow-list must accept it.
- **Honest read** (C4). When the lock read fails, show only the load error, the same pattern as `buildTeamView`/`unknown` in `/manager/availability` and the account page (`src/pages/account.astro:25-42,49-55`).
- **Pending state.** None: plain forms with full-page posts.

### Contracts the restyle must keep

- **Smoke:**
  - `data-dashboard` (`smoke.mjs:223`)
  - "Access denied" (`:123-124`)
  - `data-nav-link` and the sign-out form, which come from `AppNav` through `<Layout>`, so the auth pages must keep `<Layout>` (`:194-199`, `:129`, `:134`)
  - `/auth/signin?error=` prefix (`:212`)
  - `/manager/months?updated=1` (`:418,431,570`)
  - exact `UNLOCK_WITH_DRAFT_ERROR` (`:552-557`)
- **Layout:** pages fill the space below the bar with `flex-1` inside the single `<main id="main">` (`src/layouts/Layout.astro:46-48`). Pages must not add their own `<main>` or `min-h-screen` (S-07 impl-review F1, per the archive).
- **Route inventory:** every new `src/pages/dev/<view>-states.astro` needs a `"public"` row next to `src/lib/route-inventory.test.ts:24-29`. `src/lib/navigation.test.ts` skips `/dev/` pages (CLAUDE.md, Navigation bullet).
- **Kitchen-sink shape:** dev-only with a 404 status outside dev, fixtures only, forms inert. Model: `src/pages/dev/account-states.astro:16-21`.

### 7-state matrix per view (for the states phase)

| View          | default            | hover                | focus-visible                | disabled                         | error                                                          | empty                                     | loading                                   |
| ------------- | ------------------ | -------------------- | ---------------------------- | -------------------------------- | -------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| Dashboard     | yes                | link buttons         | link buttons                 | N/A (no forms)                   | N/A (no read)                                                  | role `null` (no role line)                | N/A (SSR)                                 |
| Sign in / up  | yes                | submit, toggle, link | inputs, toggle, submit, link | submit (see the loading finding) | field errors + server error                                    | N/A (form)                                | pending branch, probably dead (see above) |
| Confirm email | 2 copies           | link                 | link                         | N/A                              | N/A                                                            | N/A                                       | N/A                                       |
| 403           | yes                | N/A (or a Home link) | N/A                          | N/A                              | the page is itself an error state                              | N/A                                       | N/A                                       |
| Months        | open + locked rows | Lock/Unlock          | Lock/Unlock                  | N/A (no pending script)          | allow-listed write error; load error shows only the alert (C4) | N/A (always 3 months: `upcomingMonths()`) | N/A (SSR)                                 |

## Code References

- `src/pages/index.astro:8,12-41`: dashboard grid and legacy shell; `data-dashboard` at `:14`.
- `src/pages/403.astro:5,9-17`: status 403 and the "Access denied" copy.
- `src/pages/auth/signin.astro:5,14` and `src/pages/auth/signup.astro:5,14`: raw `?error=` passed to the island.
- `src/pages/auth/confirm-email.astro:4-18`: DEV-switched copy.
- `src/pages/manager/months.astro:8,15-29,44-56,58-79`: raw errors, fail-open read, list.
- `src/pages/api/manager/months/lock.ts:42-67`: 23503 mapping (kept) and raw fallback (`:67`).
- `src/pages/api/auth/signin.ts:16`, `src/pages/api/auth/signup.ts:16`: raw Supabase `error.message` in the redirect.
- `src/components/auth/FormField.tsx:5-61`: hand-built input and error.
- `src/components/auth/ServerError.tsx:11`, `SubmitButton.tsx:12-31`, `PasswordToggle.tsx:13`.
- `src/components/ui/input.tsx:9-13`, `src/components/ui/button.tsx:8`: the token focus and invalid styles to reuse.
- `src/styles/global.css:6` (stale path comment), `:121-123` (`bg-cosmic`).
- `src/components/Banner.astro:27-41`, `src/layouts/Layout.astro:31-44`: candidate.
- `scripts/check-ui-literals.mjs:16-35`: `SCOPE`.
- `src/lib/route-inventory.test.ts:16-29,39,42`: rows for `/403`, the auth pages, kitchen sinks and months.
- `src/lib/schedule.ts:23-30,64-87`: unlock messages and the allow-list pattern.

## Architecture Insights

- **One shared contract, applied view by view.** Tokens and components already exist and are used by every non-legacy view. The established flow is:
  1. audit into charges
  2. `tokens.md` (only the new rows)
  3. restyle with `ui/` components
  4. allow-listed feedback with raw errors logged
  5. kitchen sink with screenshots at 1280 and 390
  6. add the files to `check:ui` `SCOPE`
  7. update the `CLAUDE.md` rule

  Sources: `context/archive/2026-09-28-availability-ui-tokens/` and `context/archive/2026-09-29-manager-users-ui-tokens/`.

- **No-hydration rule.** It applies to the dashboard, 403, confirm-email and months: none needs a `client:*` directive. The auth forms are the one justified React island, so their restyle happens in `.tsx` with the same `ui/` components.
- **Removing the legacy contract.** After S-09 nothing should reference `bg-cosmic`. Deleting the utility from `global.css` and dropping the "Legacy" bullet from `CLAUDE.md` takes the legacy option away from future agents. No archived lesson records this (`context/foundation/lessons.md` does not exist).

## Historical Context (from prior changes)

- **Each earlier token cleanup deferred these views** under its one-view rule:
  - `context/archive/2026-09-28-availability-ui-tokens/plan.md:61`, `change.md:17`.
  - `context/archive/2026-09-29-manager-users-ui-tokens/plan.md:69` (D1 names `/manager/months` "the natural next change"), `change.md:19`.
- **S-06 moved the dashboard to `/` unchanged:** "Legacy classes stay; S-09 restyles" (`context/archive/2026-10-08-dashboard-as-home/plan.md:19,35,103`). Supported: `index.astro` still has the legacy classes.
- **S-07 removed `min-h-screen` and the back links but did no restyle** (`context/archive/2026-10-08-role-aware-navigation/plan.md:42`). Supported: the wrappers are `flex flex-1` (`index.astro:12` and others).
- **The months fail-open and raw-error gaps were accepted as legacy** in `context/foundation/test-plan.md:237` (Phase 3) and `context/archive/2026-10-03-testing-route-gating-honest-reads/research.md`. Supported by `months.astro:15-29`.
- **The test-plan §7 exclusion** of legacy views says "Re-evaluate when a legacy view is moved onto tokens" (`context/foundation/test-plan.md:258`). S-09 triggers that re-evaluation. Whether to add unit tests for a months/auth message allow-list is a plan choice.
- **Default `<title>`.** "10x Astro Starter" was noted as a leftover (role-aware-navigation `plan.md:47`). It is still the default at `src/layouts/Layout.astro:11`. All six S-09 pages pass their own title, so it does not show on them.

## Related Research

- `context/archive/2026-09-28-availability-ui-tokens/research.md`: charge template and base role map.
- `context/archive/2026-09-29-manager-users-ui-tokens/research.md`: charge and 7-state template, allow-list pattern.
- `context/archive/2026-10-03-testing-route-gating-honest-reads/research.md`: honest-read rule (§6.4) and the months fail-open finding.

## Open Questions

1. **One change or several?** `/10x-ui` says one view per change. The roadmap allows one S-09 change and says to split it if it grows (`roadmap.md:131-132`).
   - Natural grouping: (a) auth pages and their forms, (b) dashboard + 403 + confirm-email (static), (c) `/manager/months` (C3 + C4 write and read logic).
   - Owner: user, at `/10x-plan`.
2. **Auth error messages.** Which Supabase codes get their own message, and what is the generic text for the rest? Must the endpoints change, or only the pages' rendering of `?error=`? Owner: user, at planning.
3. **`Banner.astro`.** Restyle it onto `Alert` (and fix the Polish copy) inside S-09, or defer it with the reason that it only shows while unconfigured? Owner: user.
4. **Content beyond tokens.** Dashboard starter text and raw role label, emoji on confirm-email, the 403 copy on direct visits, and the possibly dead pending branch in `SubmitButton`. Owner: user. These are UI decisions, not evidence gaps.
5. **Clean-up at the end.** Delete `@utility bg-cosmic` and `LibBadge.astro`, fix the stale `global.css:6` comment, and drop the CLAUDE.md "Legacy" bullet once no view uses `bg-cosmic`.
