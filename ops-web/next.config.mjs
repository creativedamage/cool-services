/**
 * The website: a static export (ops-web/out) of the Operations and AVL screens from ../web, talking
 * straight to Sundays' cloud (no Sundays server behind it).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  eslint: { ignoreDuringBuilds: true },
  images: { unoptimized: true },
  experimental: { externalDir: true },
  env: { NEXT_PUBLIC_OPS_STANDALONE: "1" },
  webpack(config) {
    // shared/*.ts import each other as "./types.js"; find the .ts.
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, ".js": [".ts", ".tsx", ".js"] };
    // ../web and ../shared resolve packages from here too.
    config.resolve.modules = [path.join(here, "node_modules"), path.join(here, "..", "node_modules"), "node_modules"];
    return config;
  },
};

export default nextConfig;
