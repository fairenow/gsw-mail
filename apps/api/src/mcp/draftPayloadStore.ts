import { and, eq, gt, lt, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { mcpActionApprovals, mcpActionPayloads } from "../db/schema.js";
import { mcpArgumentsDigest } from "./writeApprovalPolicy.js";
import { decodeMcpPayloadKey, decryptMcpPayload, encryptMcpPayload } from "./encryptedPayload.js";
import { describeMcpDraft, mcpDraftArguments } from "./prepareDraftAction.js";

/**
 * Persist a proposed draft and its encrypted arguments in one transaction.
 * Not exposed through MCP until a first-party exact-content review flow exists.
 */
export async function storePreparedMcpDraft(input: {
  userId: string;
  accountId: string;
  clientId: string;
  argumentsValue: unknown;
  expiresAt: Date;
}) {
  if (!input.userId || !input.accountId || !input.clientId || input.clientId.length > 256) {
    throw new Error("Invalid MCP proposal identity");
  }
  const now = Date.now();
  if (!Number.isFinite(input.expiresAt.getTime()) ||
      input.expiresAt.getTime() <= now ||
      input.expiresAt.getTime() > now + 30 * 60_000) {
    throw new Error("Invalid MCP proposal expiration");
  }
  const argumentsValue = mcpDraftArguments.parse(input.argumentsValue);
  const key = decodeMcpPayloadKey(process.env.MCP_APPROVAL_PAYLOAD_KEY);
  const argumentsDigest = mcpArgumentsDigest(argumentsValue);
  return db.transaction(async tx => {
    const [approval] = await tx.insert(mcpActionApprovals).values({
      userId: input.userId,
      accountId: input.accountId,
      clientId: input.clientId,
      toolName: "mail.create_draft",
      argumentsDigest,
      summary: describeMcpDraft(argumentsValue),
      status: "pending",
      expiresAt: input.expiresAt,
    }).returning({
      id: mcpActionApprovals.id,
      summary: mcpActionApprovals.summary,
      expiresAt: mcpActionApprovals.expiresAt,
      status: mcpActionApprovals.status,
    });
    if (!approval) throw new Error("Unable to prepare MCP draft");
    const encrypted = encryptMcpPayload({ approvalId: approval.id, argumentsDigest, argumentsValue, key });
    await tx.insert(mcpActionPayloads).values({
      approvalId: approval.id,
      version: encrypted.version,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
      authTag: encrypted.authTag,
    });
    return approval;
  });
}

/** For the authenticated GSW first-party review UI only, never generic MCP read tools. */
export async function loadMcpDraftForReview(input: {
  userId: string;
  approvalId: string;
}) {
  const [record] = await db.select({
    id: mcpActionApprovals.id,
    accountId: mcpActionApprovals.accountId,
    toolName: mcpActionApprovals.toolName,
    status: mcpActionApprovals.status,
    argumentsDigest: mcpActionApprovals.argumentsDigest,
    expiresAt: mcpActionApprovals.expiresAt,
    version: mcpActionPayloads.version,
    nonce: mcpActionPayloads.nonce,
    ciphertext: mcpActionPayloads.ciphertext,
    authTag: mcpActionPayloads.authTag,
  }).from(mcpActionApprovals)
    .innerJoin(mcpActionPayloads, eq(mcpActionPayloads.approvalId, mcpActionApprovals.id))
    .where(and(
      eq(mcpActionApprovals.id, input.approvalId),
      eq(mcpActionApprovals.userId, input.userId),
      eq(mcpActionApprovals.toolName, "mail.create_draft"),
      eq(mcpActionApprovals.status, "pending"),
      gt(mcpActionApprovals.expiresAt, new Date()),
    )).limit(1);
  if (!record) return null;
  const key = decodeMcpPayloadKey(process.env.MCP_APPROVAL_PAYLOAD_KEY);
  const decrypted = decryptMcpPayload({
    approvalId: record.id,
    argumentsDigest: record.argumentsDigest,
    payload: { version: record.version, nonce: record.nonce, ciphertext: record.ciphertext, authTag: record.authTag },
    key,
  });
  const argumentsValue = mcpDraftArguments.parse(decrypted);
  if (mcpArgumentsDigest(argumentsValue) !== record.argumentsDigest) {
    throw new Error("MCP draft approval digest mismatch");
  }
  return {
    approvalId: record.id,
    accountId: record.accountId,
    toolName: record.toolName,
    status: record.status,
    expiresAt: record.expiresAt,
    arguments: argumentsValue,
  };
}

/** Remove expired ciphertext without deleting the audit ledger. Schedule before enabling MCP proposals. */
export async function purgeExpiredMcpDraftPayloads(now = new Date()): Promise<number> {
  const expiredIds = db.select({ id: mcpActionApprovals.id })
    .from(mcpActionApprovals)
    .where(lt(mcpActionApprovals.expiresAt, now));
  const deleted = await db.delete(mcpActionPayloads)
    .where(inArray(mcpActionPayloads.approvalId, expiredIds))
    .returning({ approvalId: mcpActionPayloads.approvalId });
  return deleted.length;
}
