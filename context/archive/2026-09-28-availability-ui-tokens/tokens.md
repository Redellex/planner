# Token role map

Source: shadcn/ui new-york, `baseColor: neutral` (`components.json`), values in `src/styles/global.css` (`:root` / `.dark`, published via `@theme inline`); the app renders the `.dark` set (`<html class="dark">` in `src/layouts/Layout.astro`).

| UI role          | Token / component                                |
| ---------------- | ------------------------------------------------ |
| page             | `bg-background text-foreground`                  |
| panel            | `bg-card text-card-foreground border rounded-xl` |
| secondary text   | `text-muted-foreground`                          |
| selected day     | `bg-primary text-primary-foreground`             |
| has-windows day  | `bg-secondary` + `bg-primary` dot                |
| focus            | `ring-ring/50 ring-[3px]`                        |
| error            | `Alert variant="destructive"`                    |
| success / locked | `Alert` default + icon                           |
| buttons          | `Button` variants                                |
| inputs           | `Input`                                          |
