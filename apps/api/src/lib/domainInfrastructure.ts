import { resolveCname, resolveMx, resolveTxt } from "node:dns/promises";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { domainDnsState, type DomainDnsRecord, type ObservedDnsRecord } from "../db/domainDnsSchema.js";
import { domains } from "../db/schema.js";

const STALWART_USING = ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"];

type StalwartDomain = { id: string; name: string; dnsZoneFile?: string | null };
type ProviderSync = { stalwartDomainId: string | null; stalwartDnsZoneFile: string | null; resendDomainId: string | null; records: DomainDnsRecord[]; warnings: string[] };

function normalizedHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function normalizedValue(value: string): string {
  return value.trim().replace(/^"|"$/g, "").replace(/\s+/g, " ");
}

function managementUrl(): string {
  const url = new URL(config.stalwart.jmapUrl);
  return `${url.origin}/api`;
}

async function stalwartCall(methodCalls: unknown[]): Promise<any[]> {
  const response = await fetch(managementUrl(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.stalwart.adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ methodCalls, using: STALWART_USING }),
    signal: AbortSignal.timeout(12_000),
  });
  const result = await response.json().catch(() => ({})) as { methodResponses?: any[]; error?: string };
  if (!response.ok) throw new Error(`Stalwart domain request failed (${response.status})`);
  if (!Array.isArray(result.methodResponses)) throw new Error(result.error ?? "Stalwart domain response was incomplete");
  return result.methodResponses;
}

async function getStalwartDomain(id: string): Promise<StalwartDomain | null> {
  const responses = await stalwartCall([["x:Domain/get", { ids: [id], properties: ["id", "name", "dnsZoneFile"] }, "g1"]]);
  const payload = responses[0]?.[1] as { list?: StalwartDomain[] } | undefined;
  return payload?.list?.[0] ?? null;
}

export async function ensureStalwartDomain(name: string): Promise<StalwartDomain> {
  const responses = await stalwartCall([["x:Domain/query", { filter: { name } }, "q1"]]);
  const query = responses[0]?.[1] as { ids?: string[] } | undefined;
  const existingId = query?.ids?.[0];
  if (existingId) {
    const existing = await getStalwartDomain(existingId);
    if (existing) return existing;
  }

  const createdResponses = await stalwartCall([["x:Domain/set", {
    create: {
      gswDomain: {
        name,
        aliases: {},
        certificateManagement: { "@type": "Manual" },
        dkimManagement: { "@type": "Automatic" },
        dnsManagement: { "@type": "Manual" },
        subAddressing: { "@type": "Enabled" },
      },
    },
  }, "s1"]]);
  const setPayload = createdResponses[0]?.[1] as { created?: Record<string, { id?: string }>; notCreated?: Record<string, { description?: string }> } | undefined;
  const createdId = setPayload?.created?.gswDomain?.id;
  if (!createdId) throw new Error(setPayload?.notCreated?.gswDomain?.description ?? "Stalwart did not create the domain");
  const created = await getStalwartDomain(createdId);
  if (!created) throw new Error("Stalwart created the domain but did not return its DNS configuration");
  return created;
}

function absoluteRecordName(raw: string, origin: string): string {
  const value = raw.trim();
  if (value === "@") return origin;
  if (value.endsWith(".")) return normalizedHost(value);
  return normalizedHost(`${value}.${origin}`);
}

function recordPurpose(type: DomainDnsRecord["type"], name: string, value: string, source: DomainDnsRecord["source"]): DomainDnsRecord["purpose"] {
  const lowerName = name.toLowerCase();
  const lowerValue = value.toLowerCase();
  if (source === "resend" && type === "MX") return "spf";
  if (type === "MX") return "mx";
  if (lowerName.includes("_domainkey") || lowerValue.startsWith("v=dkim1")) return "dkim";
  if (lowerName.startsWith("_dmarc.") || lowerValue.startsWith("v=dmarc1")) return "dmarc";
  if (lowerValue.startsWith("v=spf1")) return "spf";
  return "other";
}

function isRequired(source: DomainDnsRecord["source"], purpose: DomainDnsRecord["purpose"]): boolean {
  if (purpose === "mx" || purpose === "dmarc") return true;
  if (source === "resend") return true;
  if (source === "stalwart" && (purpose === "spf" || purpose === "dkim")) return config.outbound.relay !== "resend";
  return false;
}

export function parseStalwartZoneFile(zoneFile: string | null | undefined, domain: string): DomainDnsRecord[] {
  if (!zoneFile) return [];
  let origin = normalizedHost(domain);
  const records: DomainDnsRecord[] = [];
  for (const rawLine of zoneFile.split(/\r?\n/)) {
    const line = rawLine.replace(/;.*/, "").trim();
    if (!line) continue;
    const originMatch = line.match(/^\$ORIGIN\s+(.+)$/i);
    if (originMatch) { origin = normalizedHost(originMatch[1]!); continue; }
    const match = line.match(/^(\S+)\s+(?:(\d+)\s+)?(?:IN\s+)?(MX|TXT|CNAME)\s+(.+)$/i);
    if (!match) continue;
    const [, host, , rawType, rawValue] = match;
    const type = rawType!.toUpperCase() as DomainDnsRecord["type"];
    const name = absoluteRecordName(host!, origin);
    let value = rawValue!.trim();
    let priority: number | undefined;
    if (type === "MX") {
      const mx = value.match(/^(\d+)\s+(.+)$/);
      if (!mx) continue;
      priority = Number(mx[1]);
      value = normalizedHost(mx[2]!);
    } else if (type === "TXT") {
      value = value.match(/"([^"]*)"/g)?.map((part) => part.slice(1, -1)).join("") ?? value.replace(/^"|"$/g, "");
    } else {
      value = normalizedHost(value);
    }
    const purpose = recordPurpose(type, name, value, "stalwart");
    records.push({ source: "stalwart", type, name, value, ...(priority !== undefined ? { priority } : {}), purpose, required: isRequired("stalwart", purpose) });
  }
  return records;
}

type ResendRecordShape = { record?: string; type?: string; name?: string; value?: string; priority?: number | string };
type ResendDomainShape = { id?: string; name?: string; status?: string; records?: ResendRecordShape[] };

async function resendRequest(path: string, init?: RequestInit): Promise<any> {
  if (!config.outbound.resendApiKey) throw new Error("Resend API key is not configured");
  const response = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: { authorization: `Bearer ${config.outbound.resendApiKey}`, "content-type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(12_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((result as { message?: string }).message ?? `Resend domain request failed (${response.status})`);
  return (result as { data?: unknown }).data ?? result;
}

async function ensureResendDomain(name: string): Promise<ResendDomainShape | null> {
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
    const priority = record.priority === undefined ? undefined : Number(record.priority);
    const purpose = recordPurpose(type, name, value, "resend");
    return [{ source: "resend", type, name, value, ...(Number.isFinite(priority) ? { priority } : {}), purpose, required: isRequired("resend", purpose) }];
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
  try { stalwart = await ensureStalwartDomain(name); } catch (error) { warnings.push(error instanceof Error ? error.message : "Stalwart domain sync failed"); }
  try { resend = await ensureResendDomain(name); } catch (error) { warnings.push(error instanceof Error ? error.message : "Resend domain sync failed"); }
  const records = uniqueRecords([...parseStalwartZoneFile(stalwart?.dnsZoneFile, name), ...resendRecords(resend)]);
  if (!stalwart) throw new Error(warnings.join(" · ") || "Stalwart domain sync failed");
  return { stalwartDomainId: stalwart.id, stalwartDnsZoneFile: stalwart.dnsZoneFile ?? null, resendDomainId: resend?.id ?? null, records, warnings };
}

async function observe(record: DomainDnsRecord): Promise<ObservedDnsRecord> {
  try {
    if (record.type === "MX") {
      const values = await resolveMx(record.name);
      const observed = values.map((item) => `${item.priority} ${normalizedHost(item.exchange)}`);
      const expected = `${record.priority ?? 0} ${normalizedHost(record.value)}`;
      return { ...record, matches: observed.some((value) => value === expected), observed };
    }
    if (record.type === "CNAME") {
      const observed = (await resolveCname(record.name)).map(normalizedHost);
      return { ...record, matches: observed.includes(normalizedHost(record.value)), observed };
    }
    const observed = (await resolveTxt(record.name)).map((parts) => normalizedValue(parts.join("")));
    return { ...record, matches: observed.includes(normalizedValue(record.value)), observed };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENODATA" || code === "ENOTFOUND" || code === "ESERVFAIL") return { ...record, matches: false, observed: [] };
    throw error;
  }
}

function statusFor(purpose: DomainDnsRecord["purpose"], records: ObservedDnsRecord[]): "not_configured" | "verifying" | "verified" | "failed" {
  const required = records.filter((record) => record.purpose === purpose && record.required);
  if (!required.length) return "not_configured";
  return required.every((record) => record.matches) ? "verified" : "verifying";
}

export async function provisionDomainInfrastructure(domainId: string, name: string) {
  const synced = await syncProviders(name);
  await db.insert(domainDnsState).values({
    domainId,
    stalwartDomainId: synced.stalwartDomainId,
    stalwartDnsZoneFile: synced.stalwartDnsZoneFile,
    resendDomainId: synced.resendDomainId,
    expectedRecords: synced.records,
    lastError: synced.warnings.length ? synced.warnings.join(" · ") : null,
  }).onConflictDoUpdate({
    target: domainDnsState.domainId,
    set: {
      stalwartDomainId: synced.stalwartDomainId,
      stalwartDnsZoneFile: synced.stalwartDnsZoneFile,
      resendDomainId: synced.resendDomainId,
      expectedRecords: synced.records,
      lastError: synced.warnings.length ? synced.warnings.join(" · ") : null,
      updatedAt: new Date(),
    },
  });
  return synced;
}

export async function verifyDomainInfrastructure(domainId: string, name: string) {
  let synced: ProviderSync;
  try {
    synced = await syncProviders(name);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Domain infrastructure sync failed";
    await db.insert(domainDnsState).values({ domainId, lastError: message }).onConflictDoUpdate({ target: domainDnsState.domainId, set: { lastError: message, lastCheckedAt: new Date(), updatedAt: new Date() } });
    await db.update(domains).set({ status: "failed" }).where(eq(domains.id, domainId));
    throw error;
  }

  const observed = await Promise.all(synced.records.map(observe));
  const mxStatus = statusFor("mx", observed);
  const spfStatus = statusFor("spf", observed);
  const dkimStatus = statusFor("dkim", observed);
  const dmarcStatus = statusFor("dmarc", observed);
  const required = observed.filter((record) => record.required);
  const healthy = required.length > 0 && required.every((record) => record.matches);
  const now = new Date();
  const lastError = synced.warnings.length ? synced.warnings.join(" · ") : null;

  await db.transaction(async (tx) => {
    await tx.insert(domainDnsState).values({
      domainId,
      stalwartDomainId: synced.stalwartDomainId,
      stalwartDnsZoneFile: synced.stalwartDnsZoneFile,
      resendDomainId: synced.resendDomainId,
      expectedRecords: synced.records,
      observedRecords: observed,
      lastCheckedAt: now,
      ...(healthy ? { lastHealthyAt: now } : {}),
      lastError,
    }).onConflictDoUpdate({
      target: domainDnsState.domainId,
      set: {
        stalwartDomainId: synced.stalwartDomainId,
        stalwartDnsZoneFile: synced.stalwartDnsZoneFile,
        resendDomainId: synced.resendDomainId,
        expectedRecords: synced.records,
        observedRecords: observed,
        lastCheckedAt: now,
        ...(healthy ? { lastHealthyAt: now } : {}),
        lastError,
        updatedAt: now,
      },
    });
    await tx.update(domains).set({ status: healthy ? "verified" : "pending", mxStatus, spfStatus, dkimStatus, dmarcStatus }).where(eq(domains.id, domainId));
  });

  return { healthy, mxStatus, spfStatus, dkimStatus, dmarcStatus, expectedRecords: synced.records, observedRecords: observed, lastCheckedAt: now, lastError };
}
