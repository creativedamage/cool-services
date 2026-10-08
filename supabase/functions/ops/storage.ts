/**
 * Job files in Supabase Storage (private bucket "job-files"), through Storage's REST API with the
 * function's service key. Browsers never get the key: they upload to a one-time signed link and
 * read through short-lived signed links.
 *
 * Paths: <org id>/<job id>/<file id>/<file name>.
 */
import { env, HttpError } from "./db.ts";

export const BUCKET = "job-files";
const base = () => {
  const u = env("OPS_STORAGE_URL") ?? env("SUPABASE_URL");
  if (!u) throw new HttpError(503, "File storage isn't set up.");
  return `${u.replace(/\/+$/, "")}/storage/v1`;
};
const key = () => env("SUPABASE_SERVICE_ROLE_KEY") ?? env("OPS_STORAGE_KEY") ?? "";
const headers = (extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${key()}`, apikey: key(), ...extra });
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(`${base()}${path}`, { method, headers: headers(body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    console.error("storage", method, path, r.status, text.slice(0, 300));
    throw new HttpError(502, "File storage didn't answer. Try again in a moment.");
  }
  return r.headers.get("content-type")?.includes("json") ? r.json() : null;
}

/** A file name that's safe in a path (keeps the extension). */
export const safeName = (n: string) => n.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").replace(/^[.-]+/, "").slice(-120) || "file";

/** A link the browser PUTs the file to (good for two hours, once). */
export async function uploadLink(path: string): Promise<string> {
  const out = await call("POST", `/object/upload/sign/${BUCKET}/${enc(path)}`) as { url: string };
  return `${base()}${out.url.startsWith("/") ? "" : "/"}${out.url}`;
}

/** Is the file there, and how big? */
export async function stat(path: string): Promise<{ size: number; mime: string | null } | null> {
  const r = await fetch(`${base()}/object/${BUCKET}/${enc(path)}`, { method: "HEAD", headers: headers() });
  if (r.status === 404 || r.status === 400) return null;
  if (!r.ok) throw new HttpError(502, "File storage didn't answer. Try again in a moment.");
  return { size: Number(r.headers.get("content-length") ?? 0), mime: r.headers.get("content-type") };
}

/** Short-lived links to read files (one call for many). With `download`, the browser saves it under its name. */
export async function readLinks(files: { path: string; name: string }[], seconds = 3600): Promise<Map<string, { url: string; downloadUrl: string }>> {
  const out = new Map<string, { url: string; downloadUrl: string }>();
  if (!files.length) return out;
  const rows = await call("POST", `/object/sign/${BUCKET}`, { expiresIn: seconds, paths: files.map((f) => f.path) }) as { path: string; signedURL: string | null; error?: string | null }[];
  const names = new Map(files.map((f) => [f.path, f.name]));
  for (const r of rows ?? []) {
    if (!r.signedURL) continue;
    const url = `${base()}${r.signedURL.startsWith("/") ? "" : "/"}${r.signedURL}`;
    out.set(r.path, { url, downloadUrl: `${url}&download=${encodeURIComponent(names.get(r.path) ?? "file")}` });
  }
  return out;
}

export async function removeFiles(paths: string[]) {
  if (!paths.length) return;
  await call("DELETE", `/object/${BUCKET}`, { prefixes: paths });
}

/** Can the function reach Storage with its key, and is the bucket there? (For the health check.) */
export async function storageOk(): Promise<boolean> {
  try {
    const r = await fetch(`${base()}/bucket/${BUCKET}`, { headers: headers() });
    return r.ok;
  } catch { return false; }
}
