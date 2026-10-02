import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { domainDnsState } from "../db/domainDnsSchema.js";
import { emailAccounts } from "../db/schema.js";

 type JmapResponse = [string, Record<string, unknown>, string | null];
 type StalwartAccount = { id?: string; name?: string; domainId?: string };

function adminAuthorization(): string {
  if (config.stalwart.adminUsername && config.stalwart.adminPassword) {
    return `Basic ${Buffer.from(`${config.stalwart.adminUsername}:${config.stalwart.adminPassword}`, "utf8").toString("base64")}`;
  }
  if (config.stalwart.adminToken) return `Bearer ${config.stalwart.adminToken}`;
  throw new Error("Stalwart admin credentials are not configured");
}

function absoluteUrl(base: string, value: string): string {
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return `${base.replace(/\/$/, "")}/${value.replace(/^\//, "")}`;
}

async function apiUrl(authorization: string): Promise<string> {
  const origin = new URL(config.stalwart.jmapUrl).origin;
  for (const path of ["/jmap/session", "/.well-known/jmap"]) {
    const response = await fetch(`${origin}${path}`, {
      headers: { accept: "application/json", authorization },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) continue;
    const session = await response.json() as { apiUrl?: string };
    if (session.apiUrl) return absoluteUrl(origin, session.apiUrl);
  }
  throw new Error("Could not discover the Stalwart JMAP endpoint");
}

async function callStalwart(authorization: string, methodCalls: unknown[]): Promise<JmapResponse[]> {
  const endpoint = await apiUrl(authorization);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail", "urn:ietf:params:jmap:submission", "urn:stalwart:jmap"],
      methodCalls,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => ({})) as { methodResponses?: JmapResponse[]; detail?: string; error?: string };
  if (!response.ok) throw new Error(result.detail ?? result.error ?? `Stalwart JMAP request failed (${response.status})`);
  const responses = result.methodResponses ?? [];
  for (const item of responses) {
    if (item[0] !== "error") continue;
    const payload = item[1] as { type?: string; description?: string };
    throw new Error(payload.description ?? payload.type ?? "Stalwart JMAP method failed");
  }
  return responses;
}

async function accountById(authorization: string, id: string): Promise<StalwartAccount | null> {
  const response = await callStalwart(authorization, [["x:Account/get", { ids: [id], properties: ["id", "name", "domainId"] }, "account-get"]]);
  const list = response[0]?.[1]?.list;
  return Array.isArray(list) ? (list[0] as StalwartAccount | undefined) ?? null : null;
}

async function resolveStalwartDomainId(authorization: string, productDomainId: string, domainName: string): Promise<string> {
  const [state] = await db.select({ stalwartDomainId: domainDnsState.stalwartDomainId }).from(domainDnsState).where(eq(domainDnsState.domainId, productDomainId)).limit(1);
  if (state?.stalwartDomainId) return state.stalwartDomainId;
  const query = await callStalwart(authorization, [["x:Domain/query", { filter: { name: domainName }, limit: 2 }, "domain-query"]]);
  const ids = Array.isArray(query[0]?.[1]?.ids) ? (query[0]![1].ids as unknown[]).filter((value): value is string => typeof value === "string") : [];
  if (ids.length !== 1) throw new Error(`No unique Stalwart domain found for ${domainName}`);
  return ids[0]!;
}

async function resolveMailboxAccountId(authorization: string, productAccountId: string, address: string): Promise<string> {
  const [mailbox] = await db.select({ stalwartPrincipalId: emailAccounts.stalwartPrincipalId, localPart: emailAccounts.localPart, domainId: emailAccounts.domainId })
    .from(emailAccounts).where(eq(emailAccounts.id, productAccountId)).limit(1);
  if (!mailbox) throw new Error(`GSW mailbox record not found for ${address}`);
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) throw new Error(`Invalid mailbox address ${address}`);
  const domainName = address.slice(at + 1).toLowerCase();
  const localPart = mailbox.localPart.toLowerCase();
  const stalwartDomainId = await resolveStalwartDomainId(authorization, mailbox.domainId, domainName);

  if (mailbox.stalwartPrincipalId) {
    const cached = await accountById(authorization, mailbox.stalwartPrincipalId);
    if (cached?.id && cached.name?.toLowerCase() === localPart && cached.domainId === stalwartDomainId) return cached.id;
  }

  const query = await callStalwart(authorization, [["x:Account/query", { filter: { name: mailbox.localPart, domainId: stalwartDomainId }, limit: 2 }, "account-query"]]);
  const ids = Array.isArray(query[0]?.[1]?.ids) ? (query[0]![1].ids as unknown[]).filter((value): value is string => typeof value === "string") : [];
  if (!ids.length) throw new Error(`No Stalwart account found for ${address}`);
  const lookup = await callStalwart(authorization, [["x:Account/get", { ids, properties: ["id", "name", "domainId"] }, "account-get-many"]]);
  const accounts = Array.isArray(lookup[0]?.[1]?.list) ? lookup[0]![1].list as StalwartAccount[] : [];
  const matches = accounts.filter((account) => account.name?.toLowerCase() === localPart && account.domainId === stalwartDomainId);
  const matchId = matches.length === 1 ? matches[0]?.id : undefined;
  if (!matchId) throw new Error(`Stalwart account lookup did not uniquely resolve ${address}`);
  await db.update(emailAccounts).set({ stalwartPrincipalId: matchId }).where(eq(emailAccounts.id, productAccountId));
  return matchId;
}

async function mailboxIdByRole(authorization: string, accountId: string, role: "drafts" | "sent" | "trash"): Promise<string> {
  const response = await callStalwart(authorization, [["Mailbox/get", { accountId, ids: null, properties: ["id", "name", "role"] }, "mailboxes"]]);
  const list = Array.isArray(response[0]?.[1]?.list) ? response[0]![1].list as { id?: unknown; role?: unknown; name?: unknown }[] : [];
  const match = list.find((item) => typeof item.role === "string" && item.role.toLowerCase() === role)
    ?? list.find((item) => typeof item.name === "string" && item.name.toLowerCase() === role);
  if (!match || typeof match.id !== "string") throw new Error(`Stalwart ${role} mailbox not found`);
  return match.id;
}

export async function cloneScheduledEmailToDraft(input: {
  productAccountId: string;
  address: string;
  sourceEmailId: string;
  messageId: string;
}): Promise<{ engineMessageId: string; engineThreadId: string }> {
  if (config.mailEngine === "demo") return { engineMessageId: input.sourceEmailId, engineThreadId: input.sourceEmailId };
  const authorization = adminAuthorization();
  const accountId = await resolveMailboxAccountId(authorization, input.productAccountId, input.address);
  const draftMailboxId = await mailboxIdByRole(authorization, accountId, "drafts");
  const get = await callStalwart(authorization, [[
    "Email/get",
    {
      accountId,
      ids: [input.sourceEmailId],
      properties: ["from", "to", "cc", "bcc", "replyTo", "subject", "inReplyTo", "references", "bodyValues", "textBody", "htmlBody", "attachments"],
      fetchTextBodyValues: true,
      fetchHTMLBodyValues: true,
      fetchAllBodyValues: true,
    },
    "source",
  ]]);
  const source = Array.isArray(get[0]?.[1]?.list) ? (get[0]![1].list as Record<string, unknown>[])[0] : undefined;
  if (!source) throw new Error("Scheduled source email is unavailable for recurring copy");
  const create: Record<string, unknown> = {
    mailboxIds: { [draftMailboxId]: true },
    from: source.from ?? [{ email: input.address }],
    to: source.to ?? [],
    cc: source.cc ?? [],
    bcc: source.bcc ?? [],
    ...(source.replyTo ? { replyTo: source.replyTo } : {}),
    subject: source.subject ?? "",
    messageId: [input.messageId],
    ...(source.inReplyTo ? { inReplyTo: source.inReplyTo } : {}),
    ...(source.references ? { references: source.references } : {}),
    ...(source.bodyValues ? { bodyValues: source.bodyValues } : {}),
    ...(source.textBody ? { textBody: source.textBody } : {}),
    ...(source.htmlBody ? { htmlBody: source.htmlBody } : {}),
    ...(source.attachments ? { attachments: source.attachments } : {}),
  };
  const set = await callStalwart(authorization, [["Email/set", { accountId, create: { scheduled: create } }, "copy"]]);
  const created = (set[0]?.[1]?.created as Record<string, { id?: string; threadId?: string }> | undefined)?.scheduled;
  if (!created?.id) throw new Error(`Could not create recurring scheduled email: ${JSON.stringify(set[0]?.[1]?.notCreated ?? {})}`);
  return { engineMessageId: created.id, engineThreadId: created.threadId ?? created.id };
}

export async function moveScheduledEmailToSent(input: { productAccountId: string; address: string; engineMessageId: string }): Promise<void> {
  if (config.mailEngine === "demo") return;
  const authorization = adminAuthorization();
  const accountId = await resolveMailboxAccountId(authorization, input.productAccountId, input.address);
  const sentMailboxId = await mailboxIdByRole(authorization, accountId, "sent");
  await callStalwart(authorization, [[
    "Email/set",
    { accountId, update: { [input.engineMessageId]: { mailboxIds: { [sentMailboxId]: true }, "/keywords/$seen": true } } },
    "move-sent",
  ]]);
}
