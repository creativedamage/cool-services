// Micboard inside the Mac app (see build.mjs). Everything below goes in desktop/micboard-runtime,
// which the app carries as Contents/Resources/micboard.
//
// The Micboard code lives unchanged in vendor/micboard (creativedamage/micboard, added with
// `git subtree`; update it with `npm run micboard:update`). Nothing in it is edited. To run it inside
// Sundays this adds, in the runtime folder:
//
//   micboard/        Micboard's server (py/), its built web page (static/ after `npm run build`),
//                    demo.html, democonfig.json, dcid.json, package.json (what its own
//                    py/micboard.spec ships)
//   micboard-site/   Micboard's Python requirements (py/requirements.txt: Tornado), pip-installed
//   micboard-run.py  Sundays' launcher: stops Micboard if Sundays goes away, then runs
//                    py/micboard.py exactly as `python py/micboard.py` would
//   python/          A self-contained Python (python-build-standalone, pinned below). On a Mac it's
//                    made universal (Apple silicon + Intel) with lipo, like the rest of the app.
//
// COOL_SKIP_MICBOARD=1 builds without it.
import { execFileSync, execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** python-build-standalone (https://github.com/astral-sh/python-build-standalone), pinned. */
const PBS = {
  tag: "20241016",
  version: "3.12.7",
  sha256: {
    "aarch64-apple-darwin": "95dd397e3aef4cc1846867cf20be704bdd74edd16ea8032caf01e48f0c53d65d",
    "x86_64-apple-darwin": "848405b92bda20fad1f9bba99234c7d3f11e0b31e46f89835d1cb3d735e932aa",
    "x86_64-unknown-linux-gnu": "3a4d53a7ba3916c0c1f35cbbe57068e2571b138389f29cf5c35367fec8f4c617",
  },
};
const pbsUrl = (t) => `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS.tag}/cpython-${PBS.version}+${PBS.tag}-${t}-install_only_stripped.tar.gz`;

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Every file under dir (relative paths), leaving out the folders named in skip. */
function walk(dir, skip = new Set(), base = dir, outList = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, skip, base, outList);
    else outList.push(path.relative(base, p));
  }
  return outList.sort();
}

/* ── Micboard's web page, built with its own npm scripts in a copy (vendor/micboard stays untouched) ── */
function buildMicboardWeb(src, cacheDir) {
  const files = walk(src, new Set(["node_modules", ".git"]));
  const h = crypto.createHash("sha256");
  for (const f of files) h.update(f).update(fs.readFileSync(path.join(src, f)));
  const key = h.digest("hex").slice(0, 16);
  const stage = path.join(cacheDir, "micboard", key);
  if (fs.existsSync(path.join(stage, ".built"))) { console.log(`  using the Micboard build in ${stage}`); return stage; }
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(stage, f)), { recursive: true }); fs.copyFileSync(path.join(src, f), path.join(stage, f)); }
  console.log("  npm ci (Micboard’s own dependencies, in a copy)…");
  // Its package.json also lists Electron for its own desktop wrapper; Sundays doesn't use it.
  const env = { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: "1", npm_config_audit: "false", npm_config_fund: "false" };
  execSync("npm ci --ignore-scripts --no-audit --no-fund", { cwd: stage, stdio: "inherit", env });
  console.log("  npm run build (Micboard’s webpack build)…");
  execSync("npm run build", { cwd: stage, stdio: "inherit", env });
  fs.writeFileSync(path.join(stage, ".built"), new Date().toISOString());
  return stage;
}

/* ── Python ── */
async function download(url, file, sum) {
  if (fs.existsSync(file) && sha256(file) === sum) return file;
  console.log(`  downloading ${path.basename(file)} (once)…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn’t download ${url}: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const got = sha256(file);
  if (got !== sum) { fs.rmSync(file); throw new Error(`Checksum didn’t match for ${path.basename(file)} (got ${got})`); }
  return file;
}

/** The untouched Python for one platform, extracted once into the cache. */
async function pythonTree(target, cacheDir) {
  const dir = path.join(cacheDir, "python", `${PBS.version}-${PBS.tag}-${target}`);
  if (fs.existsSync(path.join(dir, "python", "bin", "python3.12"))) return path.join(dir, "python");
  const tgz = await download(pbsUrl(target), path.join(cacheDir, "python", `${target}.tar.gz`), PBS.sha256[target]);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["-xzf", tgz, "-C", dir]);
  return path.join(dir, "python");
}

/** Leave out what Micboard never uses (Tk, IDLE, tests, headers, pip…) and the symlinks (aliases). */
function trimPython(dir) {
  const rm = (p) => fs.rmSync(path.join(dir, p), { recursive: true, force: true });
  for (const p of ["include", "share", "lib/pkgconfig", "lib/python3.12/site-packages"]) rm(p);
  for (const e of fs.readdirSync(path.join(dir, "lib"))) if (/^(tcl|tk|Tix|itcl|thread|libtcl|libtk)/i.test(e)) rm(path.join("lib", e));
  for (const p of ["idlelib", "tkinter", "turtledemo", "turtle.py", "ensurepip", "lib2to3", "pydoc_data", "test", "venv"]) rm(path.join("lib/python3.12", p));
  for (const e of fs.readdirSync(path.join(dir, "lib/python3.12"))) if (e.startsWith("config-3.12")) rm(path.join("lib/python3.12", e));
  const dyn = path.join(dir, "lib/python3.12/lib-dynload");
  if (fs.existsSync(dyn)) for (const e of fs.readdirSync(dyn)) if (e.startsWith("_tkinter")) rm(path.join("lib/python3.12/lib-dynload", e));
  for (const e of fs.readdirSync(path.join(dir, "bin"))) if (e !== "python3.12") rm(path.join("bin", e));
  // No symlinks inside the app bundle. They're only aliases (python3 → python3.12, libpython3.so…);
  // the real files stay.
  for (const f of walk(dir)) if (fs.lstatSync(path.join(dir, f)).isSymbolicLink()) fs.rmSync(path.join(dir, f));
}

const isMachO = (p) => {
  const b = Buffer.alloc(4);
  const fd = fs.openSync(p, "r");
  try { fs.readSync(fd, b, 0, 4, 0); } finally { fs.closeSync(fd); }
  const m = b.readUInt32BE(0);
  return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(m);
};

async function addPython(native, cacheDir) {
  const dest = path.join(native, "python");
  if (process.platform === "darwin") {
    const arm = await pythonTree("aarch64-apple-darwin", cacheDir);
    const x64 = await pythonTree("x86_64-apple-darwin", cacheDir);
    fs.cpSync(arm, dest, { recursive: true, verbatimSymlinks: true });
    trimPython(dest);
    // Universal: every Mach-O file gets the Intel slice too.
    let n = 0;
    for (const f of walk(dest)) {
      const a = path.join(dest, f), x = path.join(x64, f);
      if (fs.existsSync(x) && isMachO(a)) { execFileSync("lipo", ["-create", a, fs.realpathSync(x), "-output", a]); n++; }
    }
    console.log(`  Python ${PBS.version}, universal (${n} files with both slices)`);
    return { host: process.arch === "arm64" ? arm : x64, platforms: ["macosx_10_13_universal2"] };
  }
  if (process.platform === "linux" && process.arch === "x64") { // for testing the server on Linux
    const lin = await pythonTree("x86_64-unknown-linux-gnu", cacheDir);
    fs.cpSync(lin, dest, { recursive: true, verbatimSymlinks: true });
    trimPython(dest);
    console.log(`  Python ${PBS.version} (Linux, for testing)`);
    return { host: lin, platforms: ["manylinux2014_x86_64", "manylinux_2_17_x86_64"] };
  }
  throw new Error(`No Python for ${process.platform}/${process.arch}`);
}

/** The Micboard launcher: Sundays' own file, next to (not inside) Micboard's code. */
const RUNNER = `# Sundays runs Micboard with this. Micboard itself (micboard/py) is unchanged.
# It stops Micboard when Sundays closes (its stdin closes), then runs py/micboard.py
# exactly as "python py/micboard.py <args>" would.
import os, runpy, sys, threading

here = os.path.dirname(os.path.abspath(__file__))
script = os.path.join(here, "micboard", "py", "micboard.py")

def watch_parent():
    try:
        while sys.stdin.buffer.read(1024):
            pass
    except Exception:
        pass
    os._exit(0)

threading.Thread(target=watch_parent, name="sundays-watch", daemon=True).start()
sys.path.insert(0, os.path.dirname(script))
sys.argv = [script] + sys.argv[1:]
runpy.run_path(script, run_name="__main__")
`;

export async function addMicboard({ root, native, cacheDir }) {
  const src = path.join(root, "vendor", "micboard");
  if (!fs.existsSync(path.join(src, "py", "micboard.py"))) throw new Error("vendor/micboard is missing (git subtree of creativedamage/micboard)");
  const built = buildMicboardWeb(src, cacheDir);

  // What Micboard's own py/micboard.spec ships, plus its Python source.
  const dest = path.join(native, "micboard");
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(path.join(built, "py"), path.join(dest, "py"), { recursive: true, filter: (p) => !p.includes("__pycache__") && !p.endsWith(".pyc") });
  fs.cpSync(path.join(built, "static"), path.join(dest, "static"), { recursive: true });
  for (const f of ["demo.html", "index.html", "democonfig.json", "dcid.json", "package.json", "LICENSE", "README.md", "CHANGELOG.md"]) {
    if (fs.existsSync(path.join(built, f))) fs.copyFileSync(path.join(built, f), path.join(dest, f));
  }
  fs.writeFileSync(path.join(native, "micboard-run.py"), RUNNER);

  const py = await addPython(native, cacheDir);
  console.log("  installing Micboard’s Python requirements (py/requirements.txt)…");
  const site = path.join(native, "micboard-site");
  fs.mkdirSync(site, { recursive: true });
  execFileSync(path.join(py.host, "bin", "python3.12"), [
    "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--root-user-action=ignore", "--no-compile", "--target", site,
    ...py.platforms.flatMap((p) => ["--platform", p]), "--only-binary=:all:", "--python-version", "3.12", "--implementation", "cp",
    "-r", path.join(built, "py", "requirements.txt"),
  ], { stdio: "inherit", env: { ...process.env, PIP_NO_CACHE_DIR: "1" } });
  for (const f of walk(site)) if (f.includes("__pycache__")) fs.rmSync(path.join(site, f), { force: true });
  const version = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8")).version;
  console.log(`  Micboard ${version} ready`);
}
