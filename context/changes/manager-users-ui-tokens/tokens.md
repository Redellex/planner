# Token role map: /manager/users

Source: shadcn/ui new-york, `baseColor: neutral` (`components.json`), values in `src/styles/global.css` (`:root` / `.dark`, published via `@theme inline`); the app renders the `.dark` set. No value changes in this change.

## Reused rows

These rows come unchanged from the `/availability` map in `context/archive/2026-09-28-availability-ui-tokens/tokens.md`: page, panel, secondary text, focus, error, success, buttons and inputs.

## New rows for this view

| UI role             | Token / component                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| select              | `NativeSelect size="sm"` via `src/components/manager/RoleSelect.tsx`                                                                         |
| self marker         | "You" pill: `rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground` (a token composition, not a new component) |
| list divider        | `divide-y` over the base `border-border`                                                                                                     |
| row feedback        | `Alert` inside the row (destructive + `CircleAlert`, or `role="status"` + `CircleCheck`)                                                     |
| missing-email label | `text-muted-foreground`                                                                                                                      |
