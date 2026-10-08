# Token role map: legacy views (dashboard, auth, 403, /manager/months)

Source: shadcn/ui new-york, `baseColor: neutral` (`components.json`), values in `src/styles/global.css` (`:root` / `.dark`, published via `@theme inline`); the app renders the `.dark` set. No value changes in this change.

## Reused rows

These rows come unchanged from the archived maps:

- `context/archive/2026-09-28-availability-ui-tokens/tokens.md`: page, panel, secondary text, focus, error, success, buttons and inputs.
- `context/archive/2026-09-29-manager-users-ui-tokens/tokens.md`: the "You" pill (self marker), list divider and row feedback.

## New rows for these views

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
