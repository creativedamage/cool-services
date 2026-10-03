#!/usr/bin/env node
/**
 * npm run release            releases the version the project is at (e.g. 1.18.2)
 * npm run release -- 1.7.1   sets that version first
 * Tags v<version> and pushes. GitHub Actions then builds the Mac app and
 * publishes the release, and every Cool Services sees it under Check for Updates.
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
if (!pkg.coolServices?.updateRepo || pkg.coolServices.updateRepo.startsWith("YOUR-")) fail("Set the GitHub repo first: npm run set-repo -- <github-name>/<repo>");
const cmp = (a, b) => a.split(".").map(Number).reduce((r, n, i) => r || n - b.split(".").map(Number)[i], 0);
if (cmp(ver, pkg.version) < 0) fail(`${ver} is older than the project's version (${pkg.version}).`);
if (git("status", "--porcelain")) fail("Commit or stash your changes first (git status shows uncommitted work).");
if (git("tag", "--list", `v${ver}`)) fail(`v${ver} is already released. Choose a newer version: npm run release -- <version>`);
let hasRemote = true;
try { git("remote", "get-url", "origin"); } catch { hasRemote = false; }
if (!hasRemote) fail("This folder isn't connected to GitHub yet: git remote add origin https://github.com/<github-name>/<repo>.git");

if (ver !== pkg.version) {
  pkg.version = ver;
  fs.writeFileSync("desktop/package.json", JSON.stringify(pkg, null, 2) + "\n");
  git("add", "desktop/package.json");
  git("commit", "-m", `Release v${ver}`);
}
git("tag", "-a", `v${ver}`, "-m", `Cool Services ${ver}`);
git("push", "-u", "origin", git("branch", "--show-current"));
git("push", "origin", `v${ver}`);
console.log(`✓ Pushed v${ver}. GitHub is building it now: https://github.com/${pkg.coolServices.updateRepo}/actions`);
console.log("  In about 15 minutes it appears under Releases, and Cool Services → Check for Updates offers it.");
