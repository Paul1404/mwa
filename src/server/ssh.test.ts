import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { execStream } from "./ssh.server";

// Build a minimal stub that quacks like an ssh2 Client + ClientChannel for
// the parts execStream uses.
function makeClient(scripted: {
  stdout?: string[];
  stderr?: string[];
  exitCode?: number;
  signal?: string;
}) {
  const channel = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    close: () => void;
  };
  channel.stderr = new EventEmitter();
  channel.close = () => {};

  const exec = vi.fn((_cmd: string, cb: (err: Error | null, ch: typeof channel) => void) => {
    cb(null, channel);
    // schedule emissions on next tick so the iterator has time to wire up
    setImmediate(() => {
      for (const line of scripted.stdout ?? []) {
        channel.emit("data", Buffer.from(line, "utf8"));
      }
      for (const line of scripted.stderr ?? []) {
        channel.stderr.emit("data", Buffer.from(line, "utf8"));
      }
      channel.emit("close", scripted.exitCode ?? 0, scripted.signal ?? null);
    });
  });

  return { exec } as unknown as import("ssh2").Client;
}

describe("ssh.execStream", () => {
  it("yields one event per complete line and emits exit", async () => {
    const client = makeClient({
      stdout: ["hello\nworld\n", "trailing\n"],
      exitCode: 0,
    });
    const events: string[] = [];
    let exit: { code: number | null; signal: string | null } | null = null;
    for await (const ev of execStream(client, "fake")) {
      if (ev.type === "line") events.push(`${ev.stream}:${ev.line}`);
      else exit = { code: ev.code, signal: ev.signal };
    }
    expect(events).toEqual(["stdout:hello", "stdout:world", "stdout:trailing"]);
    expect(exit).toEqual({ code: 0, signal: null });
  });

  it("strips CRs and flushes a trailing partial line", async () => {
    const client = makeClient({
      stdout: ["a\r\nb"],
      exitCode: 0,
    });
    const lines: string[] = [];
    for await (const ev of execStream(client, "fake")) {
      if (ev.type === "line") lines.push(ev.line);
    }
    expect(lines).toEqual(["a", "b"]);
  });

  it("interleaves stderr separately from stdout", async () => {
    const client = makeClient({
      stdout: ["out1\n"],
      stderr: ["err1\n"],
      exitCode: 0,
    });
    const seen: Array<{ stream: string; line: string }> = [];
    for await (const ev of execStream(client, "fake")) {
      if (ev.type === "line") seen.push({ stream: ev.stream, line: ev.line });
    }
    expect(seen).toContainEqual({ stream: "stdout", line: "out1" });
    expect(seen).toContainEqual({ stream: "stderr", line: "err1" });
  });
});
