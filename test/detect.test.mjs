import test from "node:test";
import assert from "node:assert/strict";
import { findNarration, judge, commentOf, styleFor, addedFromDiff } from "../src/detect.mjs";

const lines = src => src.split("\n").map((text, i) => ({ n: i + 1, text }));

// Comments of this kind were found in public commits co-authored by Claude in November 2026.
const NARRATING = [
  "Phase 8.1 (findings S2 and S3): a single queue for writing",
  "Where the host publishes each committed claim table (Task 7).",
  "v2.3.8 (Task 6.1) — compact lifecycle status by default.",
  "Forecasts now go through the shared weather feed cache (phase 6a), so the first answer holds",
  "The old code wrapped a parse failure; CompactObject works on",
  "were previously sent with isError=false because we only checked",
  "It used to fail, land in the failure ring and end the job",
  "As requested, retries are capped at three.",
  "Now uses lineTotal instead of looping again",
  "Fixed: bundle items were counted twice",
  "NEW: coupon cap",
  "Task 12 — faded photos of the cities behind the game",
  "[0, 50] was the old timing (Task 14 Plan A), reversed in Task 15.",
  "Removed the bundle loop",
];

// Ordinary comments that share words with the rules and must pass.
const FINE = [
  "Retry once: the API drops the first request after idle.",
  "Strip colour, since the strip no longer sits behind it",
  "Bundle prices are already included in the parent price.",
  "Grows with every change, so a read that started before the change is ignored.",
  "The usual reason to requeue is that one downstream was broken and now is not.",
  "Step 1: where the passwords are now.",
  "The conversation id from the webhook.",
  "Keeper CSV export (chosen by the user's source).",
  "Tokens whose file was imported in this session.",
  "When the user asked to delete their account, pending bets are refunded.",
  "Phase 1: B votes yes and holds its write lock until the decision.",
  "A light green field (wave 3's flat meadow) shades as a hatch.",
  "eslint-disable-next-line no-console",
  "The new value wins when both are set.",
];

test("narrating comments are caught", () => {
  for (const c of NARRATING) assert.ok(judge(c), `missed: ${c}`);
});

test("ordinary comments pass", () => {
  for (const c of FINE) assert.equal(judge(c), null, `false alarm: ${c}`);
});

test("hush-ignore lets a comment through", () => {
  assert.equal(judge("Phase 2 rollout keeps the old flag (hush-ignore)"), null);
});

test("comments are found in each language's syntax, not in strings", () => {
  const js = lines(`const url = "http://example.com/previously"; // as requested by the user
const s = 'a // previously';
/* Task #12: wire it up */
total += x; /* fine */`);
  assert.deepEqual(findNarration("a.ts", js).map(f => f.line), [1, 3]);

  const py = lines(`def f():
    """Previously returned None; now raises."""
    s = "# the user asked"
    return 1  # (step 3) return early`);
  assert.deepEqual(findNarration("a.py", py).map(f => f.line), [2, 4]);

  assert.equal(findNarration("README.md", lines("Previously, the user asked")).length, 0);
  assert.equal(styleFor("x.unknown"), null);
});

test("rules about how a comment starts skip its continuation lines", () => {
  const src = lines(`// The verify phase sweeps the destination, and anything
// removed below is recorded so the job can wait for it.
/*
 * Removed entries stay listed until the sweep ends.
 */`);
  assert.deepEqual(findNarration("a.js", src), []);
  assert.equal(findNarration("a.js", lines("// Removed the bundle loop")).length, 1);
});

test("a narrating comment inside a block comment is caught", () => {
  const src = lines(`/**
 * Loads the board.
 * (phase 8): the mask names what the effect draws round
 */`);
  assert.deepEqual(findNarration("a.js", src).map(f => f.line), [3]);
});

test("added lines and their line numbers are read from a unified diff", () => {
  const diff = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -10,0 +11,2 @@ function f() {
+  // Phase 2.1: cache the result
+  cache.set(k, v);
@@ -40 +42 @@
-  old();
+  next(); // the old code called old() here
diff --git a/gone.js b/gone.js
--- a/gone.js
+++ /dev/null
@@ -1 +0,0 @@
-// Phase 1
`;
  const files = addedFromDiff(diff);
  assert.deepEqual([...files.keys()], ["src/a.js"]);
  assert.deepEqual(findNarration("src/a.js", files.get("src/a.js")).map(f => f.line), [11, 42]);
});

test("commentOf handles escapes inside strings", () => {
  assert.equal(commentOf(`const s = "a \\" // b"; // c here`, styleFor("a.js"), {}), "c here");
});
