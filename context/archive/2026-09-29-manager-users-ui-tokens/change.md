---
change_id: manager-users-ui-tokens
title: Make the /manager/users view read the shadcn design tokens
status: archived
created: 2026-09-29
updated: 2026-09-29
archived_at: 2026-09-29T12:08:33Z
---

## Notes

UI change run through `/10x-ui`.

- **View (one):** `/manager/users` (`src/pages/manager/users.astro`): the user list, the per-row role form (select + Save), and the success/error flash; the POST target is `src/pages/api/manager/users/role.ts`.
- **Motif / token source (one):** the existing shadcn "new-york" neutral values in `src/styles/global.css` (`:root` / `.dark`, published through `@theme inline`), with the role map from `context/archive/2026-09-28-availability-ui-tokens/tokens.md` — the same contract `/availability` already reads. No new palette, no second `shadcn init`.
- **Variant:** fresh starter whose screens ignore its own tokens. Tokens and `src/components/ui/` (`alert`, `button`, `input`) exist and `/availability` uses them; this view uses none (0 token/`ui/` usages).
- **Starting point (pre-audit scan):** 12 hardcoded-value hits in `users.astro` (lines 31, 32, 36, 43, 49, 51, 57, 59, 69, 72, 80, 93), plus `bg-cosmic` on line 30 (a hex-gradient utility at `global.css:115`).
- **Draft charges for research to confirm:** (1) palette literals / glass card / gradient heading; (2) hand-rolled alerts and buttons shadowing `Alert`/`Button`, native `<select>` with a `text-black` option hack, browser-default focus; (3) raw DB/RLS message via `?error=` shown at page top, not at the failing row, and sticky `?updated=1`; (4) load failure renders the error plus "No accounts found." together; (5) no UI/token rule in `CLAUDE.md` after the `/availability` change, and `bg-cosmic` still used by 8 views.
- **Out of scope:** `/manager/months`, `/dashboard`, auth pages, 403 and `Welcome` (all still on `bg-cosmic`); recorded as deferred, not fixed here.
- **New dependencies:** none planned. A missing shadcn component is added with `npx shadcn@latest add <name>` into the existing `src/components/ui/`.
- **Kitchen sink:** follow the dev-only pattern of `src/pages/dev/availability-states.astro`.
