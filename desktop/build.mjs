// Builds everything the Mac app needs into desktop/app/:
//   web/out (static UI)  →  app/web
//   server (API)         →  app/server.cjs   (one bundled file, no node_modules)
//   src/main.ts          →  app/main.cjs
//   NDI add-on           →  app/native/grandiose   (grandiose.node + libndi.dylib)
//
// `node build.mjs --dist` (used by npm run dist:mac) stops with an explanation if the NDI add-on
// isn't built, so a DMG never ships without NDI by accident. COOL_SKIP_NDI=1 builds without it.
import { execSync } from "node:child_process";
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
  external: ["electron", "./server.cjs", "@stagetimerio/grandiose"],
  logLevel: "warning",
});

/* ── NDI add-on ── */
const forDist = process.argv.includes("--dist");
const require = createRequire(import.meta.url);
const NDI_PKG = "@stagetimerio/grandiose";
const ndiVersion = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8")).optionalDependencies?.[NDI_PKG];
const findNdi = () => { try { return path.dirname(require.resolve(`${NDI_PKG}/package.json`, { paths: [here, root] })); } catch { return null; } };
const built = (dir) => Boolean(dir) && fs.existsSync(path.join(dir, "dist", "grandiose.node"));
const sh = (cmd, cwd = root) => { try { execSync(cmd, { cwd, stdio: "inherit" }); return true; } catch { return false; } };

function prepareNdi() {
  if (process.env.COOL_SKIP_NDI) { console.log("• NDI: skipped (COOL_SKIP_NDI)"); return; }
  let dir = findNdi();
  if (!built(dir) && process.platform === "darwin") {
    // npm skips a failed optional install without saying much. Try again, out loud.
    console.log(`• NDI: the add-on isn't built yet. Building ${NDI_PKG}@${ndiVersion} (downloads the NDI SDK, then compiles)…`);
    if (dir) sh(`npm rebuild ${NDI_PKG} --foreground-scripts`);
    dir = findNdi();
    if (!built(dir)) sh(`npm install --no-save --foreground-scripts -w desktop ${NDI_PKG}@${ndiVersion}`);
    dir = findNdi();
  }
  if (!built(dir)) {
    const why = [
      process.platform !== "darwin" ? "- this isn't a Mac (the Mac NDI add-on can only be built on a Mac)" : null,
      "- Apple's command-line developer tools are missing: run  xcode-select --install  then try again",
      "- the NDI SDK download (downloads.ndi.tv) was blocked or failed",
      "Scroll up for the error from the build.",
    ].filter(Boolean).join("\n  ");
    if (forDist) {
      console.error(`\n✗ NDI isn't built, so this app would say "NDI isn't included in this build".\n  Likely:\n  ${why}\n  (To build without NDI anyway: COOL_SKIP_NDI=1 npm run dist:mac)\n`);
      process.exit(1);
    }
    console.warn(`! NDI isn't built; the app will run without NDI.\n  ${why}`);
    return;
  }

  const outDir = path.join(out, "native", "grandiose");
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(path.join(dir, "dist"), outDir, { recursive: true });

  // The Mac app is universal (Apple silicon + Intel). npm builds the add-on for this Mac's
  // processor only, so build the other one too and join them (best effort).
  if (process.platform === "darwin") {
    const other = process.arch === "arm64" ? "x64" : "arm64";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grandiose-"));
    try {
      fs.cpSync(dir, tmp, { recursive: true, filter: (f) => !f.includes(`${path.sep}node_modules${path.sep}`) && !f.endsWith(`${path.sep}build`) });
      fs.rmSync(path.join(tmp, "build"), { recursive: true, force: true });
      if (sh(`npx --yes node-gyp rebuild --arch=${other}`, tmp)) {
        const node = path.join(outDir, "grandiose.node");
        execSync(`lipo -create "${node}" "${path.join(tmp, "build", "Release", "grandiose.node")}" -output "${node}.u" && mv "${node}.u" "${node}"`);
        console.log(`• NDI: add-on built for ${process.arch} + ${other}`);
      } else console.warn(`! NDI: couldn't build the add-on for ${other}; NDI will only work on ${process.arch === "arm64" ? "Apple silicon" : "Intel"} Macs.`);
    } catch (e) {
      console.warn(`! NDI: couldn't make a universal add-on (${e.message.split("\n")[0]}); NDI will only work on ${process.arch} Macs.`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  console.log(`• NDI: add-on copied into the app (${fs.readdirSync(outDir).join(", ")})`);
}
prepareNdi();

console.log("✓ app/ ready");
