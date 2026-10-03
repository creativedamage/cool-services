// Builds everything the Mac app needs into desktop/app/:
//   web/out (static UI)  →  app/web
//   server (API)         →  app/server.cjs   (one bundled file, no node_modules)
//   src/main.ts          →  app/main.cjs
//   koffi (ready-built)  →  app/native/koffi  (calls the NDI library; nothing is compiled)
//   NDI library          →  app/native/ndi/libndi.dylib  (from NDI's official Mac SDK installer)
//   Micboard             →  app/native/micboard, python, micboard-site  (vendor/micboard, unchanged;
//                           see micboard-build.mjs)
//
// `node build.mjs --dist` (npm run dist:mac) stops with an explanation if the NDI library can't be
// added, so a DMG never ships without NDI by accident. COOL_SKIP_NDI=1 builds without it.
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const out = path.join(here, "app");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

console.log("• Building the web UI (static export)…");
execSync("npm run build -w web", { cwd: root, stdio: "inherit" });
fs.cpSync(path.join(root, "web", "out"), path.join(out, "web"), { recursive: true });

console.log("• Bundling the server…");
await esbuild.build({
  entryPoints: [path.join(root, "server", "src", "app.ts")],
  outfile: path.join(out, "server.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  logLevel: "warning",
});

console.log("• Bundling the app shell…");
await esbuild.build({
  entryPoints: [path.join(here, "src", "main.ts")],
  outfile: path.join(out, "main.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron", "./server.cjs", "koffi"],
  logLevel: "warning",
});

/* ── NDI (production clock output) ── */
const forDist = process.argv.includes("--dist");
const require = createRequire(import.meta.url);
const native = path.join(out, "native");
fs.mkdirSync(native, { recursive: true });

console.log("• Adding koffi (ready-built, for calling the NDI library)…");
{
  const kdir = path.dirname(require.resolve("koffi/package.json", { paths: [here, root] }));
  const dest = path.join(native, "koffi");
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ["package.json", "index.js", "indirect.js", "LICENSE.txt"]) if (fs.existsSync(path.join(kdir, f))) fs.copyFileSync(path.join(kdir, f), path.join(dest, f));
  // Only the Mac builds of koffi (both processors; the universal app carries both).
  for (const plat of ["darwin_arm64", "darwin_x64", ...(process.platform === "darwin" ? [] : [`${process.platform}_${process.arch}`])]) {
    const src = path.join(kdir, "build", "koffi", plat);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dest, "build", "koffi", plat), { recursive: true });
  }
}

const NDI_PKG_URL = "https://downloads.ndi.tv/SDK/NDI_SDK_Mac/Install_NDI_SDK_v6_Apple.pkg";
const cacheDir = path.join(os.homedir(), "Library", "Caches", "cool-services-build");

/** Copy libndi.dylib (and NDI's license files) out of NDI's official SDK installer. Mac only. */
async function addNdiLibrary() {
  const dest = path.join(native, "ndi");
  fs.mkdirSync(dest, { recursive: true });
  if (process.env.COOL_NDI_LIB) { // your own copy
    fs.copyFileSync(process.env.COOL_NDI_LIB, path.join(dest, "libndi.dylib"));
    return true;
  }
  if (process.platform !== "darwin") { console.log("  (not a Mac: skipping the NDI library)"); return false; }
  fs.mkdirSync(cacheDir, { recursive: true });
  const pkg = path.join(cacheDir, "Install_NDI_SDK_v6_Apple.pkg");
  if (!fs.existsSync(pkg) || fs.statSync(pkg).size < 1_000_000) {
    console.log(`  downloading NDI’s Mac SDK installer (once; kept in ${cacheDir})…`);
    const res = await fetch(NDI_PKG_URL);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    fs.writeFileSync(pkg + ".part", Buffer.from(await res.arrayBuffer()));
    fs.renameSync(pkg + ".part", pkg);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cool-ndi-"));
  const expanded = path.join(tmp, "x"); // pkgutil wants a folder that doesn't exist yet
  execFileSync("pkgutil", ["--expand", pkg, expanded], { stdio: "ignore" });
  const payload = fs.readdirSync(expanded).map((d) => path.join(expanded, d, "Payload")).find((p) => fs.existsSync(p) && /SDK/i.test(p));
  if (!payload) throw new Error("the installer’s layout changed (no SDK payload)");
  execFileSync("cpio", ["-idmu", "-F", payload], { cwd: tmp, stdio: "ignore" }); // macOS cpio reads the compressed payload itself
  const find = (dir, test, depth = 0) => {
    if (depth > 6 || !fs.existsSync(dir)) return null;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isFile() && test(p)) return p;
      if (e.isDirectory()) { const r = find(p, test, depth + 1); if (r) return r; }
    }
    return null;
  };
  const lib = find(tmp, (p) => /lib[\/]macOS[\/]libndi\.dylib$/.test(p)) ?? find(tmp, (p) => /libndi\.dylib$/.test(p));
  if (!lib) throw new Error("libndi.dylib wasn’t in the installer");
  fs.copyFileSync(fs.realpathSync(lib), path.join(dest, "libndi.dylib"));
  const lic = find(tmp, (p) => /license/i.test(path.basename(p)) && /\.(txt|pdf|rtf)$/i.test(p));
  if (lic) fs.copyFileSync(lic, path.join(dest, path.basename(lic)));
  fs.writeFileSync(path.join(dest, "NOTICE.txt"), "NDI® is a registered trademark of Vizrt NDI AB. https://ndi.video\nThis app includes the NDI runtime library, redistributed under the NDI SDK license.\n");
  fs.rmSync(tmp, { recursive: true, force: true });
  // Show which processors it covers (a universal library has both).
  try { console.log("  " + execFileSync("lipo", ["-info", path.join(dest, "libndi.dylib")]).toString().trim()); } catch { /* lipo is optional */ }
  return true;
}

if (process.env.COOL_SKIP_NDI === "1") {
  console.log("• Skipping NDI (COOL_SKIP_NDI=1)");
} else {
  console.log("• Adding the NDI library…");
  let ok = false;
  try { ok = await addNdiLibrary(); } catch (e) {
    console.log(`  couldn’t add the NDI library: ${e.message}`);
  }
  if (!ok && forDist && process.platform === "darwin") {
    console.error(`
✗ The NDI library couldn’t be added, so the clock’s NDI output wouldn’t work in this DMG.
  • Check this Mac is online (it downloads NDI’s Mac SDK installer once from downloads.ndi.tv), then run npm run dist:mac again.
  • Or point at a copy you have:  COOL_NDI_LIB="/Library/NDI SDK for Apple/lib/macOS/libndi.dylib" npm run dist:mac
  • Or build without NDI:          COOL_SKIP_NDI=1 npm run dist:mac
`);
    process.exit(1);
  }
}

/* ── Micboard (creativedamage/micboard in vendor/micboard, run by its own Python inside the app) ── */
if (process.env.COOL_SKIP_MICBOARD === "1") {
  console.log("• Skipping Micboard (COOL_SKIP_MICBOARD=1)");
} else {
  console.log("• Adding Micboard…");
  try {
    const { addMicboard } = await import("./micboard-build.mjs");
    await addMicboard({ root, native, cacheDir });
  } catch (e) {
    console.error(`
✗ Micboard couldn’t be added: ${e.message}
  • Check this Mac is online (it downloads Python once from github.com/astral-sh/python-build-standalone,
    and Micboard’s npm and pip packages), then build again.
  • Or build without it:  COOL_SKIP_MICBOARD=1 npm run dist:mac
`);
    if (forDist) process.exit(1);
  }
}

console.log("✓ app/ ready");
