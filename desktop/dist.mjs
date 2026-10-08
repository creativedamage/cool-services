// Packages the Sundays Mac apps from one build (node build.mjs --dist first; npm run dist:mac does
// both). Each app is the same shell told which app it is (package.json → sundaysApp), with its own
// name, bundle id, icon and release files (shared/apps.ts):
//
//   Sundays-<v>.dmg / Sundays-<v>-mac.zip                    the full app (everything)
//   Sundays-Operations-<v>.dmg, Sundays-AVL-<v>.dmg (+ -mac.zip)
//
// A retired app (shared/apps.ts → retired) gets a small farewell build in every release (zip only,
// for the updater): it says the app is now part of Sundays and opens it. Every release has one, so
// a Mac still on an old version reaches it whichever release is the latest when it checks.
//
// SUNDAYS_APPS=sundays,ops packages only those (default: all current ones); SUNDAYS_ARCH=arm64 builds for
// Apple silicon only (quicker, for testing). Finished files land in desktop/release/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { Arch, build, Platform } from "electron-builder";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));
const version = pkg.version;

// shared/apps.ts → plain JS, to read the list of apps.
const js = (await esbuild.build({ entryPoints: [path.join(root, "shared", "apps.ts")], bundle: true, format: "esm", write: false, platform: "neutral" })).outputFiles[0].text;
const { APPS, APP_IDS } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const wanted = (process.env.SUNDAYS_APPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const current = APP_IDS;
const ids = wanted.length ? current.filter((id) => wanted.includes(id)) : current;
if (!ids.length) { console.error(`No apps match SUNDAYS_APPS=${process.env.SUNDAYS_APPS}. Choose from: ${APP_IDS.join(", ")}`); process.exit(1); }

const release = path.join(here, "release");
fs.mkdirSync(release, { recursive: true });
const base = pkg.build;

for (const id of ids) {
  const a = APPS[id];
  const farewell = !!a.retired;
  // A farewell build only needs the shell (and the website's screens, like Operations and AVL).
  const cloud = a.kind === "cloud" || farewell;
  console.log(`\n• Packaging ${a.name} (${a.bundleId})…`);
  const out = path.join(release, "apps", id);
  fs.rmSync(out, { recursive: true, force: true });
  const icon = path.join(here, "build", "icons", `${id}.png`);
  /** @type {import("electron-builder").Configuration} */
  const config = {
    ...base,
    appId: a.bundleId,
    productName: a.name,
    // package.json inside the app: which app it is (desktop/src/main.ts reads it).
    extraMetadata: { sundaysApp: id, productName: a.name },
    directories: { ...base.directories, output: out },
    // Operations and AVL only need the shell and the website's screens.
    files: cloud ? ["app/main.cjs", "app/site/**/*", "package.json"] : base.files,
    asarUnpack: cloud ? [] : base.asarUnpack,
    extraResources: cloud ? [] : base.extraResources,
    mac: {
      ...base.mac,
      icon: fs.existsSync(icon) ? icon : base.mac.icon,
      artifactName: `${a.artifact}-\${version}-mac.\${ext}`,
      extendInfo: cloud ? {} : base.mac.extendInfo,
    },
    dmg: { ...base.dmg, title: a.name, artifactName: `${a.artifact}-\${version}.\${ext}` },
  };
  if (cloud) delete config.mac.x64ArchFiles; // no NDI or Micboard inside
  // Nobody downloads a retired app new, so its farewell is only the updater's zip.
  await build({ targets: Platform.MAC.createTarget(farewell ? ["zip"] : ["dmg", "zip"], process.env.SUNDAYS_ARCH === "arm64" ? Arch.arm64 : Arch.universal), config, publish: "never" });
  for (const f of farewell ? [`${a.artifact}-${version}-mac.zip`] : [`${a.artifact}-${version}.dmg`, `${a.artifact}-${version}-mac.zip`]) {
    const src = path.join(out, f);
    if (!fs.existsSync(src)) throw new Error(`${f} wasn’t made`);
    fs.copyFileSync(src, path.join(release, f));
  }
  console.log(`  ✓ ${a.artifact}-${version}${farewell ? "-mac.zip (farewell)" : ".dmg and -mac.zip"}`);
}
console.log(`\n✓ ${ids.length} app${ids.length === 1 ? "" : "s"} in desktop/release`);
