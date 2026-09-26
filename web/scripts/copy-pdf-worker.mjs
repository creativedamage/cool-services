// Copies PDF.js's worker next to the app's pages so PDFs can be read offline inside the Mac app.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const src = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "build", "pdf.worker.min.mjs");
fs.copyFileSync(src, new URL("../public/pdf.worker.min.js", import.meta.url));
