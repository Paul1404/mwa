import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

describe("crypto", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("encrypts and decrypts plaintext round-trip", async () => {
    const { encrypt, decrypt } = await import("./crypto.server");
    const plain =
      "-----BEGIN OPENSSH PRIVATE KEY-----\nfoo\nbar\nbaz\n-----END OPENSSH PRIVATE KEY-----";
    const enc = encrypt(plain);
    expect(enc).not.toContain(plain);
    expect(enc.split(":")).toHaveLength(3);
    const dec = decrypt(enc);
    expect(dec).toBe(plain);
  });

  it("yields different ciphertexts for the same plaintext", async () => {
    const { encrypt } = await import("./crypto.server");
    const plain = "same input";
    const a = encrypt(plain);
    const b = encrypt(plain);
    expect(a).not.toBe(b);
  });

  it("rejects tampered payloads via GCM tag", async () => {
    const { encrypt, decrypt } = await import("./crypto.server");
    const enc = encrypt("hello");
    const [iv, tag, cipher] = enc.split(":");
    // Flip a bit in the ciphertext.
    const cipherBuf = Buffer.from(cipher!, "base64");
    cipherBuf[0] = cipherBuf[0]! ^ 1;
    const tampered = `${iv}:${tag}:${cipherBuf.toString("base64")}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it("fingerprintKey is stable and prefixed", async () => {
    const { fingerprintKey } = await import("./crypto.server");
    const fp1 = fingerprintKey("abc");
    const fp2 = fingerprintKey("abc");
    expect(fp1).toBe(fp2);
    expect(fp1.startsWith("SHA256:")).toBe(true);
  });
});
