import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/**
 * AES-256-GCM. Output: base64(iv).base64(tag).base64(ciphertext)
 * The key comes from TOKEN_ENCRYPTION_KEY if set; otherwise it is generated once and
 * saved to <DATA_DIR>/secret.key, so no setup is needed.
 */
let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (cachedKey) return cachedKey;
  if (config.tokenKey) {
    cachedKey = Buffer.from(config.tokenKey, "base64");
  } else {
    const dir = path.resolve(process.cwd(), config.dataDir);
    const file = path.join(dir, "secret.key");
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
    }
    cachedKey = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  }
  if (cachedKey.length !== 32) throw new Error("Encryption key must be 32 bytes (base64)");
  return cachedKey;
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export const randomId = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
