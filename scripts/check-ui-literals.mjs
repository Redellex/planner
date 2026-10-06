#!/usr/bin/env node
// Fails when a view that is already on the design tokens regains a colour literal: a Tailwind palette class, a
// hex/rgb/hsl/oklch value, bg-cosmic, gradient text or backdrop-blur. Dependency-free, like scripts/smoke.mjs.
//
//   node scripts/check-ui-literals.mjs              -> checks every file in SCOPE
//   node scripts/check-ui-literals.mjs <files...>   -> checks only the given files that fall inside SCOPE
//                                                     (lint-staged passes absolute paths)
//
// SCOPE is the single source of truth for which views are clean; add a view here once it reads only tokens.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Files, or directories (ending in "/") whose .astro/.tsx/.ts files are all checked.
const SCOPE = [
  "src/pages/availability.astro",
  "src/pages/manager/users.astro",
  "src/components/availability/",
  "src/components/manager/",
  "src/pages/dev/availability-states.astro",
  "src/pages/dev/manager-users-states.astro",
  "src/pages/manager/schedule.astro",
  "src/components/schedule/",
  "src/pages/dev/schedule-states.astro",
];

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black";
const COLOUR_LITERAL = new RegExp(
  [
    "#[0-9a-fA-F]{3,8}\\b",
    "rgba?\\(",
    "hsla?\\(",
    "oklch\\(",
    `\\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(${PALETTE})(?:-\\d{2,3})?(?:/\\d{1,3})?\\b`,
    "bg-cosmic",
    "bg-gradient",
    "text-transparent",
    "backdrop-blur",
  ].join("|"),
  "g",
);
const EXTENSIONS = [".astro", ".tsx", ".ts"];

/** Repo-relative path with forward slashes, from a relative, absolute or Windows-style path. */
function toRepoPath(path) {
  const absolute = isAbsolute(path) ? path : resolve(ROOT, path);
  return relative(ROOT, absolute).split("\\").join("/");
}

function inScope(repoPath) {
  return SCOPE.some((entry) => (entry.endsWith("/") ? repoPath.startsWith(entry) : repoPath === entry));
}

function listFiles(repoPath) {
  const absolute = join(ROOT, repoPath);
  if (!statSync(absolute, { throwIfNoEntry: false })) {
    return [];
  }
  if (!statSync(absolute).isDirectory()) {
    return [repoPath];
  }
  return readdirSync(absolute).flatMap((name) => listFiles(`${repoPath.replace(/\/$/, "")}/${name}`));
}

const args = process.argv.slice(2);
const files = (args.length > 0 ? args.map(toRepoPath).filter(inScope) : SCOPE.flatMap(listFiles)).filter((file) =>
  EXTENSIONS.some((extension) => file.endsWith(extension)),
);

let hits = 0;
for (const file of files) {
  const absolute = join(ROOT, file);
  if (!statSync(absolute, { throwIfNoEntry: false })) {
    continue;
  }
  readFileSync(absolute, "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      for (const match of line.matchAll(COLOUR_LITERAL)) {
        hits += 1;
        console.error(`${file}:${index + 1}: ${match[0]}`);
      }
    });
}

if (hits > 0) {
  console.error(
    `\n${hits} colour literal(s) in views that use the design tokens. Use a token class or a src/components/ui/ component (see "### UI" in CLAUDE.md).`,
  );
  process.exit(1);
}
