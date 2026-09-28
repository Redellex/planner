# Screenshots: availability-ui-tokens

Checked against the captured images on 2026-09-28.

- **`before/`** was captured by hand in Firefox, against the hosted project, at an ordinary desktop window and a narrow window. The images are not exactly 1280px / 390px.
- **`after/`** was captured with headless Firefox 156 over WebDriver BiDi, against `astro dev` and the local Supabase stack. `<route>.png` is 1280×900 and `<route>-small.png` is 390×844. Every image is full-page, with Astro's dev toolbar hidden.
- **Signed-in routes** use the seeded `employee@example.com`. For the capture, that user was given windows on the same October days as the `before/` shot, plus a few in November, which were removed afterwards.
- **October 2026** is locked locally, as it was in `before/`.

## Files

| File                                                                   | Route                                 | State captured                                                              |
| ---------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| `before/availability.png`, `before/availability-small.png`             | `/availability`                       | baseline                                                                    |
| `before/home.png`, `before/home-small.png`                             | `/`                                   | baseline                                                                    |
| `before/dashboard.png`, `before/dashboard-small.png`                   | `/dashboard`                          | baseline                                                                    |
| `before/auth-signin.png`, `before/auth-signin-small.png`               | `/auth/signin`                        | baseline                                                                    |
| `after/availability-states.png`, `after/availability-states-small.png` | `/dev/availability-states` (dev only) | every state, full page                                                      |
| `after/availability.png`, `after/availability-small.png`               | `/availability`                       | default view: October (locked), Thu 1 Oct selected, same as `before/`       |
| `after/availability-editable.png`                                      | `/availability?month=2026-11&day=…05` | an editable month, day with two windows selected (Save / Delete / Add form) |
| `after/availability-focus-day.png`                                     | `/availability`                       | keyboard focus (Tab) on Tue 10 Nov, a day cell that is not the selected day |
| `after/availability-focus-input.png`                                   | `/availability`                       | keyboard focus (Tab) on the Add form's Start time `Input`                   |
| `after/home.png`                                                       | `/`                                   | desktop only                                                                |
| `after/dashboard.png`                                                  | `/dashboard`                          | desktop only                                                                |
| `after/auth-signin.png`                                                | `/auth/signin`                        | desktop only                                                                |

## Before → after, per route

### `/availability`

- **Surface.** Before: `bg-cosmic` hex gradient, a translucent glass card, a purple gradient `h1` and purple/blue literal colours. After: the shadcn neutral dark tokens. The page is `bg-background`, panels are `bg-card` with a token border and `rounded-xl`, and the `h1` is plain `text-2xl font-semibold`.
- **Controls.** The hand-rolled `inputClass`/`buttonClass` are replaced by shared components. Month tabs use `buttonVariants` (current month `default`, others `outline`). Time fields are `Input`. Save is `Button secondary`, Delete is `Button destructive` and Add is `Button default`.
- **Day cells.** The selected day is a solid `bg-primary` fill. Days with windows are `bg-secondary` with a `bg-primary` dot and count on narrow screens. Keyboard focus is a `ring-ring/50` 3px ring with a `border-ring` border, never a fill, so focus and selection read differently. Non-selected cells hover to `bg-accent`.
- **Feedback.** Write errors and "Availability saved." move from a box at the top of the page into the day panel, next to the forms (`Alert destructive` / `Alert` + icon). Unknown `?error=` text shows the generic message. A load failure is a destructive `Alert` above the month tabs.
- **Lock notice.** "Locked — …" / "Could not check whether … is locked" moves into the day panel as an `Alert` with a lock icon. The month tab label "(Locked)" is muted.
- **Focus rings.** Every control (month tabs, day cells, inputs, checkbox, buttons) shows a visible focus ring. See `availability-focus-day.png` and `availability-focus-input.png`.
- **Pending.** A clicked submit button is disabled with `aria-busy="true"` until navigation. It is only visible in the kitchen sink (the "Pending" panel), because the live state lasts only as long as the POST.
- **Narrow width.** Same grid and dot indicators as before, with no horizontal scroll at 390px.
- **Observed in the captures.**
  - The neutral palette makes the selected day, the current month tab and the Add button near-white (`--primary`). This neutral look was accepted after the captures; a violet/navy re-tint of the `.dark` values would be a separate change, made only on request.
  - The focus ring (`--ring` at 50%) is visible but subtle on the dark cells.
  - Days with windows showed no hover change, because `--accent` equals `--secondary` in the dark set. Fixed in the implementation review: they now hover to `bg-secondary/80`, like `Button` secondary. The captures predate that fix.

### `/dev/availability-states` (new, no before)

Dev-only kitchen sink, which returns 404 in production builds. It renders from fixture data (April 2026, forms inert):

> The 404 sets `Astro.response.status` and renders an empty template instead of the planned `new Response(null, { status: 404 })`, because a frontmatter `return` crashes ESLint in `.astro` files. Astro still emits the page's hoisted script, so the production 404 body is a bare doctype plus that inert script (158 bytes), with no fixture data.

- the month tabs with one locked month;
- the calendar with a carry-over on day 1, empty days, a single window, multiple windows (selected) and a full day;
- the load-error `Alert`;
- the day panel in each state: default with windows, empty, error, success, locked, lock state unknown, and pending (with the carry-over line).

### `/`, `/dashboard`, `/auth/signin`

- **No intended change.** These views paint their own `bg-cosmic` background and literal colours, and are out of scope for this change.
- **Possible incidental differences** come from `<html class="dark">` plus `color-scheme: dark` (Phase 1):
  - native controls (form inputs, checkboxes) and the page scrollbar render with dark browser chrome;
  - areas that `bg-cosmic` does not cover (overscroll, or below short content) show `bg-background` (near-black), not white;
  - the base `border-border` / `outline-ring/50` read the dark token values.
- **Auth `SubmitButton`** (`/auth/signin`). It uses `Button`, whose base classes carry `dark:` variants that are now active, but those variants only style the `aria-invalid` ring. Its purple background and white text are explicit overrides, so the button itself should look unchanged.
- **Confirmed.** `after/home.png`, `after/dashboard.png` and `after/auth-signin.png` match their `before/` counterparts: same cosmic background, glass card, gradient heading and purple Sign in button. The only differences are window size and the signed-in user's email.
