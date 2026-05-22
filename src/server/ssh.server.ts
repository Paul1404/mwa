import { createHash } from "node:crypto";
import type { ClientChannel, ConnectConfig } from "ssh2";
import { Client } from "ssh2";

export type SshTarget = {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  passphrase?: string;
  /**
   * Pinned SHA-256 host fingerprint (OpenSSH-style: "SHA256:<base64>"). When
   * present, the connection is rejected if the server's key hashes to anything
   * else. When absent, the first connect captures the fingerprint and the
   * caller is expected to persist it via the returned `hostFingerprint`.
   */
  expectedHostFingerprint?: string | null;
};

/** Compute the OpenSSH-style SHA-256 fingerprint of a raw host key. */
export function opensshFingerprint(key: Buffer): string {
  const hash = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
  return `SHA256:${hash}`;
}

export class HostKeyMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`host key mismatch: expected ${expected}, got ${actual}`);
    this.name = "HostKeyMismatchError";
  }
}

export type StreamKind = "stdout" | "stderr";

export type CommandEvent =
  | { type: "line"; stream: StreamKind; line: string }
  | { type: "exit"; code: number | null; signal: string | null };

/**
 * Run a single shell command on the remote server and yield events as they
 * arrive. Output is line-buffered: partial lines are held until a newline
 * lands so the terminal in the browser never shows half lines.
 *
 * `signal` is honored: aborting closes the channel and rejects the iterator.
 */
export async function* execStream(
  client: Client,
  command: string,
  signal?: AbortSignal,
): AsyncGenerator<CommandEvent, void, void> {
  const queue: CommandEvent[] = [];
  let done = false;
  let error: unknown = null;
  let resolve: (() => void) | null = null;

  const wake = () => {
    if (resolve) {
      const r = resolve;
      resolve = null;
      r();
    }
  };

  const onAbort = () => {
    error = new Error("aborted");
    done = true;
    wake();
  };
  if (signal) {
    if (signal.aborted) {
      throw new Error("aborted");
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  const stream: ClientChannel = await new Promise((res, rej) => {
    client.exec(command, (err, ch) => {
      if (err) rej(err);
      else res(ch);
    });
  });

  // Buffer partial lines per stream until a newline arrives.
  const buffers: Record<StreamKind, string> = { stdout: "", stderr: "" };
  const flushPartial = (kind: StreamKind) => {
    if (buffers[kind].length > 0) {
      queue.push({ type: "line", stream: kind, line: buffers[kind] });
      buffers[kind] = "";
      wake();
    }
  };

  const onChunk = (kind: StreamKind, chunk: Buffer) => {
    buffers[kind] += chunk.toString("utf8");
    let idx = buffers[kind].indexOf("\n");
    while (idx !== -1) {
      const raw = buffers[kind].slice(0, idx);
      // Strip trailing CR from CRLF.
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      queue.push({ type: "line", stream: kind, line });
      buffers[kind] = buffers[kind].slice(idx + 1);
      idx = buffers[kind].indexOf("\n");
    }
    wake();
  };

  stream.on("data", (c: Buffer) => onChunk("stdout", c));
  stream.stderr.on("data", (c: Buffer) => onChunk("stderr", c));
  stream.on("close", (code: number | null, sig: string | null) => {
    flushPartial("stdout");
    flushPartial("stderr");
    queue.push({ type: "exit", code: code ?? null, signal: sig ?? null });
    done = true;
    wake();
  });
  stream.on("error", (e: Error) => {
    error = e;
    done = true;
    wake();
  });

  try {
    while (true) {
      if (queue.length > 0) {
        const next = queue.shift();
        if (next) yield next;
        if (next?.type === "exit") return;
        continue;
      }
      if (done) {
        if (error) throw error;
        return;
      }
      await new Promise<void>((r) => {
        resolve = r;
      });
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    try {
      stream.close();
    } catch {
      // already closed
    }
  }
}

export type ConnectResult = {
  client: Client;
  /** The SHA-256 host fingerprint observed during the handshake. */
  hostFingerprint: string;
};

/**
 * Open an SSH connection. Verifies the server's host key against
 * `target.expectedHostFingerprint` when one is pinned; otherwise captures the
 * fingerprint TOFU and returns it so the caller can persist the pin.
 * Caller is responsible for `client.end()`.
 */
export function connect(target: SshTarget, signal?: AbortSignal): Promise<ConnectResult> {
  return new Promise((res, rej) => {
    const client = new Client();
    let observedFingerprint: string | null = null;
    let mismatch: HostKeyMismatchError | null = null;

    const config: ConnectConfig = {
      host: target.host,
      port: target.port,
      username: target.username,
      privateKey: target.privateKey,
      readyTimeout: 20_000,
      keepaliveInterval: 15_000,
      hostVerifier: (key: Buffer) => {
        const fp = opensshFingerprint(key);
        observedFingerprint = fp;
        if (target.expectedHostFingerprint && target.expectedHostFingerprint !== fp) {
          mismatch = new HostKeyMismatchError(target.expectedHostFingerprint, fp);
          return false;
        }
        return true;
      },
    };
    if (target.passphrase) config.passphrase = target.passphrase;
    const onAbort = () => {
      try {
        client.end();
      } catch {
        // ignore
      }
      rej(new Error("aborted"));
    };
    if (signal) {
      if (signal.aborted) return rej(new Error("aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
    }
    client.on("ready", () => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (!observedFingerprint) {
        rej(new Error("host key was not captured during handshake"));
        return;
      }
      res({ client, hostFingerprint: observedFingerprint });
    });
    client.on("error", (err: Error) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      // hostVerifier returning false surfaces as a generic auth error; replace
      // it with the more specific HostKeyMismatchError so callers can react.
      rej(mismatch ?? err);
    });
    client.connect(config);
  });
}
