// Runs hush over a sample made by sample.py and prints how many commits add a narrating comment.
// node study/scan.mjs claude.jsonl base.jsonl
import fs from "node:fs";
import { findNarration } from "../src/detect.mjs";

for (const file of process.argv.slice(2).filter(a => !a.startsWith("--"))) {
  let commits = 0, flagged = 0;
  const kinds = {}, examples = [];
  for (const row of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const commit = JSON.parse(row);
    commits++;
    let hit = false;
    for (const f of commit.files) {
      const lines = [];
      let n = 0;
      for (const l of f.patch.split("\n")) {
        const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
        if (h) { n = +h[1]; continue; }
        if (l.startsWith("+")) lines.push({ n: n++, text: l.slice(1) });
        else if (!l.startsWith("-")) n++;
      }
      for (const r of findNarration(f.f, lines)) {
        if (!hit) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
        hit = true;
        examples.push(`${r.kind}: ${r.comment}`);
      }
    }
    flagged += hit;
  }
  console.log(`${file}: ${flagged} of ${commits} commits (${(100 * flagged / commits).toFixed(1)}%) add a narrating comment`);
  console.log("  first finding per commit, by kind:", kinds);
  if (process.argv.includes("--examples")) examples.forEach(e => console.log("   ", e));
}
