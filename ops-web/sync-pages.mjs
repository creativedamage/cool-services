// The website shows the same Operations and AVL screens as the Mac app (web/app/(app)/{ops,avl}).
// This writes a one-line page here for each of them, so a new screen there is on the website too.
// Runs before every build: node sync-pages.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, "..", "web", "app", "(app)");
const site = path.join(here, "app", "(site)");
const wanted = new Set();

for (const app of ["ops", "avl", "admin"]) {
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "page.tsx" || e.name === "layout.tsx") {
        const rel = path.relative(web, p).split(path.sep).join("/");
        const dest = path.join(site, rel);
        wanted.add(dest);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const body = `"use client";\nexport { default } from "@/app/(app)/${rel.replace(/\.tsx$/, "")}";\n`;
        if (!fs.existsSync(dest) || fs.readFileSync(dest, "utf8") !== body) fs.writeFileSync(dest, body);
      }
    }
  };
  walk(path.join(web, app));
  // Screens removed from the Mac app go from the website too.
  const prune = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { prune(p); if (!fs.readdirSync(p).length) fs.rmdirSync(p); }
      else if (!wanted.has(p)) fs.unlinkSync(p);
    }
  };
  prune(path.join(site, app));
}
console.log(`ops-web: ${wanted.size} screens`);
