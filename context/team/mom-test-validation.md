# Mom Test Validation Plan

## Input Idea

From `context/team/opportunity-map.md` (2026-10-28): a **tracker drift check** — a local, read-only script that compares `context/archive/*/change.md`, `context/foundation/roadmap.md`, `context/foundation/tasks-linear.md` and GitHub issues (`gh`) and prints where they disagree after a change is closed. Direction if valuable: a review / CI gate.

## Hypotheses

- **User/role**: the Planner author — a **solo developer** — running the `/10x-*` chain with an agent doing the edits. There is no team to interview; other 10xDevs participants running the same chain are the only outside source.
- **Friction**: closing a change means updating four places; steps get missed, or docs PRs collide on the same tables.
- **Current workaround**: a saved agent feedback note ("`/10x-archive` must also sync roadmap, tasks-linear and the GitHub issue"), the agent doing the sync, separate "docs: mark done" / "chore(archive)" PRs.
- **Risky assumptions**:
  1. Drift happens and costs something — the current main roadmap is consistent.
  2. The cost is _errors_, not _ceremony_; a checker removes none of the ~21 bookkeeping commits or the PR collisions.
  3. Other participants keep the same four sources.
- **Evidence already present** (checked 2026-10-28):
  - ~21 of 213 commits are bookkeeping ("mark S-0X done", "point rows at the archive", "record phase sha").
  - The feedback note records ~10 variants of the close-out flow (S-03…S-09, T-02…T-06, QG-01).
  - Docs PRs collided twice (S-08 had to merge #51 first; T-05's PR needed a master merge after #53 reformatted tasks-linear).
  - Roadmap, tasks-linear and issues agree for S-01…S-09, T-01…T-06, QG-01.
  - Closed issues #16, #19 and #62 have no roadmap or tasks-linear row; `context/changes/deployment` and `context/changes/bootstrap-verification` have no `change.md`. Drift or intentional ad-hoc work — unknown.

## Critique

- **Solution vs problem.** "Drift check" assumes the problem is undetected inconsistency. The history points more toward _ceremony_: four copies of the same status. If so, the better move is fewer copies (generate the tracker table from `gh`, or drop it), which removes accidental complexity instead of guarding it.
- **Existing response may be good enough.** Agent + feedback note kept 16 archives consistent. A checker earns its place only if misses happen without the agent, or as a cheap guard replacing reliance on the note.
- **What kills it.** Nobody can recall a mismatch that confused them or cost a fix after the fact.
- **Strong evidence.** A concrete recent story: someone trusted the roadmap or an issue, it was wrong, and they lost time.

## Solo Evidence (the history is the interview)

As the only user, self-interviews are biased toward the idea. Answer the questions below from artifacts, not memory. Merged PRs (`gh pr list --state merged`, checked 2026-10-28):

| Implementation PR | Close-out PR | Close-out open for |
| ----------------- | ------------ | ------------------ |
| #32 (T-03)        | #33          | ~2.7 days          |
| #35 (S-03)        | #36          | ~19 h              |
| #37 (S-04)        | #38          | minutes            |
| #39 (S-05)        | #40          | ~35 min            |
| #46 (S-06)        | #47          | ~1.3 h             |
| #48 (S-07)        | #49          | minutes            |
| #50 (S-09)        | #51          | ~2.4 h             |
| #52 (S-08)        | #53          | ~4.8 days          |
| #55 (T-05)        | #56          | minutes            |

- About one in three merged PRs is a close-out PR; the agent writes each in minutes.
- The cost shows up when a close-out PR **lingers** (#33, #36, #53): the next change's docs edit collides with it (S-04 rode on #36, S-08 merged #51's branch first, T-05 needed a master merge after #53).
- The drift that exists (#16, #19, #62 without rows; two change folders without `change.md`) has not, as far as the history shows, caused wrong work — confirm this honestly in question 8.
- The S-05 / S-09 / S-08 / T-06 variant (mark done inside the implementation PR) already removes the separate PR for the roadmap part; only the folder move stays after merge.

Run a **diary for the next 2 close-outs**: note the minutes spent, every place updated, whether any mismatch was found, and how.

## Interview Guide

20–25 minutes. Answer it yourself first, in writing, backing every answer with a PR, commit or file from the table above. Optionally ask 2–3 other 10xDevs participants for an outside check on whether the friction is specific to this setup.

1. _(Warm-up)_ Where do you record a change's status today — roadmap, issues, Linear, README, anything else?
2. _(Warm-up)_ How many changes did you close in the last month?
3. _(Recent story)_ Walk me through the last change you finished, from PR merge until you considered it closed. What did you update, in what order?
   - Follow-up: who did each step — you or the agent?
4. _(Recent story)_ When did you last find two of those places disagreeing? How did you notice?
   - Follow-up: what had you already done based on the wrong one?
5. _(Workaround)_ What do you do today so you don't forget a step — checklist, note, prompt, memory?
6. _(Workaround)_ Have you ever skipped updating one place on purpose? Why?
7. _(Cost)_ Roughly how long did the last close-out take, including any extra PR?
8. _(Cost)_ Has a status mismatch ever led to wrong work — starting a blocked slice, reopening done work, a reviewer asking?
9. _(Alternatives)_ Have you tried cutting the number of places or automating one ("Closes #N", a GitHub Project board)? What happened?
10. _(Decision signal)_ Which part of the close-out would you drop first if you could, and what stops you?
11. _(Closing)_ Can I look at your roadmap and closed issues to compare them?

## Survey

1. _(Screener)_ In the last month, did you finish at least one change using a roadmap/tracker plus a code PR? Yes / No → end.
2. Where do you record a change's status? _(multi)_ Roadmap file / GitHub Issues / Linear or Jira / Project board / change folder / Other
3. How many places do you update when a change is done? 1 / 2 / 3 / 4+
4. How long does a close-out take you? <5 min / 5–15 / 15–30 / 30+
5. In the last month, how often did you find two of those places disagreeing? Never / once / 2–3 times / weekly or more
6. Who does most of the close-out? Me by hand / the agent / scripts or CI / mixed
7. _(Open)_ Describe the last time a status mismatch cost you something. What happened?
8. _(Open)_ What do you do today so you don't forget a close-out step?

## Decision Criteria

Solo thresholds come first; the peer thresholds apply only if you also ask other participants.

- **Proceed**: in the history or the next 2 diary close-outs you find at least one mismatch discovered _after the fact_ that cost something concrete (rework, wrong slice started, a reviewer confused) — or, with peers, ≥3 of 5 interviewees (≥40% of survey respondents) report the same in the last month.
- **Narrow scope**: mismatches show up only for ad-hoc work (like #16, #19, #62) — check only "closed issue without a roadmap row" and "change folder without `change.md`".
- **Do not build yet**: people call the ceremony tedious but recall no mismatch that cost them anything — the pain is effort, not drift.
- **Try existing tool/process first** (the most likely solo outcome): the only real cost is lingering close-out PRs colliding — make "mark done inside the implementation PR" (S-05/S-09 variant) the default and archive right after merge; or most people keep only 1–2 places, or "Closes #N" plus the agent's archive step already covers it — cut the duplication (generate the tracker table, or drop `tasks-linear.md`) before writing any checker.
