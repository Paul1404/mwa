import type { MtaDomainState, MtaProvider } from "./types";

type MailcowResponse = { type?: string; msg?: unknown; log?: unknown };

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
    this.baseUrl = config.apiUrl.replace(/\/$/, "");
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
    const res = await this.request<unknown>(`/api/v1/get/domain/${encodeURIComponent(domain)}`);
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
    if (!res.ok) throw new Error(`mailcow API ${path} failed with HTTP ${res.status}`);
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
