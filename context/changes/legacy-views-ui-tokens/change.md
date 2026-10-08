---
change_id: legacy-views-ui-tokens
title: Legacy views on the design tokens
status: impl_reviewed
created: 2026-10-08
updated: 2026-10-08
archived_at: null
---

## Notes

Roadmap S-09 (MS-04, GitHub #44). UI change run through the `/10x-ui` chain.

- **Views (six, one change unless split at planning):** the dashboard `/` (`src/pages/index.astro`), sign-in, sign-up and confirm-email (`src/pages/auth/*.astro` + the React forms in `src/components/auth/`), the 403 page (`src/pages/403.astro`) and `/manager/months` (`src/pages/manager/months.astro`).
- **Token source (one):** the existing shadcn "new-york" neutral values in `src/styles/global.css` (`:root` / `.dark`, published through `@theme inline`) and the role map in `context/archive/2026-09-28-availability-ui-tokens/tokens.md`. No new palette, no second `shadcn init`.
- **Variant:** existing design system; these six views read none of it except one overridden `Button` in `src/components/auth/SubmitButton.tsx`.
