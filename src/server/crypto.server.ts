import {
  type CipherGCM,
  createCipheriv,
  createDecipheriv,
  createHash,
  type DecipherGCM,
  randomBytes,
} from "node:crypto";

// AES-256-GCM. 32-byte key, 12-byte IV (NIST recommendation), 16-byte tag.
const ALGO = "aes-256-gcm" as const;
const IV_LEN = 12;
const KEY_LEN = 32;

/**
 * Thrown when an existing ciphertext can't be authenticated with the current
 * `ENCRYPTION_KEY`. Almost always means the key was rotated or lost between
 * encryption time and decryption time, so the only recovery is to re-enter
 * the underlying secret (re-key).
 */
export class CredentialDecryptError extends Error {
  readonly code = "CREDENTIAL_UNREADABLE" as const;
  constructor(cause?: unknown) {
    super(
      "stored secret can't be decrypted with the current ENCRYPTION_KEY. " +
        "re-enter the private key to re-encrypt it with the active key.",
    );
    this.name = "CredentialDecryptError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

function loadKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY env var is required. Generate with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly ${KEY_LEN} bytes (got ${key.length}). ` +
        "Re-generate it with crypto.randomBytes(32).toString('base64').",
    );
  }
  return key;
}

// Lazy so import-time doesn't crash dev sessions that don't have the key set.
let cached: Buffer | null = null;
function getKey() {
  if (!cached) cached = loadKey();
  return cached;
}

/** Encrypt a UTF-8 string. Output: `${ivB64}:${tagB64}:${cipherB64}`. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv) as CipherGCM;
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/**
 * Decrypt the format produced by `encrypt`. Throws `CredentialDecryptError`
 * if the payload was tampered with or was encrypted under a different key.
 */
export function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new CredentialDecryptError(
      new Error("encrypted payload is malformed (expected iv:tag:cipher)"),
    );
  }
  const [ivB64, tagB64, cipherB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const enc = Buffer.from(cipherB64, "base64");
  try {
    const decipher = createDecipheriv(ALGO, getKey(), iv) as DecipherGCM;
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString("utf8");
  } catch (err) {
    throw new CredentialDecryptError(err);
  }
}

/** True if the payload can be decrypted with the current ENCRYPTION_KEY. */
export function isDecryptable(payload: string): boolean {
  try {
    decrypt(payload);
    return true;
  } catch {
    return false;
  }
}

// Fixed plaintext written into the canary row. Value doesn't matter -- only
// whether the ciphertext round-trips successfully under the active key.
export const CANARY_PLAINTEXT = "mwa-encryption-canary-v1";
export const CANARY_KEY = "encryption_canary";

/**
 * Compute the OpenSSH-style SHA256 fingerprint of a public key (or matching
 * private key whose `ssh-keygen -y` form is the public key). We can't parse
 * every key format without bringing in a full key parser, so we fall back to
 * a generic hash of the key contents -- still useful for "did anyone change
 * this key?" detection in the UI without ever exposing the secret.
 */
export function fingerprintKey(privateKey: string): string {
  const trimmed = privateKey.trim();
  const hash = createHash("sha256").update(trimmed).digest("base64");
  // strip "=" padding the way ssh-keygen does
  return `SHA256:${hash.replace(/=+$/, "")}`;
}
