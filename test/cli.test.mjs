import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/hush.mjs", import.meta.url));
const run = (args, { input, cwd, env } = {}) =>
  spawnSync(process.execPath, [BIN, ...args], { input, cwd, env: { ...process.env, ...env }, encoding: "utf8" });

// Payloads in the shape Claude Code 2.1 sends to PostToolUse hooks.
const editPayload = (cwd, file, plus) => JSON.stringify({
  hook_event_name: "PostToolUse", cwd, tool_name: "Edit",
  tool_input: { file_path: path.join(cwd, file), old_string: "x", new_string: "y" },
  tool_response: { filePath: path.join(cwd, file), structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3 + plus.length, lines: [" export function add(a, b) {", "   return a + b;", " }", ...plus.map(l => "+" + l)] }] },
});

test("hook: a narrating comment in an edit is sent back to Claude with exit code 2", () => {
  const r = run(["hook"], { input: editPayload("/repo", "src/math.js", ["", "// Phase 2: subtract (Task 4)", "export const sub = (a, b) => a - b;"]) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /src\/math\.js:5 \(refers to a plan step\): Phase 2: subtract \(Task 4\)/);
  assert.match(r.stderr, /Rewrite each one/);
});

test("hook: clean edits, unchanged context lines and broken payloads never block", () => {
  assert.equal(run(["hook"], { input: editPayload("/repo", "src/math.js", ["// Subtraction, for symmetry with add.", "export const sub = (a, b) => a - b;"]) }).status, 0);
  const ctx = JSON.parse(editPayload("/repo", "a.js", []));
  ctx.tool_response.structuredPatch[0].lines.unshift(" // Phase 1: already in the file");
  assert.equal(run(["hook"], { input: JSON.stringify(ctx) }).status, 0);
  assert.equal(run(["hook"], { input: "not json" }).status, 0);
  assert.equal(run(["hook"], { input: editPayload("/repo", "a.js", ["// (task 3)"]), env: { HUSH_OFF: "1" } }).status, 0);
});

test("hook: a new file from Write is checked whole", () => {
  const input = JSON.stringify({
    cwd: "/repo", tool_name: "Write",
    tool_input: { file_path: "/repo/stats.py", content: "def mean(xs):\n    # previously returned NaN for an empty list\n    return sum(xs) / max(len(xs), 1)\n" },
    tool_response: { type: "create", filePath: "/repo/stats.py", content: "def mean(xs):\n    # previously returned NaN for an empty list\n    return sum(xs) / max(len(xs), 1)\n", structuredPatch: [], originalFile: null },
  });
  const r = run(["hook"], { input });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /stats\.py:2 \(describes the old code\)/);
});

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hush-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com"); git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "a.js"), "// (Task 1) old comment already committed\nexport const a = 1;\n");
  git("add", "-A"); git("commit", "-qm", "init");
  return { dir, git };
}

test("check: only comments added since the last commit, including new files", () => {
  const { dir } = repo();
  fs.appendFileSync(path.join(dir, "a.js"), "// The old code returned 0 here\nexport const b = 2;\n");
  fs.writeFileSync(path.join(dir, "new.ts"), "// Why: the API rounds down.\nexport const c = 3; // (step 2)\n");
  const r = run(["check", "--json"], { cwd: dir });
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout).map(f => `${f.file}:${f.line}`).sort(), ["a.js:3", "new.ts:2"]);
  fs.rmSync(dir, { recursive: true });
});

test("check --staged, --base and --all", () => {
  const { dir, git } = repo();
  git("checkout", "-qb", "feature");
  fs.writeFileSync(path.join(dir, "b.js"), "// As requested, b is two\nexport const b = 2;\n");
  git("add", "b.js");
  const staged = run(["check", "--staged", "--json"], { cwd: dir });
  assert.deepEqual(JSON.parse(staged.stdout).map(f => f.file), ["b.js"]);
  git("commit", "-qm", "b");
  assert.equal(run(["check"], { cwd: dir }).status, 0);
  const branch = run(["check", "--base", "main", "--json"], { cwd: dir });
  assert.deepEqual(JSON.parse(branch.stdout).map(f => f.file), ["b.js"]);
  const all = run(["check", "--all", "--json"], { cwd: dir });
  assert.deepEqual(JSON.parse(all.stdout).map(f => f.file).sort(), ["a.js", "b.js"]);
  const plain = run(["check", "a.js"], { cwd: dir });
  assert.match(plain.stdout, /a\.js:1/);
  assert.match(plain.stdout, /1 comment narrates/);
  fs.rmSync(dir, { recursive: true });
});

test("init adds the hook once, keeps other settings, and the hook it adds works", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hush-home-"));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "hush-proj-"));
  fs.mkdirSync(path.join(proj, ".claude"));
  fs.writeFileSync(path.join(proj, ".claude", "settings.json"), JSON.stringify({ model: "opus", hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }] } }));
  for (let i = 0; i < 2; i++) assert.equal(run(["init"], { cwd: proj, env: { HOME: home } }).status, 0);
  const s = JSON.parse(fs.readFileSync(path.join(proj, ".claude", "settings.json"), "utf8"));
  assert.equal(s.model, "opus");
  assert.equal(s.hooks.PostToolUse.length, 2);
  const cmd = s.hooks.PostToolUse[1].hooks[0].command;
  assert.match(cmd, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const r = spawnSync("sh", ["-c", cmd], { input: editPayload("/repo", "a.js", ["// (Task 9) wire it"]), encoding: "utf8" });
  assert.equal(r.status, 2);
  fs.rmSync(home, { recursive: true }); fs.rmSync(proj, { recursive: true });
});

test("check --github prints one annotation per finding", () => {
  const { dir } = repo();
  fs.writeFileSync(path.join(dir, "c.js"), "// Fixed: c rounds down\nexport const c = 3;\n");
  const r = run(["check", "c.js", "--github"], { cwd: dir });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^::error file=c\.js,line=1,title=hush%3A describes the edit::Fixed: c rounds down$/m);
  fs.rmSync(dir, { recursive: true });
});
