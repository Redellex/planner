# Opportunity Map

## Context

- **Project / context**: Planner (station shift scheduler) — friction in the solo developer workflow driven by the 10xDevs `/10x-*` skill chain, plus one product-side signal
- **Data constraint**: mock / local / read-only / non-sensitive
- **Date**: 2026-10-28

Signals were drawn from past behavior in the repo, not from opinions: 213 commits on `master`'s history, `context/archive/` (16 archived changes), `context/foundation/{roadmap,tasks-linear}.md`, `CLAUDE.md` recovery notes and the agent's saved feedback notes.

## Map

| Signal                                                             | Existing / default response                                 | Thin complement                                        | First useful version             | Data risk                           | Direction if valuable             |
| ------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------ | -------------------------------- | ----------------------------------- | --------------------------------- |
| Closing a change = manual sync of archive, roadmap, tracker, issue | `/10x-archive`, GitHub "Closes #N"                          | Drift check across the 4 sources                       | Local script printing mismatches | Local files + own issues, read-only | Review / CI gate                  |
| A dead smoke run leaves a locked month / draft behind              | Recovery SQL in `CLAUDE.md`, smoke SKIP                     | Preflight "doctor" (locks, drafts, `.dev.vars` target) | `smoke --doctor` flag            | Local DB                            | Small internal tool               |
| Demo month goes stale at each month boundary                       | `seed:demo` + manual "Demo data" workflow                   | `schedule:` cron on the existing workflow              | One YAML line                    | Hosted demo accounts only           | Wait / no build (Actions does it) |
| "Keep in step" rules duplicated across SQL / TS / scripts          | `station-time-zone.test.ts`, `CLAUDE.md` notes              | More parity tests in the same style                    | One extra test                   | None                                | Feature of the test suite         |
| Manager chases who has not submitted availability                  | "No availability submitted" flag on `/manager/availability` | Copyable list of those people                          | Mock list                        | Real employee emails once hosted    | Wait (no past behavior yet)       |

Notes per signal:

- **Close-out sync** — ~21 of 213 commits are bookkeeping ("mark S-0X done", "point rows at the archive", "record phase sha"); the archive feedback note lists ~10 flow variants (S-05, S-08, S-09, T-05, T-06…); twice a docs PR had to merge another docs PR first because both reformatted the same tables.
- **Smoke leftovers** — partly essential complexity: smoke deliberately refuses to discard a draft or unlock a month it did not create. The accidental part is finding out which state is stale and where the env points.
- **Stale demo month** — just fixed in PR #65; the keep-alive workflow already shows the cron pattern. Nothing to build.
- **Duplicated rules** — duplication is intentional (database enforces, app validates); the guard belongs in the existing Vitest suite.
- **Missing availability** — no real manager has used the hosted app yet, so there is no past behavior to cite. Revisit after real use.

## Recommended First Candidate

```text
Candidate:
Tracker drift check

Reads:
context/archive/*/change.md, context/foundation/roadmap.md (status + Backlog
Handoff rows), context/foundation/tasks-linear.md (issue map),
`gh issue list --json number,state,labels`

Returns:
One line per change where the sources disagree, e.g.
"S-08 archived, but #43 still open" or
"roadmap says done, tasks-linear says in review". Exit 0 when all agree.

Does not do:
Fix or edit anything, close issues, open PRs, or touch change folders.

Data risk:
Local, read-only, non-sensitive (own repo files and own public issues via gh).

Direction if it proves valuable:
Review / CI gate — a step on docs PRs, or a final check inside /10x-archive.
```

## Why This Candidate

- **Repeats** with every change (16 archived so far, plus test-plan phases and quality-gate items).
- **Joins four sources** (archive folders, roadmap, tracker file, GitHub issues) — the cross-system case where a thin helper earns its keep.
- **Clear manual pain today**: a saved feedback note exists only because steps got missed, and docs PRs collided on the same tables.
- **Testable read-only** on the current repo state.
- **Replaces nothing**: GitHub stays the tracker, `/10x-archive` stays the workflow; the check only reports.

The others either already have a tool doing the job (stale demo month, duplicated rules), are a single-source preflight only one person runs (smoke leftovers), or lack evidence (missing availability).

## Validation Outcome (2026-10-28)

`/10x-mom-test` (`mom-test-validation.md`, `mom-test-answers.md`) did not confirm drift that costs anything: no mismatch led to wrong work. It confirmed the ceremony instead — ~20 extra minutes per close-out, merge conflicts between lingering docs PRs, and the agent forgetting the archive step. Decision:

- **Drift check: not built.**
- **Process first:** mark done inside the implementation PR, archive right after merge.
- **Candidate taken forward (learning build):** a **close-out command**, below. It targets the confirmed pain (the ceremony), not the unconfirmed one (drift).

```text
Candidate:
Close-out command (`npm run closeout -- <change-id>`)

Reads:
context/changes/<change-id>/change.md, context/foundation/roadmap.md
(At a glance, Backlog Handoff and Done rows), context/foundation/tasks-linear.md
(issue map), the change's GitHub issue via `gh issue view`

Returns:
Dry run (default): the list of planned edits — folder move to
context/archive/<date>-<change-id>, the roadmap and tracker rows it would flip,
the issue it would close. With --write: those edits in one commit, plus the
issue closed.

Does not do:
Open or merge PRs, edit any other issue, touch change folders other than the
named one, run on its own (no CI trigger yet), replace /10x-archive.

Data risk:
Own repo files and own public issues, nothing sensitive. Unlike the drift check
it writes, so: dry run first, --write only after two correct dry runs, it runs
with the developer's existing gh login (no new tokens), and git can undo every
file edit.

Direction if it proves valuable:
Async / CI — a GitHub Action that runs it when the implementation PR merges.
```

Why this one: it repeats with every change (~17 closed last month), joins four sources (change folder, roadmap, tracker file, GitHub issue), and removes the ~20 extra minutes and the separate close-out PR rather than only reporting on them.

## Next Direction If Valuable

Validation is done (see above). Process change first: mark done inside the implementation PR and archive right after merge. In parallel, shape the close-out command: `/10x-shape` → `/10x-prd` → `/10x-roadmap`, aiming at an async / CI step on PR merge rather than a standalone tool.
