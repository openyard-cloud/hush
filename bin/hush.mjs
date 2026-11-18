#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findNarration, addedLines, addedFromDiff } from "../src/detect.mjs";
import { report, hookMessage, annotations } from "../src/report.mjs";

const HELP = `hush: catch code comments that narrate the work instead of describing the code.

  // Phase 8.1: single queue for writes        (a step of the agent's plan)
  // The old code wrapped a parse failure       (the code that is gone)
  // As requested, retries are now capped       (the chat)

Usage
  hush check                 comments added since the last commit (staged and unstaged)
  hush check --staged        comments in staged changes only (for a pre-commit hook)
  hush check --base main     comments added on this branch since it left main (for CI)
  hush check --all           every comment in every tracked file
  hush check <files...>      every comment in these files
  hush init [--user]         add the Claude Code hook to .claude/settings.json (or ~/.claude)
  hush hook                  the Claude Code PostToolUse hook itself (reads the payload on stdin)

Options
  --json                     print findings as JSON
  --github                   print findings as GitHub Actions annotations
  -h, --help                 this help

Exit code 1 when anything is found. Add "hush-ignore" to a comment to let it through.
`;

const args = process.argv.slice(2);
const cmd = args[0];
const has = f => args.includes(f);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

try {
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") process.stdout.write(HELP);
  else if (cmd === "hook") await hook();
  else if (cmd === "check") check();
  else if (cmd === "init") init();
  else { process.stderr.write(`hush: unknown command "${cmd}"\n\n${HELP}`); process.exit(2); }
} catch (e) {
  process.stderr.write(`hush: ${e.message}\n`);
  process.exit(cmd === "hook" ? 0 : 2); // a broken hook must never block the agent
}

async function hook() {
  if (process.env.HUSH_OFF === "1") return;
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const payload = JSON.parse(raw);
  const file = payload.tool_input?.file_path || payload.tool_response?.filePath;
  if (!file) return;
  const shown = path.relative(payload.cwd || process.cwd(), file) || file;
  const found = findNarration(file, addedLines(payload)).map(f => ({ ...f, file: shown }));
  if (!found.length) return;
  process.stderr.write(hookMessage(found));
  process.exit(2);
}

function git(argv) {
  return execFileSync("git", argv, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function check() {
  const rest = args.slice(1).filter((a, i, all) => !a.startsWith("-") && all[i - 1] !== "--base");
  let found = [];
  if (has("--all") || rest.length) {
    const files = rest.length ? rest : git(["ls-files", "-z"]).split("\0").filter(Boolean);
    for (const f of files) {
      let text;
      try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
      if (text.includes("\0")) continue;
      found.push(...findNarration(f, text.split("\n").map((t, i) => ({ n: i + 1, text: t }))));
    }
  } else {
    const base = val("--base");
    const range = base ? [`${git(["merge-base", base, "HEAD"]).trim()}`, "HEAD"] : has("--staged") ? ["--cached"] : ["HEAD"];
    const diff = git(["diff", "--no-color", "--no-ext-diff", "-U0", ...range]);
    for (const [f, lines] of addedFromDiff(diff)) found.push(...findNarration(f, lines));
    if (!base && !has("--staged")) {
      for (const f of git(["ls-files", "-z", "--others", "--exclude-standard"]).split("\0").filter(Boolean)) {
        let text;
        try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
        if (!text.includes("\0")) found.push(...findNarration(f, text.split("\n").map((t, i) => ({ n: i + 1, text: t }))));
      }
    }
  }
  if (has("--json")) process.stdout.write(JSON.stringify(found, null, 2) + "\n");
  else if (has("--github")) process.stdout.write(annotations(found));
  else process.stdout.write(report(found));
  process.exit(found.length ? 1 : 0);
}

function init() {
  const home = has("--user") ? path.join(os.homedir(), ".claude") : path.join(process.cwd(), ".claude");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  // npx deletes its copy, so keep one next to the settings it is wired into.
  const dest = path.join(os.homedir(), ".claude", "hush", version);
  for (const d of ["bin", "src"]) fs.cpSync(path.join(root, d), path.join(dest, d), { recursive: true });
  fs.copyFileSync(path.join(root, "package.json"), path.join(dest, "package.json"));
  const command = `node "${path.join(dest, "bin", "hush.mjs")}" hook`;

  const file = path.join(home, "settings.json");
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  settings.hooks ??= {};
  const post = (settings.hooks.PostToolUse ??= []);
  for (const entry of post) entry.hooks = (entry.hooks || []).filter(h => !/hush(\.mjs)?"? hook$/.test(h.command || ""));
  settings.hooks.PostToolUse = post.filter(e => e.hooks.length);
  settings.hooks.PostToolUse.push({ matcher: "Edit|MultiEdit|Write", hooks: [{ type: "command", command }] });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  process.stdout.write(`hush ${version}: hook added to ${file}\nClaude Code now checks the comments in every edit. Start a new session to load it.\n`);
}
