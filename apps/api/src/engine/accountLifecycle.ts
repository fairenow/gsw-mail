import { config } from "../config.js";
import { stalwartCall } from "../lib/domainInfrastructure.js";

type ManagementCall = (calls: unknown[]) => Promise<any[]>;
export async function destroyMailboxAccount(address: string, principalId: string | null, call: ManagementCall = stalwartCall): Promise<void> {
  if (config.mailEngine === "demo" && call === stalwartCall) return;
  const at = address.lastIndexOf("@");
  if (at <= 0) throw new Error("Invalid mailbox address");
  const localPart = address.slice(0, at).toLowerCase();
  const domainName = address.slice(at + 1).toLowerCase();
  const domainQuery = await call([["x:Domain/query", { filter: { name: domainName }, limit: 20 }, "domains"]]);
  if (domainQuery[0]?.[0] !== "x:Domain/query" || !Array.isArray(domainQuery[0]?.[1]?.ids)) throw new Error("Incomplete mail server domain response");
  const domainIds = domainQuery[0][1].ids;
  if (!domainIds.length) throw new Error("Mail server domain was not found; no mailbox was deleted");
  const domainResult = await call([["x:Domain/get", { ids: domainIds, properties: ["id", "name"] }, "domain"]]);
  const domains = (domainResult[0]?.[1]?.list ?? []).filter((d: { name?: string }) => d.name?.toLowerCase() === domainName);
  if (domains.length !== 1) throw new Error("Mail server domain was not uniquely verified");
  const domainId = domains[0].id;
  const queried = await call([["x:Account/query", { filter: { name: localPart, domainId }, limit: 20 }, "lookup"]]);
  if (queried[0]?.[0] !== "x:Account/query" || !Array.isArray(queried[0]?.[1]?.ids)) throw new Error("Incomplete mail server account response");
  const ids = queried[0][1].ids;
  if (!ids.length) return;
  const fetched = await call([["x:Account/get", { ids, properties: ["id", "name", "domainId", "@type"] }, "get"]]);
  const matches = (fetched[0]?.[1]?.list ?? []).filter((entry: { name?: string; domainId?: string; "@type"?: string }) => entry.name?.toLowerCase() === localPart && entry.domainId === domainId && entry["@type"] === "User");
  if (matches.length !== 1) throw new Error("Mailbox server identity could not be verified; no mailbox was deleted");
  const id = matches[0].id;
  const destroyed = await call([["x:Account/set", { destroy: [id] }, "delete"]]);
  const result = destroyed[0]?.[1];
  if (!result?.destroyed?.includes(id) && result?.notDestroyed?.[id]?.type !== "notFound") throw new Error("Mail server did not confirm mailbox deletion");
}
