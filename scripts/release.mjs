#!/usr/bin/env node
/**
 * npm run release            releases the version the project is at (e.g. 1.18.2)
 * npm run release -- 1.7.1   sets that version first
 * Tags v<version> and pushes. GitHub Actions then builds the Mac app and
 * publishes the release, and every Sundays sees it under Check for Updates.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const v = (process.argv[2] ?? "").replace(/^v/, "");
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const fail = (m) => { console.error(m); process.exit(1); };

const pkg = JSON.parse(fs.readFileSync("desktop/package.json", "utf8"));
// No version given: release the version the project is already at (what each update from Claude sets).
const ver = v || pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(ver)) fail("Usage: npm run release   (or npm run release -- 1.7.1 to choose the version)");
if (!pkg.sundays?.updateRepo || pkg.sundays.updateRepo.startsWith("YOUR-")) fail("Set the GitHub repo first: npm run set-repo -- <github-name>/<repo>");
const cmp = (a, b) => a.split(".").map(Number).reduce((r, n, i) => r || n - b.split(".").map(Number)[i], 0);
if (cmp(ver, pkg.version) < 0) fail(`${ver} is older than the project's version (${pkg.version}).`);
if (git("status", "--porcelain")) fail("Commit or stash your changes first (git status shows uncommitted work).");
if (git("tag", "--list", `v${ver}`)) fail(`v${ver} is already released. Choose a newer version: npm run release -- <version>`);
let hasRemote = true;
try { git("remote", "get-url", "origin"); } catch { hasRemote = false; }
if (!hasRemote) fail("This folder isn't connected to GitHub yet: git remote add origin https://github.com/<github-name>/<repo>.git");

// The version's notes from CHANGELOG.md: the first line is the summary that names the release.
const changelog = fs.existsSync("CHANGELOG.md") ? fs.readFileSync("CHANGELOG.md", "utf8") : "";
const section = changelog.split(/^## /m).find((x) => x.startsWith(`${ver}\n`) || x.startsWith(`${ver}\r\n`));
if (!section) fail(`Add a "## ${ver}" section to CHANGELOG.md first: a one-line summary, then what changed.`);
const summary = section.split(/\r?\n/).slice(1).find((l) => l.trim() && !l.startsWith("-"))?.trim().replace(/\.$/, "") ?? "";
if (!summary) fail(`Give "## ${ver}" in CHANGELOG.md a one-line summary under the heading.`);
const title = `Sundays ${ver} — ${summary}`;

if (ver !== pkg.version) {
  pkg.version = ver;
  fs.writeFileSync("desktop/package.json", JSON.stringify(pkg, null, 2) + "\n");
  git("add", "desktop/package.json");
}
// The release commit (also when nothing changed) is what GitHub Actions shows as the run's name.
git("commit", "--allow-empty", "-m", title);
git("tag", "-a", `v${ver}`, "-m", title);
git("push", "-u", "origin", git("branch", "--show-current"));
git("push", "origin", `v${ver}`);
console.log(`✓ ${title}`);
console.log(`✓ Pushed v${ver}. GitHub is building it now: https://github.com/${pkg.sundays.updateRepo}/actions`);
console.log("  In about 15 minutes it appears under Releases, and Sundays → Check for Updates offers it.");
