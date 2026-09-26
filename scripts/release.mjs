#!/usr/bin/env node
/**
 * npm run release -- 1.7.1
 * Sets the version, commits, tags v1.7.1 and pushes. GitHub Actions then builds the Mac app and
 * publishes the release, and every Cool Services sees it under Check for Updates.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const v = (process.argv[2] ?? "").replace(/^v/, "");
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const fail = (m) => { console.error(m); process.exit(1); };

if (!/^\d+\.\d+\.\d+$/.test(v)) fail("Usage: npm run release -- <version>   e.g. npm run release -- 1.7.1");
const pkg = JSON.parse(fs.readFileSync("desktop/package.json", "utf8"));
if (!pkg.coolServices?.updateRepo || pkg.coolServices.updateRepo.startsWith("YOUR-")) fail("Set the GitHub repo first: npm run set-repo -- <github-name>/<repo>");
const cmp = (a, b) => a.split(".").map(Number).reduce((r, n, i) => r || n - b.split(".").map(Number)[i], 0);
if (cmp(v, pkg.version) <= 0) fail(`${v} must be newer than the current version (${pkg.version}).`);
if (git("status", "--porcelain")) fail("Commit or stash your changes first (git status shows uncommitted work).");
if (git("tag", "--list", `v${v}`)) fail(`Tag v${v} already exists.`);

pkg.version = v;
fs.writeFileSync("desktop/package.json", JSON.stringify(pkg, null, 2) + "\n");
git("add", "desktop/package.json");
git("commit", "-m", `Release v${v}`);
git("tag", "-a", `v${v}`, "-m", `Cool Services ${v}`);
git("push");
git("push", "origin", `v${v}`);
console.log(`✓ Pushed v${v}. GitHub is building it now: https://github.com/${pkg.coolServices.updateRepo}/actions`);
console.log("  In about 15 minutes it appears under Releases, and Cool Services → Check for Updates offers it.");
