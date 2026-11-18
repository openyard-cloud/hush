const dim = s => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[2m${s}\x1b[0m` : s);

export function report(found) {
  if (!found.length) return "hush: no narrating comments.\n";
  const lines = found.map(f => `${f.file}:${f.line}  ${dim(f.kind)}\n    ${f.comment}`);
  const n = found.length;
  return `${lines.join("\n")}\n\nhush: ${n} ${n === 1 ? "comment narrates" : "comments narrate"} the work instead of describing the code.\n`;
}

// What Claude reads after an edit. It has to say what to do instead, or the comment just gets reworded.
export function hookMessage(found) {
  const n = found.length;
  const list = found.map(f => `  ${f.file}:${f.line} (${f.kind}): ${f.comment}`).join("\n");
  return `hush: ${n === 1 ? "this comment you just added narrates" : `these ${n} comments you just added narrate`} the work instead of describing the code:
${list}

Someone reading this file later will not have this chat, the plan or the old code. Rewrite each one to say only what the code does now or why it is this way, with no mention of tasks, phases, steps, the user, or what changed. If the code already says it, delete the comment. Change nothing else.
`;
}

// GitHub Actions workflow commands: each finding shows on its line in the pull request.
export function annotations(found) {
  const esc = s => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const prop = s => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  const rows = found.map(f => `::error file=${prop(f.file)},line=${f.line},title=${prop(`hush: ${f.kind}`)}::${esc(f.comment)}`);
  return rows.join("\n") + (rows.length ? "\n" : "") + report(found);
}
