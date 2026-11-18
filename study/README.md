# How often do agents narrate in code comments?

We ran hush's rules over the lines added by 800 public commits on GitHub, taking one commit per repository.

| Sample | Commits | With a narrating comment |
|---|---|---|
| `Co-Authored-By: Claude`, 15–31 Oct 2026 | 200 | 7 (3.5%) |
| `Co-Authored-By: Claude`, 1–16 Nov 2026 | 200 | 8 (4.0%) |
| Commits from March and May 2021, before coding agents | 400 | 0 |

So about **1 Claude commit in 27** adds a comment like these (15 of 400). All of them are from the samples:

```
// Phase 8.4: the single list of the home screen (pure function behind `recentProjects`).
// GMN: the location picker in the CRM lists the connection's locations (Task 7).
// [0, 50] was the old "clear it from above" timing (Task 14 Plan A), reversed in Task 15.
// The old code wrapped a parse failure; CompactObject works on
// It used to fail, land in the failure ring and end the job
```

Each one points at something a later reader does not have: a step in the agent's plan, or code that is gone.

## What we did not find

The complaint in [anthropics/claude-code#65961](https://github.com/anthropics/claude-code/issues/65961) is that Claude writes too many comments. These samples do not back that up. The median share of added lines that are comments was 5.5% for the November Claude commits and 8.5% for the March 2021 commits. Claude writes fewer comments than people did in 2021. The difference is the kind of comment, not the amount.

We also gave Claude Code the same small task 7 times (Opus 5.5, Sonnet 5.5 and Haiku 5.5, working through a plan file). None of the 7 runs added a narrating comment. In our samples it shows up in long, plan-driven sessions, which is where the "Phase 8.4" and "(Task 7)" comments come from.

## Method

- `sample.py` searches GitHub for commits, keeps one per repository, skips forks, and keeps the patches of source files. Vendored, minified and generated files are skipped.
- `scan.mjs` runs `src/detect.mjs` (the same rules the hook uses) over the added lines.
- The 2021 samples are the search terms `fix` (1–20 March 2021) and `update` (1–20 May 2021).

To run it again:

```bash
python3 study/sample.py claude.jsonl '"Co-Authored-By: Claude" committer-date:2026-11-01..2026-11-16' 200
python3 study/sample.py base.jsonl 'fix committer-date:2021-03-01..2021-03-20' 200
node study/scan.mjs claude.jsonl base.jsonl --examples
```

## Limits

- **800 commits is a small sample**, and search results are not a random sample of GitHub.
- **Only commits that keep the `Co-Authored-By` line are counted.** Many people remove it.
- **The rules favour precision.** We read every finding and tightened the rules until we judged the remaining ones correct, with one exception: a comment about a deploy where the old code and the new code run side by side. The rules therefore miss narration phrased in other ways, so the real rate is likely higher.
- **No rate is given for other agents**, because their commits are harder to identify.
