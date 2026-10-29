# Mom Test Answers — Tracker Drift Check

Plan and decision criteria: [`mom-test-validation.md`](mom-test-validation.md).

Rule: every answer cites evidence (a PR, commit, issue or file). "I think" or "probably" doesn't count; if you can't remember a concrete case, write "no case found".

## Self-interview

Date:

1. Where do you record a change's status today?
   - Answer: Issues and archived repo files
   - Evidence: Issues and archive repo files
2. How many changes did you close in the last month?
   - Answer: About 17?
   - Evidence: On github issue tracker
3. The last change you finished — what did you update after the PR merged, in what order, and who did each step (you or the agent)?
   - Answer: It did Agent - I had to ask him again about archiving task and later reopen PR to update .md files and close PR
   - Evidence: On github
4. When did you last find two places disagreeing? How did you notice? What had you already done based on the wrong one?
   - Answer:
   - Evidence:
5. What do you do today so you don't forget a step?
   - Answer: I just check issue tracker
   - Evidence:
6. Have you ever skipped updating one place on purpose? Why? (e.g. #16, #19, #62 have no roadmap row)
   - Answer: No it should be always updated after the task
   - Evidence: Github
7. How long did the last close-out take, including the extra PR?
   - Answer: I don't know but it takes extra 20 minutes per task - even smallest
   - Evidence: Github
8. Has a status mismatch ever led to wrong work (blocked slice started, done work reopened, a reviewer asking)?
   - Answer: No, but conflict on merging PR. It was flustrating
   - Evidence: Github.
9. Have you tried cutting the number of places or automating one? What happened?
   - Answer: I did not
   - Evidence:
10. Which part of the close-out would you drop first, and what stops you?
    - Answer:
    - Evidence:

## Close-out diary

One row per change closed from now on (aim for 2).

| Date | Change | Minutes spent | Places updated | Separate close-out PR? | Mismatch found? How? | Cost of the mismatch |
| ---- | ------ | ------------- | -------------- | ---------------------- | -------------------- | -------------------- |
|      |        |               |                |                        |                      |                      |
|      |        |               |                |                        |                      |                      |

## Peer answers (optional)

| Participant (role, no name) | Places they keep | Last mismatch, found when | Cost | Workaround |
| --------------------------- | ---------------- | ------------------------- | ---- | ---------- |
|                             |                  |                           |      |            |

## Verdict

Pick one, per the criteria in `mom-test-validation.md`, and say which evidence decided it:

- [ ] Proceed → `/10x-shape`
- [ ] Narrow scope (ad-hoc work only) → `/10x-shape`
- [ ] Do not build yet
- [x] Try existing process first (mark done inside the implementation PR, archive right after merge)

Reason: no mismatch ever led to wrong work (Q4 empty, Q8 "No"), so the drift check is not built. The real, repeated pain is the close-out ceremony: ~20 extra minutes per task (Q7, estimate), merge conflicts between docs PRs (Q8; S-08 had to merge #51 first, T-05's PR #55 needed a master merge after #53), and the agent forgetting the archive step (Q3). Provisional until the diary has 2 rows.

Follow-up (2026-10-28): adopt the process change, and — as a learning build that targets the confirmed pain — shape a **close-out command** (`npm run closeout -- <change-id>`, dry run first) via `/10x-shape`.
