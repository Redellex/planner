---
project: "Close-out command"
context_type: brownfield
created: 2026-10-28
updated: 2026-10-28
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7, 8]
  gray_areas_resolved:
    - topic: "change category"
      decision: "new module — a dev-only command next to the app; Planner itself is unchanged"
    - topic: "insight"
      decision: "never thought about it; the close-out grew step by step with the workflow"
    - topic: "primary persona scope"
      decision: "the solo developer and their agent (the agent runs it inside /10x-archive, the developer by hand)"
    - topic: "access model"
      decision: "no change — runs locally as the developer with the existing gh login; dry run needs no write access"
    - topic: "when it runs"
      decision: "before merge, inside the implementation PR — one extra commit there, no separate close-out PR"
    - topic: "who closes the issue"
      decision: 'GitHub, through "Closes #N" in the PR description; the command only warns when it is missing'
    - topic: "success window"
      decision: "the next 3 changes"
  frs_drafted: 9
  quality_check_status: accepted
product_type: cli # new surface next to the existing web-app, which is unchanged
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  delivery_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

# Shape Notes

Seed idea:

> Close-out command: `npm run closeout -- <change-id>` that archives the change folder, sets the roadmap row to done, updates tasks-linear.md and closes the GitHub issue in one commit. Dry run first.

Background evidence: `context/team/opportunity-map.md`, `context/team/mom-test-validation.md`, `context/team/mom-test-answers.md`.

Previous session (Planner product shaping) archived to `context/foundation/archive/shape-notes-2026-10-28-2207.md`.

## Current System

Closing a change is a step of the `/10x` skill workflow. After an implementation PR merges, the developer tells the agent to do every close-out step: archive the change folder, update `context/foundation/roadmap.md` and `context/foundation/tasks-linear.md`, and close the GitHub issue — usually in a separate PR.

- **Tech stack involved**: markdown files under `context/`, GitHub Issues via the `gh` CLI, git and pull requests, Node scripts, Prettier (via lint-staged).
- **Users**: one solo developer, working through an agent.

## Vision & Problem Statement

After every task the developer repeats the same close-out — closing the task, updating issues and `.md` files — and ends up reopening PRs to fix them. It has never been automated because it grew step by step with the workflow.

This change adds a new, dev-only command that does the close-out. The Planner app itself does not change.

## User & Persona

- **Primary**: the solo developer of this repo, together with their agent. The agent runs the command as a step of `/10x-archive`; the developer can run it by hand.

## Access Control

No changes planned — current model preserved. The command runs locally as the developer, with their existing git setup and GitHub CLI login (`Redellex`); it has exactly the permissions the developer already has. No new tokens, accounts or roles. The dry run only reads.

## Smallest Change (delta sequence)

1. The code is done, the implementation PR is open and its description has "Closes #N".
2. The agent runs `npm run closeout -- <change-id>` (dry run, the default).
3. The developer reads the planned edits: the change folder moved to the archive, the rows in `roadmap.md` and `tasks-linear.md`, and a warning if the PR has no "Closes #N".
4. If the list is right, `--write` adds one commit to the same PR.
5. Merge. GitHub closes the issue.

- **Blast radius**: if the command fails, the developer is back to today's manual close-out — no PR, merge conflicts, issues left open. Nothing in the Planner app is touched.
- **Timeline**: shippable in 3 weeks of after-hours work (developer's estimate).

## Success Criteria

### Primary

- No separate close-out PR for the next 3 changes.
- No merge conflict in the `roadmap.md` or `tasks-linear.md` tables for the next 3 changes.

### Secondary

- None stated.

### Guardrails

- The archive folder layout stays as it is.
- The `roadmap.md` and `tasks-linear.md` tables keep their format.
- Only the right GitHub issue is closed; its labels, DoD and links stay intact.

## User Stories

### US-01: Close a change inside its implementation PR

- **Given** an open implementation PR with "Closes #N" and the change folder in `context/changes/`
- **When** the agent runs the dry run, the developer checks the list, and the agent runs `--write`
- **Then** one commit on that PR archives the folder and marks the rows, and merging the PR closes the issue
- _Before:_ a separate close-out PR after the merge, often reopened or in conflict.

## Functional Requirements

### Dry run

- FR-001: Developer can run `npm run closeout -- <change-id>` and see the planned edits without any file changing. Change: new. Priority: must-have

  > Socratic: after a few good runs the dry run looks like a wasted step. Resolution: it stays the default; writing always needs an explicit `--write`, and the agent runs both steps anyway.

- FR-002: Developer is warned when the open PR's description has no "Closes #N" for the change's issue. Change: new. Priority: must-have

  > Socratic: with no pushed PR `gh` finds nothing, and GitHub already shows linked issues on the PR. Resolution: it stays; with no PR found the command says it could not check "Closes #N" and carries on.

### Write

- FR-003: With `--write`, the command moves `context/changes/<change-id>` to `context/archive/<date>-<change-id>` and marks its `change.md` as archived. Change: new. Priority: must-have

  > Socratic: `/10x-archive` already moves the folder and stamps `change.md`; two implementations would drift. Resolution: the command does both, and `/10x-archive` calls the command instead of doing it itself — one implementation.

- FR-004: With `--write`, the command marks the change done in `roadmap.md` (At a glance, Backlog Handoff, Done) and points it at the archive folder. Change: new. Priority: must-have

  > Socratic: the rows come in several variants and parsing markdown tables is fragile; a bad match could break a table. Resolution: it changes only rows it recognises; anything else is refused with nothing written, and the developer edits by hand.

- FR-005: With `--write`, the command updates the change's row in `tasks-linear.md`. Change: new. Priority: must-have

  > Socratic: `tasks-linear.md` copies state GitHub already holds; automating it keeps the duplicate alive. Resolution: it stays in v1; whether to drop the file is an open question.

- FR-006: With `--write`, all edits land in one commit, formatted with Prettier. Change: new. Priority: must-have

  > Socratic: committing before merge marks the change done before the PR is actually merged. Resolution: the commit stays, and the close-out is the last commit of the PR; if anything lands after it, the developer runs it again or reverts it.

### Refusals

- FR-007: The command refuses an unknown `<change-id>` and changes nothing; for an already archived change it reports "already closed" and exits successfully. Change: new. Priority: must-have

  > Socratic: an agent retrying the command should not get an error for a change that is already closed. Resolution: archived → "already closed", success; unknown → error.

- FR-008: The command refuses `--write` when any file it would change has uncommitted changes, and commits only its own files. Change: new. Priority: must-have

  > Socratic: the repo almost always has unrelated uncommitted changes, so refusing on any of them would block the command constantly. Resolution: only its own files count.

### Preserved

- FR-009: GitHub closes the change's issue on merge through "Closes #N"; the command never closes, relabels or edits issues. Change: preserved. Priority: must-have

  > Socratic: today's close-out also ticks the issue's DoD and sets labels, so that part stays manual. Resolution: issues stay manual in v1; ticking the DoD goes to Non-Goals as a v2 candidate.

## Business Logic

No domain logic change. This is an infrastructure/technical change. The command's own rules are FR-001…FR-009.

## Constraints & Preserved Behavior

- The archive folder layout stays as it is: `context/archive/<YYYY-MM-DD>-<change-id>`, so existing archives and links keep matching.
- The `roadmap.md` and `tasks-linear.md` tables keep their format.
- Only the right GitHub issue is closed (by GitHub, through "Closes #N"); its labels, DoD and links stay intact.
- `/10x-archive` keeps working and stays the entry point; it calls the command instead of moving the folder itself.
- The command changes only files under `context/`; application code and configuration are never touched.
- The close-out commit goes through the normal CI on the PR like any other commit; nothing bypasses it.

## Non-Functional Requirements

- Readable output: one line per planned edit, readable by the developer and the agent; a non-zero exit code when the command refuses.

## Product Framing

- **Product type**: a new developer-only command-line tool next to the existing Planner web app, which does not change.
- **Users**: no change — one solo developer and their agent; Planner's users never see it.
- **Timing**: no hard deadline; after-hours work, 3 weeks.

## Non-Goals

- Ticking the DoD or changing labels on GitHub issues — they stay manual in v1 (FR-009); a v2 candidate.
- Running automatically on PR merge (GitHub Action) — in v1 the agent or the developer runs it; that is the direction once it proves itself.
- Any change to the Planner app — code, database or UI.

## Open Questions

- Drop `tasks-linear.md` once the command works, since it copies state GitHub already holds (FR-005)?

## Forward: technical-roadmap

- `/10x-archive` calls the command instead of moving the folder itself (FR-003).
- Direction if it proves valuable: a GitHub Action that runs the close-out when the implementation PR merges.
