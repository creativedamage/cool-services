/**
 * Loads the NDI add-on (@stagetimerio/grandiose) for NDI output and the dashboard's NDI previews.
 *
 * The Mac build copies the compiled add-on (grandiose.node + the NDI library, libndi.dylib) into
 * the app itself at app/native/grandiose (see build.mjs), so it doesn't depend on how npm laid out
 * node_modules. When running from source it falls back to node_modules.
 */
import path from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
let cached: { lib: any; error?: string } | null = null;

export function loadGrandiose(): { lib: any; error?: string } {
  if (cached) return cached;
  const tries: string[] = [];
  // main.cjs lives in app/, so the bundled copy is app/native/grandiose.
  for (const p of [path.join(__dirname, "native", "grandiose", "index.js"), "@stagetimerio/grandiose"]) {
    try {
      cached = { lib: require(p) };
      return cached;
    } catch (e) {
      tries.push((e as Error).message.split("\n")[0]);
    }
  }
  const why = tries.find((t) => !/Cannot find module '.*native[\\/]grandiose/.test(t)) ?? tries[0];
  const arch = /incompatible architecture|wrong architecture|mach-o/i.test(why ?? "")
    ? ` This build's NDI add-on doesn't match this Mac's processor (${process.arch}).` : "";
  cached = { lib: null, error: `NDI isn’t included in this build.${arch} (${why})` };
  return cached;
}
