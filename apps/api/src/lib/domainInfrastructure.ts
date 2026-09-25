import { config } from "../config.js";

export type DomainDnsRecord = {
  source: "stalwart" | "resend" | "required";
  type: "MX" | "TXT" | "CNAME";
  name: string;
  value: string;
  priority?: number;
  purpose: "mx" | "spf" | "dkim" | "dmarc" | "other";
  required: boolean;
};

export type DomainInfrastructureStatus = {
  domain: string;
  stalwart: {
    configured: boolean;
    exists: boolean;
    id: string | null;
  };
  resend: {
    configured: boolean;
    exists: boolean;
    id: string | null;
    status: string | null;
  };
  dns: {
    records: DomainDnsRecord[];
  };
  warnings: string[];
};

type StalwartDomain = { id?: string | number; name?: string; domainName?: string };
type ResendRecordShape = { type?: string; record?: string; name?: string; value?: string; priority?: number | string };
type ResendDomainShape = { id?: string; name?: string; status?: string; records?: ResendRecordShape[] };
type ProviderSync = { stalwart: StalwartDomain | null; resend: ResendDomainShape | null; warnings: string[] };

function normalizedHost(value: string): string {
  return value.trim().replace(/\.$/, "").toLowerCase();
}

function normalizedValue(value: string): string {
  return value.trim().replace(/^"|"$/g, "");
}

function recordPurpose(type: DomainDnsRecord["type"], name: string, value: string, source: DomainDnsRecord["source"]): DomainDnsRecord["purpose"] {
  if (type === "MX") return "mx";
  const haystack = `${name} ${value}`.toLowerCase();
  if (haystack.includes("v=spf1")) return "spf";
  if (haystack.includes("_dmarc") || haystack.includes("v=dmarc1")) return "dmarc";
  if (haystack.includes("._domainkey") || haystack.includes("domainkey")) return "dkim";
  if (source === "resend" && (type === "TXT" || type === "CNAME")) return "dkim";
  return "other";
}

function isRequired(source: DomainDnsRecord["source"], purpose: DomainDnsRecord["purpose"]): boolean {
  if (source === "required") return true;
  return ["mx", "spf", "dkim", "dmarc"].includes(purpose);
}

function requiredRecords(domain: string): DomainDnsRecord[] {
  return [
    { source: "required", type: "MX", name: domain, value: "mx1.guidedstepswellness.com", priority: 10, purpose: "mx", required: true },
    { source: "required", type: "TXT", name: domain, value: "v=spf1 include:amazonses.com ~all", purpose: "spf", required: true },
    { source: "required", type: "TXT", name: `_dmarc.${domain}`, value: "v=DMARC1; p=none;", purpose: "dmarc", required: true },
  ];
}

async function stalwartRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${config.stalwart.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`admin:${config.stalwart.adminToken}`).toString("base64")}`,
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Stalwart admin request failed: ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

async function resendRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.outbound.resendApiKey}`,
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Resend request failed: ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

async function ensureStalwartDomain(name: string): Promise<StalwartDomain | null> {
  if (!config.stalwart.adminToken) return null;
  const listed = await stalwartRequest("/api/principal?types=domain&limit=100") as { items?: StalwartDomain[] } | StalwartDomain[];
  const list = Array.isArray(listed) ? listed : listed.items ?? [];
  let domain = list.find((item) => (item.name ?? item.domainName)?.toLowerCase() === name.toLowerCase());
  if (domain) return domain;
  await stalwartRequest("/api/principal", { method: "POST", body: JSON.stringify({ type: "domain", name }) });
  const refreshed = await stalwartRequest("/api/principal?types=domain&limit=100") as { items?: StalwartDomain[] } | StalwartDomain[];
  const refreshedList = Array.isArray(refreshed) ? refreshed : refreshed.items ?? [];
  return refreshedList.find((item) => (item.name ?? item.domainName)?.toLowerCase() === name.toLowerCase()) ?? { name };
}

async function ensureResendDomain(name: string): Promise<ResendDomainShape | null> {
  if (!config.outbound.resendApiKey) return null;
  if (config.outbound.relay !== "resend") return null;
  const listed = await resendRequest("/domains?limit=100") as { data?: ResendDomainShape[] } | ResendDomainShape[];
  const list = Array.isArray(listed) ? listed : listed.data ?? [];
  let domain = list.find((item) => item.name?.toLowerCase() === name.toLowerCase());
  if (!domain?.id) domain = await resendRequest("/domains", { method: "POST", body: JSON.stringify({ name }) }) as ResendDomainShape;
  if (!domain?.id) throw new Error("Resend did not return a domain id");
  return await resendRequest(`/domains/${domain.id}`) as ResendDomainShape;
}

function resendRecords(domain: ResendDomainShape | null): DomainDnsRecord[] {
  return (domain?.records ?? []).flatMap((record): DomainDnsRecord[] => {
    const rawType = (record.type ?? record.record ?? "").toUpperCase();
    if (rawType !== "MX" && rawType !== "TXT" && rawType !== "CNAME") return [];
    if (!record.name || !record.value) return [];
    const type = rawType as DomainDnsRecord["type"];
    const name = normalizedHost(record.name);
    const value = type === "TXT" ? normalizedValue(record.value) : normalizedHost(record.value);
    const numericPriority = record.priority === undefined ? undefined : Number(record.priority);
    const priority = numericPriority !== undefined && Number.isFinite(numericPriority) ? numericPriority : undefined;
    const purpose = recordPurpose(type, name, value, "resend");
    return [{ source: "resend", type, name, value, ...(priority !== undefined ? { priority } : {}), purpose, required: isRequired("resend", purpose) }];
  });
}

function uniqueRecords(records: DomainDnsRecord[]): DomainDnsRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = `${record.source}|${record.type}|${record.name}|${record.priority ?? ""}|${record.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function syncProviders(name: string): Promise<ProviderSync> {
  const warnings: string[] = [];
  let stalwart: StalwartDomain | null = null;
  let resend: ResendDomainShape | null = null;
  try { stalwart = await ensureStalwartDomain(name); } catch (error) { warnings.push(error instanceof Error ? error.message : String(error)); }
  try { resend = await ensureResendDomain(name); } catch (error) { warnings.push(error instanceof Error ? error.message : String(error)); }
  return { stalwart, resend, warnings };
}

export async function ensureDomainInfrastructure(name: string): Promise<DomainInfrastructureStatus> {
  const domain = normalizedHost(name);
  const { stalwart, resend, warnings } = await syncProviders(domain);
  return {
    domain,
    stalwart: { configured: Boolean(config.stalwart.adminToken), exists: Boolean(stalwart), id: stalwart?.id == null ? null : String(stalwart.id) },
    resend: { configured: Boolean(config.outbound.resendApiKey && config.outbound.relay === "resend"), exists: Boolean(resend), id: resend?.id ?? null, status: resend?.status ?? null },
    dns: { records: uniqueRecords([...requiredRecords(domain), ...resendRecords(resend)]) },
    warnings,
  };
}
