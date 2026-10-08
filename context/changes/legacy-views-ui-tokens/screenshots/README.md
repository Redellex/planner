# Screenshots: legacy-views-ui-tokens

Captured on 2026-10-08 with headless Chrome over the DevTools protocol, against `astro dev` and the local Supabase stack. Signed-in shots use the seeded `manager@example.com` (dashboard, months) or `employee@example.com` (403). `<view>-1280.png` is 1280 wide and `<view>-390.png` is 390 wide; full page, with Astro's dev toolbar hidden. In the local database November 2026 was already locked when the shots were taken, so the months list shows one locked and two open months.

## Files

| File                                                    | Route                                              | State captured                                                 |
| ------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `before/dashboard-1280.png`, `before/dashboard-390.png` | `/` (manager)                                      | baseline                                                       |
| `before/signin-1280.png`, `before/signin-390.png`       | `/auth/signin` (anonymous)                         | baseline                                                       |
| `before/signin-error-1280.png`                          | `/auth/signin?error=Invalid%20login%20credentials` | baseline: the raw `?error=` text rendered as-is                |
| `before/signup-1280.png`, `before/signup-390.png`       | `/auth/signup` (anonymous)                         | baseline                                                       |
| `before/forbidden-1280.png`, `before/forbidden-390.png` | `/manager/users` (employee)                        | baseline 403 page                                              |
| `before/months-1280.png`, `before/months-390.png`       | `/manager/months` (manager)                        | baseline                                                       |
| `before/months-error-1280.png`                          | `/manager/months?error=anything`                   | baseline: the crafted `?error=` text rendered as-is at the top |

`/auth/confirm-email` has no before shot: it renders only for a visitor without a session, and a local sign-up signs the new user in straight away (no email confirmation), so the middleware sends them home instead.
