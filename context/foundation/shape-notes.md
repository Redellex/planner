---
project: "Close-out command"
context_type: brownfield
created: 2026-10-28
updated: 2026-10-28
checkpoint:
  current_phase: 3
  phases_completed: [1, 2]
  gray_areas_resolved:
    - topic: "change category"
      decision: "new module — a dev-only command next to the app; Planner itself is unchanged"
    - topic: "insight"
      decision: "never thought about it; the close-out grew step by step with the workflow"
    - topic: "primary persona scope"
      decision: "the solo developer and their agent (the agent runs it inside /10x-archive, the developer by hand)"
    - topic: "access model"
      decision: "no change — runs locally as the developer with the existing gh login; dry run needs no write access"
  frs_drafted: 0
  quality_check_status: pending
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
