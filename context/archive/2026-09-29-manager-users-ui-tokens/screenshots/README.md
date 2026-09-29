# Screenshots: manager-users-ui-tokens

Captured on 2026-09-29 with headless Chrome over the DevTools protocol, against `astro dev` and the local Supabase stack, signed in as the seeded `manager@example.com`. `<route>-1280.png` is 1280 wide and `<route>-390.png` is 390 wide; full-page unless noted, with Astro's dev toolbar hidden. The local database holds extra `manual-*` / `smoke-*` accounts left by earlier smoke runs, so the live list is longer than the seed.

## Files

| File                                                                        | Route                                                         | State captured                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `before/manager-users-1280.png`, `before/manager-users-390.png`             | `/manager/users`                                              | baseline                                                          |
| `before/manager-users-error-1280.png`                                       | `/manager/users?error=Cannot%20demote%20the%20last%20manager` | baseline error box at the top                                     |
| `before/availability-1280.png`                                              | `/availability`                                               | unchanged reference                                               |
| `after/manager-users-states-1280.png`, `after/manager-users-states-390.png` | `/dev/manager-users-states` (dev only)                        | every row and page-level state                                    |
| `after/manager-users-1280.png`, `after/manager-users-390.png`               | `/manager/users`                                              | default list                                                      |
| `after/manager-users-focus-select.png`                                      | `/manager/users` (viewport)                                   | keyboard focus (Tab) on the first row's `RoleSelect`              |
| `after/manager-users-focus-save.png`                                        | `/manager/users` (viewport)                                   | keyboard focus (Tab ×2) on the first row's Save                   |
| `after/manager-users-tab-order.png`                                         | `/manager/users` (viewport)                                   | Tab ×4 lands on the second row's Save (select → Save, row by row) |
| `after/manager-users-focus-back.png`                                        | `/manager/users` (viewport)                                   | keyboard focus (Tab from the last Save) on "Back to dashboard"    |
| `after/manager-users-hover-save.png`                                        | `/manager/users` (viewport)                                   | pointer hovering the first Save (`bg-secondary/80`)               |
| `after/availability-1280.png`                                               | `/availability`                                               | unchanged reference                                               |

## Before → after

- **Surface.** Before: `bg-cosmic` hex gradient, a translucent glass card centred in the viewport, a blue→purple gradient `h1`, and blue/purple literal text. After: the shadcn neutral dark tokens, the same shell as `/availability` (`bg-background`, `h1 text-2xl font-semibold`, list in a `bg-card` panel with `rounded-xl` and a token border, `divide-y` rows).
- **Controls.** The native `<select>` with the `text-black` option hack is `NativeSelect size="sm"` (rendered with its options by `RoleSelect.tsx`, so the current role is `selected`). Save is `Button secondary sm`; "Back to dashboard" is `buttonVariants({ variant: "outline" })`, as on `/availability`.
- **Self marker.** "(you)" in purple text is a "You" pill (`bg-secondary text-secondary-foreground`).
- **Feedback.** The red/green boxes at the top of the card are `Alert`s inside the row the save concerns (`&user=<id>` in the redirect): destructive + `CircleAlert` for errors, `role="status"` + `CircleCheck` for "Role updated.". Feedback for an unknown user id falls back to a top `Alert`. Unknown `?error=` text shows "Could not update the role. Try again."; raw database text is logged, never shown.
- **Load failure.** Before, a failed load rendered the error plus "No accounts found.". After, only a destructive `Alert` renders in the panel.
- **Missing email.** Before, an empty label and "Save role for " as the accessible name. After, "No email · <first 8 of id>" in `text-muted-foreground`, with controls named "Role for user <short id>" / "Save role for user <short id>".
- **Focus.** Every control shows the token ring (`ring-ring/50`, 3px, `border-ring`); before, only the browser default outline.
- **Pending.** Save is disabled with `aria-busy="true"` while its POST is in flight; a double click sends one POST, and Back re-enables it.
- **`/availability`.** Unchanged: `after/availability-1280.png` matches `before/availability-1280.png`.

## 7-state matrix

| State    | Shown / N/A                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| default  | Shown: `manager-users-*.png`, kitchen sink "Default (employee)" and "Self (manager, You pill)"                                                   |
| empty    | Shown: kitchen sink "Empty list" (and "Missing email" for an empty field)                                                                        |
| loading  | N/A: SSR + full-page form POST; there is no client-side loading phase. The in-flight POST is the pending state below.                            |
| error    | Shown: kitchen sink "Row error", "Load failure (no list)" and "Top-level fallback feedback"                                                      |
| success  | Shown: kitchen sink "Row success"                                                                                                                |
| disabled | Shown: kitchen sink "Pending (Save in flight)" (Save `disabled aria-busy="true"`); live on `/manager/users` via the submit script                |
| focus    | Shown: `manager-users-focus-select.png`, `manager-users-focus-save.png`, `manager-users-focus-back.png`; hover in `manager-users-hover-save.png` |
