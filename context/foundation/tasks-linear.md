---
project: Planner
source: context/foundation/roadmap.md (v1)
tracker: GitHub Issues
repo: Redellex/planner
migrated: 2026-09-25
updated: 2026-10-06
milestone: M-1 (GitHub milestone #1)
---

# Task Tracker: Roadmap → GitHub Issues

> A record of how `roadmap.md` became GitHub issues, and the rules for keeping the two in sync.
> The tracker is **GitHub Issues**. The `-linear` in the filename does not mean the Linear app.

## Summary

| Item                | Value                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| Tracker             | GitHub Issues — `https://github.com/Redellex/planner/issues`                |
| Authenticated as    | `Redellex` (`gh` CLI, keyring token, HTTPS)                                 |
| State before import | 0 issues, 0 milestones, only GitHub's default labels, no issue templates    |
| Milestone created   | `M-1: First valid monthly schedule` (#1)                                    |
| Issues created      | 9 (1 foundation, 5 slices, 1 open question, 2 parked)                       |
| Labels created      | 8 (`roadmap`, `foundation`, `slice`, `north-star`, 3× `status:*`, `parked`) |
| Native dependencies | 6 "blocked by" links                                                        |
| Repo file changed   | `context/foundation/roadmap.md` (added issue numbers, not committed)        |

## How the tracker was chosen

1. `git remote -v` → `origin https://github.com/Redellex/planner.git`, so the project is hosted on GitHub.
2. `gh auth status` → logged in as `Redellex`.
3. `gh repo view --json hasIssuesEnabled,hasProjectsEnabled` → both `true`.
4. `gh label list`, `gh api .../milestones`, `gh issue list` → nothing existed yet, so there was nothing to merge.

The roadmap's Backlog Handoff table already asks for "stable human-readable identifiers in backlog tools". GitHub Issues was already set up and needed nothing extra, so it was used.

## Issue map

| Roadmap ID | Issue | Title                                                                        | Labels                                   | Milestone | Blocked by |
| ---------- | ----- | ---------------------------------------------------------------------------- | ---------------------------------------- | --------- | ---------- |
| F-01       | #1    | [F-01] Add manager/employee roles to auth                                    | roadmap, foundation — **closed** (done)  | M-1       | —          |
| S-01       | #2    | [S-01] Employee availability CRUD with monthly lock                          | roadmap, slice — **closed** (done)       | M-1       | #1         |
| S-02       | #3    | [S-02] Manager view of all employee availability                             | roadmap, slice — **closed** (done)       | M-1       | #1, #2     |
| S-03       | #4    | [S-03] Auto-generate conflict-free, fairly-rotated monthly schedule          | roadmap, slice, north-star, status:ready | M-1       | #2         |
| S-04       | #5    | [S-04] Manager review/override/publish workflow for generated schedule       | roadmap, slice, status:proposed          | M-1       | #4         |
| S-05       | #6    | [S-05] Published schedule grid view for employees and managers               | roadmap, slice, status:proposed          | M-1       | #5         |
| T-01       | #24   | [T-01] Test runner and station-time logic (unit tests on UTC)                | roadmap, testing — **closed** (done)     | —         | —          |
| T-02       | #27   | [T-02] Database rules: ownership, month lock and roles (pgTAP)               | roadmap, testing — **closed** (done)     | —         | —          |
| QG-01      | #29   | [QG-01] Quality-gate hooks: agent hooks and pre-commit tests on staged files | roadmap, testing — **closed** (done)     | —         | —          |
| T-03       | #31   | [T-03] Route gating and honest availability reads                            | roadmap, testing — **closed** (done)     | —         | —          |
| Q-01       | #7    | [Q-01] Expected request and data volume (qps)?                               | roadmap, question                        | M-1       | —          |
| P-01       | #8    | [P-01] Export/print schedule (FR-008)                                        | roadmap, parked                          | —         | —          |
| P-02       | #9    | [P-02] Notify employees when schedule is published (FR-009)                  | roadmap, parked                          | —         | —          |

The issues were created in the order the roadmap lists them, so the numbers match that order. S-02 and S-03 can run in parallel; each issue mentions the other.

### Dependency graph

```
#1 F-01 ──► #2 S-01 ──┬──► #3 S-02          (parallel with S-03)
   └──────────────────┘
             #2 S-01 ──► #4 S-03 ★ ──► #5 S-04 ──► #6 S-05
```

## Format conventions

### Titles

`[<Roadmap ID>] <Suggested issue title from the Backlog Handoff table>`

The ID prefix makes it possible to find an issue by its roadmap ID (for example `gh issue list --search "[S-03] in:title"`). It also let the import script skip issues that already existed, so it could be re-run safely.

### Roadmap IDs

| Prefix  | Meaning                                                              | Milestone |
| ------- | -------------------------------------------------------------------- | --------- |
| `F-NN`  | Foundation: a bounded enabler that unlocks named slices              | yes       |
| `S-NN`  | Vertical slice: an outcome the user can see                          | yes       |
| `Q-NN`  | Open roadmap question (from `## Open Roadmap Questions`)             | yes       |
| `P-NN`  | Parked nice-to-have (from `## Parked`)                               | no        |
| `T-NN`  | Test-plan rollout phase (`test-plan.md` §3, Phase NN)                | no        |
| `QG-NN` | Quality-gate wiring (`test-plan.md` §5): hooks, pre-commit, CI steps | no        |

`Q-` and `P-` IDs were added during this import because the roadmap didn't number those items. `T-` IDs were added on 2026-10-01 for test-plan rollout phases; the number matches the phase in `test-plan.md` §3. They are cross-cutting quality work, not milestone scope, so they get no milestone. `QG-` IDs were added on 2026-10-03 for wiring the §5 Quality Gates into hooks (agent, git); they share the `roadmap, testing` labels and get no milestone either.

### Labels

| Label             | Color     | Meaning                                        |
| ----------------- | --------- | ---------------------------------------------- |
| `roadmap`         | `#5319e7` | Any item that came from `roadmap.md`           |
| `foundation`      | `#bfd4f2` | F-NN items                                     |
| `slice`           | `#0e8a16` | S-NN items                                     |
| `north-star`      | `#fbca04` | S-03, the smallest flow that proves core value |
| `status:ready`    | `#2da44e` | Ready for `/10x-plan`                          |
| `status:proposed` | `#d0d7de` | Waiting on prerequisites                       |
| `status:blocked`  | `#d73a4a` | Blocked by unanswered unknowns                 |
| `parked`          | `#cfd3d7` | Put off until after the current milestone      |
| `testing`         | `#1d76db` | T-NN test-plan rollout phases                  |
| `question`        | (default) | Open questions (existing GitHub label, reused) |

The `status:*` labels match the **Status** field in `roadmap.md`. Closing an issue counts as `done`.

### Issue body template

```markdown
**Roadmap ID:** S-03 · **Change ID:** `generate-monthly-schedule` · **Milestone:** M-1

## Outcome

## PRD refs

## Dependencies

- Blocked by: #n (ID)
- Parallel with: #n (ID)
- Unlocks: #n (ID)

## Unknowns

- [ ] <question> — Owner: user · **Blocking: yes/no**

## Risk

## Definition of done

- [ ] Outcome demonstrable end-to-end
- [ ] Ready for `/10x-plan` → `context/changes/<change-id>/` created via `/10x-new`

---

_Source: `context/foundation/roadmap.md` (v1)_
```

The Outcome, PRD refs, Unknowns and Risk sections are copied word for word from the roadmap. Unknowns are checkboxes, so GitHub shows how many are answered. Q-01 and P-NN issues use a shorter body: Question/Outcome and "Why parked".

### Milestone

- **Title:** `M-1: First valid monthly schedule`
- **Description:** the roadmap Intent + "Done when: every F-NN and S-NN issue is closed" + scope anchors (FR-001–FR-007, US-01, PRD Access Control).
- It holds 7 issues (F-01, S-01..S-05, Q-01). Parked issues are left out on purpose so they don't count toward M-1 progress.

## Decisions made during import

| Decision                                                                                          | Why                                                                                  |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Created issues for FR-008 and FR-009 as `parked`, with no milestone                               | They're real work to do later. Leaving them out of M-1 keeps its progress accurate.  |
| Didn't create issues for the PRD Non-Goals (labor law, sick leave, multi-employee shifts, mobile) | They exclude scope; they aren't work to do. They stay documented in `roadmap.md`.    |
| Put Q-01 in M-1                                                                                   | It's an open question for this roadmap. It doesn't block anything.                   |
| Kept `Blocked by #n` text in bodies **and** used GitHub's "blocked by" links                      | The text is readable anywhere. The links show up in GitHub's UI and API.             |
| Didn't use a GitHub Projects board                                                                | A milestone plus labels is enough for 9 items. A board can be added later.           |
| No issue templates were added to `.github/`                                                       | It was a one-time import. Templates can come from the body template above if needed. |

## Commands used (reproducible)

```bash
# labels (idempotent with --force)
gh label create roadmap --color 5319e7 --description "Item migrated from context/foundation/roadmap.md" --force
# ...same for foundation, slice, north-star, status:ready|proposed|blocked, parked

# milestone
gh api repos/Redellex/planner/milestones \
  -f title="M-1: First valid monthly schedule" -f description="..."

# issues (skipped when an issue titled "[ID] ..." already exists)
gh issue create -R Redellex/planner --title "[S-03] ..." --body-file S-03.md \
  --label "roadmap,slice,north-star,status:blocked" \
  --milestone "M-1: First valid monthly schedule"

# fill {{ID}} placeholders with real #numbers, then:
gh issue edit -R Redellex/planner 4 --body-file S-03.final.md

# native dependency: issue 4 is blocked by issue 2
BID=$(gh api repos/Redellex/planner/issues/2 --jq .id)
gh api -X POST repos/Redellex/planner/issues/4/dependencies/blocked_by -F issue_id=$BID
```

Issue bodies were written in two passes. First they were created with `{{F-01}}`-style placeholders. After creation, the placeholders were replaced with the real issue numbers and the bodies re-uploaded. This works even if issue numbers don't start at #1, for example when PRs have already used some numbers.

## Verification (done 2026-09-25)

- `gh issue list --milestone "M-1: First valid monthly schedule"` → 7 issues (#1–#7) with the expected labels.
- `gh issue list --label parked` → 2 issues (#8, #9).
- A search for leftover `{{` placeholders in the final bodies found none.
- All 6 `dependencies/blocked_by` POSTs succeeded.

## Changes in the repo

`context/foundation/roadmap.md`:

- The Backlog Handoff table now has an **Issue** column (`#1`–`#6`).
- The Open Roadmap Question is tagged `[#7]`, and the parked FR-008/FR-009 entries are tagged `(#8)` and `(#9)`.
- The file was formatted with Prettier and is **not committed yet**.

The temporary body files were kept in the session scratchpad and are not in the repo.

## Keeping roadmap and tracker in sync

| Event                                  | Update in GitHub                                                       | Update in `roadmap.md`                 |
| -------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------- |
| Unknown answered                       | Tick its checkbox; add the answer as a comment                         | Update the item's Unknowns             |
| All blocking unknowns of S-03 answered | `status:blocked` → `status:ready`                                      | Status → `ready`                       |
| Prerequisite closed                    | Change the next item from `status:proposed` to `status:ready`          | Status → `ready`                       |
| Work starts (`/10x-new <change-id>`)   | Link the `context/changes/<change-id>/` folder in a comment            | Status → `in-progress`                 |
| Change archived (`/10x-archive`)       | Close the issue (milestone progress updates)                           | Move the item to `## Done`             |
| All F/S issues closed                  | Close milestone M-1; open M-2                                          | Close the milestone via `/10x-roadmap` |
| Parked item promoted                   | Remove `parked`, add `slice` and the new milestone, give it an S-NN ID | Move it from Parked to Slices          |

`roadmap.md` stays the source of truth for scope and order. GitHub is the source of truth for status and who is working on what.

## What to do next

Status as of 2026-09-29: M-1 is 3/6 done.

- #1 (F-01) was delivered in PR #10 and archived to `context/archive/2026-09-25-role-aware-access-control/`.
- #2 (S-01) was delivered in PR #12 (review reports in PR #13) and archived to `context/archive/2026-09-26-employee-availability-management/`.
- #3 (S-02) was delivered in PR #21 and archived to `context/archive/2026-09-29-manager-availability-visibility/`.

1. **#4 (S-03, north star)** is the only open slice that can start. Its two blocking unknowns were answered on 2026-10-06, so it moves to `status:ready`. Fairness is per month: even total hours, and 12h-shift counts that differ by at most 1. An uncovered shift is left unassigned and flagged, and a schedule with a day that has no one assigned cannot be accepted or published (S-04). #5 (S-04) and #6 (S-05) wait on it.
