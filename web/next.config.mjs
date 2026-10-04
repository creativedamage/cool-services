/**
 * Two modes:
 *  - `npm run dev` (browser development): Next dev server on :5173, /api proxied to the API on :4000.
 *  - `NEXT_EXPORT=1 next build` (Mac app): a static export in web/out that the app's own server
 *    serves from 127.0.0.1 alongside the API, so no Next server runs inside the app.
 */
const isExport = process.env.NEXT_EXPORT === "1";
const API = process.env.API_ORIGIN ?? "http://localhost:4000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  images: { unoptimized: true },
  // shared/*.ts import each other as "./types.js" (the server runs them as ES modules); find the .ts.
  webpack(config) {
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
  ...(isExport
    ? { output: "export" }
    : { async rewrites() { return [{ source: "/api/:path*", destination: `${API}/api/:path*` }]; } }),
};

export default nextConfig;
