// Builds everything the Mac app needs into desktop/app/:
//   web/out (static UI)  →  app/web
//   server (API)         →  app/server.cjs   (one bundled file, no node_modules)
//   src/main.ts          →  app/main.cjs
import { execSync } from "node:child_process";
import fs from "node:fs";
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
  external: ["electron", "./server.cjs"],
  logLevel: "warning",
});

console.log("✓ app/ ready");
