// Finds comments that narrate a change instead of describing the code.
// Only added lines are checked, so comments already in a file are never blamed on the agent.

const SLASH = ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "go", "rs", "java", "kt", "kts", "swift", "c", "h", "cc", "cpp", "hpp", "cs", "scala", "dart", "php", "css", "scss", "less", "zig", "groovy"];
const HASH = ["py", "rb", "sh", "bash", "zsh", "yaml", "yml", "toml", "r", "pl", "ex", "exs", "tf", "nix", "ps1", "jl", "cr", "coffee"];
const DASH = ["sql", "lua", "hs", "elm"];

export function styleFor(file) {
  const ext = (file.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
  if (SLASH.includes(ext)) return { line: ["//"], block: true, hash: ext === "php" };
  if (HASH.includes(ext)) return { line: ["#"], block: false, doc: ext === "py" };
  if (DASH.includes(ext)) return { line: ["--"], block: false };
  return null;
}

// The comment part of one source line, or null. Quotes are tracked so `"http://x"` is not a comment.
export function commentOf(src, style, state) {
  if (state.inBlock) {
    const end = src.indexOf("*/");
    if (end >= 0) state.inBlock = false;
    return clean(end >= 0 ? src.slice(0, end) : src);
  }
  if (state.inDoc) {
    const end = src.indexOf(state.inDoc);
    if (end >= 0) state.inDoc = null;
    return clean(end >= 0 ? src.slice(0, end) : src);
  }
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (style.doc && (src.startsWith('"""', i) || src.startsWith("'''", i)) && !src.slice(0, i).trim().replace(/^[rbuf]+$/i, "")) {
      const q = src.slice(i, i + 3);
      const end = src.indexOf(q, i + 3);
      if (end < 0) state.inDoc = q;
      return clean(src.slice(i + 3, end < 0 ? undefined : end));
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    for (const mark of style.line) if (src.startsWith(mark, i)) return clean(src.slice(i + mark.length));
    if (style.hash && c === "#") return clean(src.slice(i + 1));
    if (style.block && src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) state.inBlock = true;
      return clean(src.slice(i + 2, end < 0 ? undefined : end));
    }
  }
  return null;
}

function isWholeLine(src, style) {
  const t = src.trim();
  return style.line.some(m => t.startsWith(m)) || (style.block && (t.startsWith("/*") || t.startsWith("*"))) || (style.hash && t.startsWith("#"));
}

function clean(s) {
  return s.replace(/^[\s/*#!-]+/, "").replace(/[\s*/]+$/, "").trim();
}

// Each rule: what kind of narration it is, and a pattern tight enough that ordinary "why" comments pass.
export const RULES = [
  {
    kind: "talks to the reader of the chat",
    re: /\b(as (you )?(requested|asked|discussed|agreed)|per (your|the user'?s?) (request|instructions?)|you (asked|wanted|mentioned|said)|(this|our) (conversation|chat)|per our discussion)\b/i,
  },
  {
    kind: "refers to a plan step",
    re: /\((task|step|phase) ?#?\d+(\.\d+)*[a-z]?[);,\/:\s]|^task ?#?\d+(\.\d+)*[a-z]?\s*[:\u2014\u2013-]|^phase \d+\.\d+|\bper the plan\b/i,
  },
  {
    kind: "describes the old code",
    re: /\b((was|were|is|are) previously|^previously,? (this|it|we|the code|did|had|was|were|returned|returns|used|called)\b|(it|this|they|we|that|which) used to|used to be|the (old|previous|original|former) (code|implementation|approach|logic|behaviou?r)|instead of the old|before (this|my) (fix|refactor|rewrite|change)|no longer (needed|used))\b/i,
  },
  {
    kind: "describes the edit",
    first: true,
    re: /^(now (uses|reads|returns|calls|lives|takes|checks|handles|accepts)|moved (to|from|here|into)|changed (from|to)|renamed (from|to)|removed (the|this|unused|old|dead)|refactored|updated (to|so)|fixed( for)?:|fixed the|bug ?fix:|added (this|to fix)|this (fixes|change|edit))(?!\w)/i,
  },
  {
    kind: "change marker",
    first: true,
    re: /^(NEW|UPDATED|CHANGED|ADDED|FIXED|MODIFIED|EDITED)\b\s*[:!-]?/,
  },
];

// first: is this the first line of a comment? Rules about how a comment starts skip continuation lines.
export function judge(text, first = true) {
  if (!text || text.length < 4 || text.includes("hush-ignore")) return null;
  if (/^(eslint|prettier|ts-|@ts-|noqa|type:|pylint|nolint|#?region|endregion|istanbul|c8|biome|deno-lint|@param|@returns?|@type)/i.test(text)) return null;
  for (const r of RULES) if ((first || !r.first) && r.re.test(text)) return r.kind;
  return null;
}

// lines: [{n, text}] of added source lines (n = 1-based line in the new file).
export function findNarration(file, lines) {
  const style = styleFor(file);
  if (!style) return [];
  const state = {};
  const out = [];
  let prev = -1, prevWasComment = false;
  for (const { n, text } of lines) {
    if (n !== prev + 1) { state.inBlock = false; state.inDoc = null; prevWasComment = false; }
    prev = n;
    const wasInside = state.inBlock || !!state.inDoc;
    const c = commentOf(text, style, state);
    const whole = c !== null && isWholeLine(text, style);
    const first = !(wasInside || (whole && prevWasComment));
    prevWasComment = whole || state.inBlock || !!state.inDoc;
    const kind = judge(c, first);
    if (kind) out.push({ file, line: n, kind, comment: c });
  }
  return out;
}

// Added lines from a Claude Code Edit/MultiEdit/Write hook payload.
export function addedLines(payload) {
  const res = payload.tool_response || {};
  const input = payload.tool_input || {};
  const patch = res.structuredPatch;
  if (Array.isArray(patch) && patch.length) {
    const out = [];
    for (const h of patch) {
      let n = h.newStart;
      for (const l of h.lines || []) {
        if (l.startsWith("+")) out.push({ n: n++, text: l.slice(1) });
        else if (l.startsWith(" ")) n++;
      }
    }
    return out;
  }
  const content = res.type === "create" || res.originalFile === null ? (res.content ?? input.content) : null;
  if (typeof content === "string") return content.split("\n").map((text, i) => ({ n: i + 1, text }));
  return [];
}

// Added lines from a unified diff (git diff -U0 or wider), per file.
export function addedFromDiff(diff) {
  const files = new Map();
  let file = null, n = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++ ")) {
      const p = l.slice(4).trim();
      file = p === "/dev/null" ? null : p.replace(/^b\//, "");
      if (file && !files.has(file)) files.set(file, []);
      continue;
    }
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { n = +h[1]; continue; }
    if (!file || l.startsWith("--- ")) continue;
    if (l.startsWith("+")) files.get(file).push({ n: n++, text: l.slice(1) });
    else if (l.startsWith(" ")) n++;
  }
  return files;
}
