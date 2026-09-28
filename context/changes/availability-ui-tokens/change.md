---
change_id: availability-ui-tokens
title: Make the /availability view read the shadcn design tokens
status: implemented
created: 2026-09-28
updated: 2026-09-28
archived_at: null
---

## Notes

UI change run through `/10x-ui`.

- **View (one):** `/availability` (`src/pages/availability.astro`): the calendar grid, the selected-day panel, and the add/edit/delete window forms, including the read-only locked-month state.
- **Motif / token source (one):** the existing shadcn "new-york" neutral values already in `src/styles/global.css` (`:root` / `.dark`, published through `@theme inline`). No new palette. The work is making the view read tokens the repo already ships (`bg-primary`, `text-muted-foreground`, `border`, `destructive`, `ring`…) and reuse `src/components/ui/` components instead of hand-rolled ones.
- **Starting point:** about 52 literal palette classes in `availability.astro`. This is the "fresh starter whose screens ignore its own tokens" playbook, so phase 1 is wiring up the existing tokens, not choosing a theme.
- **Out of scope:** other views (Topbar, dashboard, manager pages, auth) and a whole-MVP restyle. Anything found there is recorded as deferred.
- **New dependencies:** none planned. If a shadcn component is needed, it is added with `npx shadcn@latest add <name>` into the existing `src/components/ui/`. There will be no second `shadcn init`.
