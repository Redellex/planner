import { readdirSync } from "node:fs";
import path from "node:path";

// Test-only: the walk over src/pages shared by route-inventory.test.ts and navigation.test.ts. It reads the pages from
// disk, so `vitest related` never links a page to those tests; lint-staged runs them for staged pages instead. No app
// code may import this module (it needs node:fs).

const pagesDir = path.resolve(import.meta.dirname, "../pages");
// Every extension Astro routes under src/pages; a file or folder starting with `_` is not a route.
const ROUTE_FILE = /\.(astro|ts|js|mjs|md|mdx|html)$/;

/** Every route file under src/pages, relative, with forward slashes, sorted. */
export const pageFiles: string[] = readdirSync(pagesDir, { recursive: true, encoding: "utf8" })
  .map((file) => file.split(path.sep).join("/"))
  .filter((file) => ROUTE_FILE.test(file) && !file.split("/").some((segment) => segment.startsWith("_")))
  .sort();

/** The pathname Astro serves a route file at (`index` maps to its folder, the root to `/`). */
export function routeOf(file: string): string {
  const route = `/${file.replace(ROUTE_FILE, "")}`.replace(/\/index$/, "");
  return route === "" ? "/" : route;
}
