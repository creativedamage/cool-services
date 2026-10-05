#!/usr/bin/env node
/**
 * npm run set-repo -- your-github-name/sundays
 * Tells the app which GitHub repository to check for updates (and records it in package.json).
 */
import fs from "node:fs";
const repo = (process.argv[2] ?? "").trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error("Usage: npm run set-repo -- <github-name>/<repo>   e.g. npm run set-repo -- coolchurch/sundays");
  process.exit(1);
}
const edit = (file, fn) => { const j = JSON.parse(fs.readFileSync(file, "utf8")); fn(j); fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n"); };
edit("desktop/package.json", (j) => { j.sundays = { ...(j.sundays ?? {}), updateRepo: repo }; delete j.coolServices; j.repository = `github:${repo}`; });
edit("package.json", (j) => { j.repository = { type: "git", url: `https://github.com/${repo}.git` }; });
console.log(`✓ Updates will come from https://github.com/${repo}/releases`);
console.log("  Commit this change, then build (or release) so the app knows where to look.");
