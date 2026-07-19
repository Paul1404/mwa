import type { MtaDomainState, MtaProvider } from "./types";

type MailcowResponse = { type?: string; msg?: unknown; log?: unknown };

export type MailcowQuarantineItem = {
  id: string;
  queueId: string | null;
  sender: string;
  recipient: string;
  subject: string;
  score: number | null;
  rspamdAction: string | null;
  virus: boolean;
  notified: boolean;
  createdAt: string | null;
};

export type MailcowQuarantineDetails = MailcowQuarantineItem & {
  rawMessage: string;
  symbols: unknown;
  fuzzyHashes: unknown;
};

export type MailcowQuarantineAction = "release" | "learn_spam" | "delete";

class MailcowApiError extends Error {
  constructor(
    path: string,
    readonly status: number,
  ) {
    super(`mailcow API ${path} failed with HTTP ${status}`);
    this.name = "MailcowApiError";
  }
}

export type MailcowConfig = {
  apiUrl: string;
  apiKey: string;
  defaults?: {
    aliases?: number;
    mailboxes?: number;
    defquota?: number;
    maxquota?: number;
    quota?: number;
  };
};

export class MailcowProvider implements MtaProvider {
  private baseUrl: string;
  private apiKey: string;
  private defaults: Required<NonNullable<MailcowConfig["defaults"]>>;

  constructor(config: MailcowConfig) {
    // Operators commonly paste the API prefix shown in mailcow examples. Keep
    // the stored value forgiving because request paths already include /api/v1.
    this.baseUrl = config.apiUrl.replace(/\/+$/, "").replace(/\/api(?:\/v1)?$/i, "");
    this.apiKey = config.apiKey;
    this.defaults = {
      aliases: config.defaults?.aliases ?? 400,
      mailboxes: config.defaults?.mailboxes ?? 100,
      defquota: config.defaults?.defquota ?? 3072,
      maxquota: config.defaults?.maxquota ?? 10240,
      quota: config.defaults?.quota ?? 102400,
    };
  }

  async getDomain(domain: string): Promise<MtaDomainState> {
    let res: unknown;
    try {
      res = await this.request<unknown>(`/api/v1/get/domain/${encodeURIComponent(domain)}`);
    } catch (err) {
      if (err instanceof MailcowApiError && err.status === 404) {
        return { exists: false, domain, dkimSelectors: [] };
      }
      throw err;
    }
    const rows = Array.isArray(res) ? res : [res];
    const found = rows.some((r) => {
      return r && typeof r === "object" && (r as { domain_name?: unknown }).domain_name === domain;
    });
    const dkimSelectors = await this.getDkimSelectors(domain);
    return { exists: found, domain, dkimSelectors };
  }

  async ensureDomain(domain: string): Promise<MtaDomainState> {
    const current = await this.getDomain(domain);
    if (current.exists) return current;
    await this.request("/api/v1/add/domain", {
      method: "POST",
      body: {
        domain,
        active: "1",
        aliases: String(this.defaults.aliases),
        mailboxes: String(this.defaults.mailboxes),
        defquota: String(this.defaults.defquota),
        maxquota: String(this.defaults.maxquota),
        quota: String(this.defaults.quota),
        backupmx: "0",
        relay_all_recipients: "0",
        restart_sogo: "1",
      },
    });
    return this.getDomain(domain);
  }

  async deleteDkimSelector(domain: string, _selector: string): Promise<void> {
    await this.request("/api/v1/delete/dkim", {
      method: "POST",
      body: [domain],
    });
  }

  async listQuarantine(): Promise<MailcowQuarantineItem[]> {
    const data = await this.request<unknown>("/api/v1/get/quarantine/all");
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    return rows.map(normalizeQuarantineItem).filter((row) => row !== null);
  }

  async getQuarantineItem(id: string): Promise<MailcowQuarantineDetails | null> {
    let data: unknown;
    try {
      data = await this.request<unknown>(`/api/v1/get/quarantine/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err instanceof MailcowApiError && err.status === 404) return null;
      throw err;
    }
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    for (const raw of rows) {
      const item = normalizeQuarantineItem(raw);
      if (!item || item.id !== id || !raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      return {
        ...item,
        rawMessage: typeof row.msg === "string" ? row.msg : "",
        symbols: parseMaybeJson(row.symbols),
        fuzzyHashes: parseMaybeJson(row.fuzzy_hashes),
      };
    }
    return null;
  }

  async performQuarantineAction(action: MailcowQuarantineAction, ids: string[]): Promise<void> {
    if (action === "delete") {
      await this.request("/api/v1/delete/qitem", { method: "POST", body: ids });
      return;
    }
    await this.request("/api/v1/edit/qitem", {
      method: "POST",
      body: {
        items: ids,
        attr: { action: action === "learn_spam" ? "learnspam" : "release" },
      },
    });
  }

  private async getDkimSelectors(domain: string): Promise<string[]> {
    try {
      const res = await this.request<unknown>(`/api/v1/get/dkim/${encodeURIComponent(domain)}`);
      if (!res || typeof res !== "object") return [];
      const selector = (res as { dkim_selector?: unknown }).dkim_selector;
      return typeof selector === "string" && selector ? [selector] : [];
    } catch {
      return [];
    }
  }

  private async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!res.ok) throw new MailcowApiError(path, res.status);
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : ({} as T);
    assertMailcowSuccess(path, data);
    return data;
  }
}

function assertMailcowSuccess(path: string, data: unknown) {
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const type = (row as MailcowResponse).type;
    if (type === "danger" || type === "error") {
      throw new Error(
        `mailcow API ${path} returned ${type}: ${JSON.stringify((row as MailcowResponse).msg)}`,
      );
    }
  }
}

function normalizeQuarantineItem(raw: unknown): MailcowQuarantineItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = stringValue(row.id);
  if (!id || !/^\d+$/.test(id)) return null;
  return {
    id,
    queueId: nullableString(row.qid),
    sender: nullableString(row.sender) ?? "",
    recipient: nullableString(row.rcpt) ?? "",
    subject: nullableString(row.subject) ?? "",
    score: finiteNumber(row.score),
    rspamdAction: nullableString(row.action),
    virus: booleanValue(row.virus_flag),
    notified: booleanValue(row.notified),
    createdAt: timestampValue(row.created),
  };
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function nullableString(value: unknown): string | null {
  const text = stringValue(value);
  return text === null || text === "" ? null : text;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function timestampValue(value: unknown): string | null {
  const numeric = finiteNumber(value);
  if (numeric !== null) {
    const date = new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
