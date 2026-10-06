/**
 * Check for Updates: GitHub Releases → download → verify → replace the app → reopen.
 *
 * Each release (built by .github/workflows/release.yml) has:
 *   Sundays-<version>.dmg      first-time installs
 *   Sundays-<version>-mac.zip  what the updater downloads
 *   SHA256SUMS.txt                   checksums; an update that doesn't match is refused
 *
 * Installing: the new app is unpacked next to the download and checked (same app id, the expected
 * version, a valid code signature). Then a small script waits for Sundays to quit, swaps the
 * app in /Applications (keeping the old one until the new one is in place), and opens it again.
 * Settings, sign-ins and notes live in ~/Library/Application Support/Sundays and aren't touched.
 *
 * This doesn't use Squirrel/electron-updater, which only works for apps signed with a paid Apple
 * Developer ID.
 */
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { UpdateBridge, UpdateStatus } from "../../shared/updates";

const run = promisify(execFile);

export interface UpdaterOptions {
  currentVersion: string;
  /** Which Sundays app this is (shared/apps.ts): its bundle id, name and release file names. */
  appId?: string;
  appName?: string;
  /** Release files are <artifact>-<version>-mac.zip */
  artifact?: string;
  /** "owner/repo", or null until it's set (npm run set-repo). */
  repo: string | null;
  /** Path of the running "Sundays.app". */
  appBundle: string;
  /** Quit the app (the install script takes over from here). */
  quit: () => void;
  /** Tests point this at a stand-in for api.github.com. */
  apiBase?: string;
  workDir?: string;
  /** Tests skip the macOS-only checks (ditto, codesign, plutil). */
  macChecks?: boolean;
  log?: (msg: string) => void;
}

interface GhAsset { name: string; browser_download_url: string; size: number }
interface GhRelease { tag_name: string; name: string | null; body: string | null; html_url: string; published_at: string; draft: boolean; prerelease: boolean; assets: GhAsset[] }

/** "1.10.0" > "1.9.2"; ignores a leading "v" and anything after "-". */
export function newer(a: string, b: string): boolean {
  const p = (v: string) => v.replace(/^v/, "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

/** Where a running app can't be replaced in place (and what to do instead). */
export function installProblem(appBundle: string): string | null {
  if (!appBundle.endsWith(".app")) return "Updates install from the packaged Mac app (not while developing).";
  if (appBundle.startsWith("/Volumes/")) return "Sundays is running from the installer disk. Drag it into Applications, open it from there, then update.";
  if (appBundle.includes("/AppTranslocation/")) return "macOS is running Sundays from a temporary location. Move it into your Applications folder, open it again, then update.";
  try {
    fs.accessSync(path.dirname(appBundle), fs.constants.W_OK);
    fs.accessSync(appBundle, fs.constants.W_OK);
  } catch {
    return `This Mac account can't replace ${appBundle}. Sign in as an administrator, or download the new version from GitHub.`;
  }
  return null;
}

export function createUpdater(o: UpdaterOptions): UpdateBridge & { start(): void } {
  const api = o.apiBase ?? "https://api.github.com";
  const work = o.workDir ?? path.join(os.tmpdir(), "sundays-update");
  const log = o.log ?? (() => {});
  const macChecks = o.macChecks ?? process.platform === "darwin";
  let release: GhRelease | null = null;
  let checking: Promise<UpdateStatus> | null = null;
  let installing: Promise<UpdateStatus> | null = null;
  const s: UpdateStatus = {
    state: o.repo ? "idle" : "unavailable",
    current: o.currentVersion,
    repo: o.repo,
    latest: null,
    progress: null,
    error: o.repo ? null : "The GitHub repository for updates hasn’t been set (npm run set-repo).",
    checkedAt: null,
    installProblem: installProblem(o.appBundle),
  };
  const status = () => ({ ...s, latest: s.latest && { ...s.latest } });
  const fail = (msg: string) => { s.state = "error"; s.error = msg; s.progress = null; log(`update error: ${msg}`); return status(); };

  async function gh<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": `Sundays/${o.currentVersion}`, "X-GitHub-Api-Version": "2022-11-28" } });
    if (res.status === 404) throw new Error(`No releases found for ${o.repo} on GitHub yet.`);
    if (res.status === 403 || res.status === 429) throw new Error("GitHub is limiting requests right now. Try again in a few minutes.");
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
    return (await res.json()) as T;
  }

  const appId = o.appId ?? "org.coolchurch.coolservices";
  const appName = o.appName ?? "Sundays";
  const artifact = o.artifact ?? "Sundays";
  // Every Sundays app is in each release: only this app's download.
  const zipOf = (r: GhRelease) => r.assets.find((a) => a.name.toLowerCase() === `${artifact}-${r.tag_name.replace(/^v/, "")}-mac.zip`.toLowerCase());
  const sumsOf = (r: GhRelease) => r.assets.find((a) => /^SHA256SUMS(\.txt)?$/i.test(a.name));

  function check(): Promise<UpdateStatus> {
    if (!o.repo) return Promise.resolve(status());
    if (s.state === "downloading" || s.state === "installing") return Promise.resolve(status());
    checking ??= (async () => {
      s.state = "checking"; s.error = null;
      try {
        const r = await gh<GhRelease>(`${api}/repos/${o.repo}/releases/latest`);
        s.checkedAt = new Date().toISOString();
        const version = r.tag_name.replace(/^v/, "");
        s.latest = { version, notes: (r.body ?? "").trim(), url: r.html_url, publishedAt: r.published_at };
        if (!newer(version, o.currentVersion)) { release = null; s.state = "up-to-date"; return status(); }
        if (!zipOf(r) || !sumsOf(r)) return fail(`Version ${version} is on GitHub, but its Mac download isn’t ready yet. Try again in a few minutes.`);
        release = r;
        s.state = "available";
        log(`update available: ${version}`);
        return status();
      } catch (e) {
        return fail((e as Error).message);
      }
    })().finally(() => { checking = null; });
    return checking;
  }

  async function download(a: GhAsset, to: string) {
    const res = await fetch(a.browser_download_url, { headers: { "User-Agent": `Sundays/${o.currentVersion}` }, redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
    const total = Number(res.headers.get("content-length")) || a.size || 0;
    const out = fs.createWriteStream(to);
    const hash = crypto.createHash("sha256");
    let got = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      hash.update(value);
      if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
      if (total) s.progress = Math.min(0.99, got / total);
    }
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));
    return hash.digest("hex");
  }

  async function plist(app: string, key: string) {
    const { stdout } = await run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", path.join(app, "Contents", "Info.plist")]);
    return stdout.trim();
  }

  function install(): Promise<UpdateStatus> {
    installing ??= (async () => {
      if (!release) await check();
      const r = release;
      if (!r || s.state !== "available") return status();
      const problem = installProblem(o.appBundle);
      if (problem) { s.installProblem = problem; return fail(problem); }
      const version = r.tag_name.replace(/^v/, "");
      try {
        fs.rmSync(work, { recursive: true, force: true });
        fs.mkdirSync(work, { recursive: true });
        s.state = "downloading"; s.progress = 0; s.error = null;

        // Checksums first, so a tampered or half-uploaded download is caught.
        const sumsRes = await fetch(sumsOf(r)!.browser_download_url, { headers: { "User-Agent": `Sundays/${o.currentVersion}` } });
        if (!sumsRes.ok) throw new Error("Couldn’t download the checksums for this update.");
        const zip = zipOf(r)!;
        const expected = (await sumsRes.text()).split("\n").map((l) => l.trim().split(/\s+\*?/)).find(([, name]) => name === zip.name)?.[0]?.toLowerCase();
        if (!expected) throw new Error(`The checksums file doesn’t list ${zip.name}.`);
        const zipPath = path.join(work, zip.name);
        const actual = await download(zip, zipPath);
        if (actual !== expected) throw new Error("The download didn’t match its checksum, so it wasn’t installed. Try again.");
        s.progress = 1;

        // Unpack and check the new app before touching the one that's installed.
        s.state = "installing";
        const stage = path.join(work, "new");
        fs.mkdirSync(stage);
        let newApp: string;
        if (macChecks) {
          await run("/usr/bin/ditto", ["-x", "-k", zipPath, stage]);
          const found = fs.readdirSync(stage).find((f) => f === `${appName}.app`) ?? fs.readdirSync(stage).find((f) => f.endsWith(".app"));
          if (!found) throw new Error("The update doesn’t contain the app.");
          newApp = path.join(stage, found);
          if ((await plist(newApp, "CFBundleIdentifier")) !== appId) throw new Error(`The update isn’t ${appName}.`);
          const v = await plist(newApp, "CFBundleShortVersionString");
          if (v !== version) throw new Error(`The update says it's version ${v}, expected ${version}.`);
          await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", newApp]).catch(() => { throw new Error("The update’s code signature isn’t valid."); });
        } else {
          newApp = path.join(stage, `${appName}.app`);
          fs.mkdirSync(newApp);
        }

        const script = path.join(work, "install.sh");
        fs.writeFileSync(script, installScript({ pid: process.pid, app: o.appBundle, newApp, work, logFile: path.join(os.homedir(), "Library", "Logs", `${appName} update.log`) }), { mode: 0o700 });
        log(`installing ${version}: ${script}`);
        spawn("/bin/bash", [script], { detached: true, stdio: "ignore" }).unref();
        setTimeout(o.quit, 300);
        return status();
      } catch (e) {
        return fail((e as Error).message);
      }
    })().finally(() => { installing = null; });
    return installing;
  }

  return {
    status,
    check,
    install,
    start() {
      if (!o.repo) return;
      setTimeout(() => void check(), 8_000); // shortly after launch
      setInterval(() => { if (s.state !== "downloading" && s.state !== "installing") void check(); }, 6 * 3600e3);
    },
  };
}

/** The script that swaps the app once Sundays has quit. Keeps the old app until the new one is in place. */
export function installScript(v: { pid: number; app: string; newApp: string; work: string; logFile: string }): string {
  const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;
  return `#!/bin/bash
# Sundays updater: replace the app after it quits, then open it again.
APP=${q(v.app)}
NEW=${q(v.newApp)}
WORK=${q(v.work)}
LOG=${q(v.logFile)}
BACKUP="$APP.previous"
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1
echo "$(date) updating $APP"
# Wait (up to 60s) for Sundays to quit.
for i in $(seq 1 300); do kill -0 ${v.pid} 2>/dev/null || break; sleep 0.2; done
rm -rf "$BACKUP"
if ! mv "$APP" "$BACKUP"; then echo "couldn't move the old app aside"; open "$APP"; exit 1; fi
# The new app keeps its own name (Cool Services.app becomes Sundays.app), next to where the old one was.
DEST="$(dirname "$APP")/$(basename "$NEW")"
[ "$DEST" != "$APP" ] && rm -rf "$DEST"
if ditto "$NEW" "$DEST"; then
  xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
  rm -rf "$BACKUP" "$WORK"
  echo "$(date) updated: $DEST"
  open "$DEST"
else
  echo "copy failed; putting the old app back"
  rm -rf "$DEST"
  mv "$BACKUP" "$APP"
  open "$APP"
fi
`;
}
