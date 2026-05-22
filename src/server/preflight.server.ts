import { eq } from "drizzle-orm";
import { decrypt } from "./crypto.server";
import { db, schema } from "./db";
import { connect, exec } from "./ssh.server";

export type PreflightCheck = {
  id: string;
  label: string;
  value: string;
  status: "ok" | "warn" | "fail" | "info";
  detail?: string;
};

export type PreflightReport = {
  host: string;
  hostFingerprint: string;
  checks: PreflightCheck[];
  raw: Record<string, string>;
};

const PREFLIGHT_SCRIPT = `
echo "hostname=$(hostname 2>/dev/null || echo unknown)"
echo "uname=$(uname -sr 2>/dev/null || echo unknown)"
echo "mailcow_path=$(test -d /opt/mailcow-dockerized && echo yes || echo no)"
echo "grafana_path=$(test -d /opt/mailcow-grafana && echo yes || echo no)"
echo "mailcow_rev=$(cd /opt/mailcow-dockerized 2>/dev/null && git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "mailcow_date=$(cd /opt/mailcow-dockerized 2>/dev/null && git log -1 --format=%cs 2>/dev/null || echo unknown)"
echo "disk_root=$(df -P / 2>/dev/null | awk 'NR==2 {print $4 "|" $5}' || echo 'unknown|unknown')"
echo "disk_docker=$(df -P /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4 "|" $5}' || echo 'unknown|unknown')"
echo "docker_version=$(docker info --format '{{.ServerVersion}}' 2>/dev/null || echo unknown)"
echo "containers=$(docker ps -q 2>/dev/null | wc -l)"
echo "updates_available=$(cd /opt/mailcow-dockerized 2>/dev/null && git fetch -q origin master 2>/dev/null && git rev-list --count HEAD..origin/master 2>/dev/null || echo unknown)"
`.trim();

function parseKv(stdout: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function parseDisk(value: string): { availableKb: number | null; usedPct: number | null } {
  const [availStr, usedStr] = value.split("|");
  const availableKb = availStr && /^\d+$/.test(availStr) ? Number(availStr) : null;
  const usedPctMatch = usedStr?.match(/(\d+)%/);
  const usedPct = usedPctMatch ? Number(usedPctMatch[1]) : null;
  return { availableKb, usedPct };
}

function formatBytes(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`;
  return `${kb} KB`;
}

function diskCheck(id: string, label: string, raw: string): PreflightCheck {
  const { availableKb, usedPct } = parseDisk(raw);
  if (availableKb === null) {
    return { id, label, value: "unavailable", status: "warn", detail: "could not read df output" };
  }
  const free = formatBytes(availableKb);
  const used = usedPct === null ? "?" : `${usedPct}%`;
  // Mailcow image pulls regularly need a few GB free. Warn under 5 GB, fail under 1 GB.
  if (availableKb < 1024 * 1024) {
    return {
      id,
      label,
      value: `${free} free (${used} used)`,
      status: "fail",
      detail: "less than 1 GB free, update will likely fail",
    };
  }
  if (availableKb < 5 * 1024 * 1024) {
    return {
      id,
      label,
      value: `${free} free (${used} used)`,
      status: "warn",
      detail: "less than 5 GB free, watch for pull failures",
    };
  }
  return { id, label, value: `${free} free (${used} used)`, status: "ok" };
}

function buildChecks(raw: Record<string, string>): PreflightCheck[] {
  const checks: PreflightCheck[] = [];

  checks.push({
    id: "host",
    label: "Host",
    value: raw.hostname ?? "unknown",
    status: "info",
    detail: raw.uname,
  });

  checks.push({
    id: "mailcow_path",
    label: "Mailcow installation",
    value: raw.mailcow_path === "yes" ? "/opt/mailcow-dockerized" : "not found",
    status: raw.mailcow_path === "yes" ? "ok" : "fail",
    detail: raw.mailcow_path === "yes" ? undefined : "the update step has nothing to update",
  });

  checks.push({
    id: "grafana_path",
    label: "Grafana stack",
    value: raw.grafana_path === "yes" ? "/opt/mailcow-grafana" : "not found",
    status: raw.grafana_path === "yes" ? "ok" : "fail",
    detail: raw.grafana_path === "yes" ? undefined : "the down/up steps will fail",
  });

  if (raw.mailcow_rev && raw.mailcow_rev !== "unknown") {
    checks.push({
      id: "mailcow_rev",
      label: "Current Mailcow revision",
      value: raw.mailcow_rev,
      status: "info",
      detail:
        raw.mailcow_date && raw.mailcow_date !== "unknown"
          ? `committed ${raw.mailcow_date}`
          : undefined,
    });
  }

  if (raw.updates_available && raw.updates_available !== "unknown") {
    const n = Number(raw.updates_available);
    checks.push({
      id: "updates_available",
      label: "Upstream commits available",
      value: Number.isFinite(n) ? `${n} commit${n === 1 ? "" : "s"} behind origin/master` : "?",
      status: Number.isFinite(n) && n > 0 ? "info" : "ok",
      detail:
        Number.isFinite(n) && n === 0
          ? "already at the latest tip, the run will be a no-op"
          : undefined,
    });
  }

  if (raw.disk_root) checks.push(diskCheck("disk_root", "Disk /", raw.disk_root));
  if (raw.disk_docker && raw.disk_docker !== "unknown|unknown") {
    checks.push(diskCheck("disk_docker", "Disk /var/lib/docker", raw.disk_docker));
  }

  if (raw.docker_version && raw.docker_version !== "unknown") {
    checks.push({
      id: "docker",
      label: "Docker engine",
      value: raw.docker_version,
      status: "ok",
      detail: raw.containers ? `${raw.containers} containers running` : undefined,
    });
  } else {
    checks.push({
      id: "docker",
      label: "Docker engine",
      value: "unreachable",
      status: "fail",
      detail: "docker daemon not responding or not installed",
    });
  }

  return checks;
}

export async function runPreflight(
  credentialId: string,
  signal?: AbortSignal,
): Promise<PreflightReport> {
  const cred = await db.query.sshCredentials.findFirst({
    where: eq(schema.sshCredentials.id, credentialId),
  });
  if (!cred) throw new Error("credential not found");

  const privateKey = decrypt(cred.privateKeyEnc);
  const passphrase = cred.passphraseEnc ? decrypt(cred.passphraseEnc) : undefined;

  const { client, hostFingerprint } = await connect(
    {
      host: cred.host,
      port: cred.port,
      username: cred.username,
      privateKey,
      passphrase,
      expectedHostFingerprint: cred.hostFingerprint,
    },
    signal,
  );

  try {
    // Capture host key TOFU during preflight so the user can verify it before
    // committing to a run.
    if (!cred.hostFingerprint) {
      await db
        .update(schema.sshCredentials)
        .set({ hostFingerprint, updatedAt: new Date() })
        .where(eq(schema.sshCredentials.id, cred.id));
    }

    const { stdout } = await exec(client, PREFLIGHT_SCRIPT, signal);
    const raw = parseKv(stdout);
    const checks = buildChecks(raw);
    return {
      host: `${cred.username}@${cred.host}:${cred.port}`,
      hostFingerprint,
      checks,
      raw,
    };
  } finally {
    try {
      client.end();
    } catch {
      // ignore
    }
  }
}
