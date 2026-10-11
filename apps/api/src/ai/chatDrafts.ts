import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { aiConversations, aiToolCalls, aiToolResults } from "../db/schema.js";
import { requireAccountPermission } from "../auth/authorize.js";
import { createMailService } from "../services/mailService.js";

const draftToolNames = ["mail.create_draft", "mail.update_draft", "mail.send_draft", "mail.trash_draft"];

export async function workingDraftForConversation(input: {
  userId: string; authUserId: string; conversationId: string;
  headers: Record<string, string>;
}) {
  const [conversation] = await db.select().from(aiConversations).where(and(
    eq(aiConversations.id, input.conversationId), eq(aiConversations.userId, input.userId),
  )).limit(1);
  if (!conversation || !conversation.accountId) return null;
  const accountId = conversation.accountId;
  await requireAccountPermission(input.userId, accountId, "read");
  const rows = await db.select({
    name: aiToolCalls.toolName, arguments: aiToolCalls.arguments,
    result: aiToolResults.result, ok: aiToolResults.ok,
  }).from(aiToolCalls)
    .innerJoin(aiToolResults, eq(aiToolCalls.id, aiToolResults.toolCallId))
    .where(eq(aiToolCalls.conversationId, input.conversationId))
    .orderBy(desc(aiToolCalls.createdAt)).limit(80);
  let draftId: string | null = null;
  for (const row of rows) {
    if (!row.ok || !draftToolNames.includes(row.name)) continue;
    if (row.name === "mail.send_draft" || row.name === "mail.trash_draft") return null;
    const resultId = row.result && typeof row.result.engineId === "string" ? row.result.engineId : null;
    const argumentId = row.arguments && typeof row.arguments.draftId === "string" ? row.arguments.draftId : null;
    draftId = resultId || argumentId;
    if (draftId) break;
  }
  if (!draftId) return null;
  const service = createMailService({
    userId: input.userId, authUserId: input.authUserId, headers: input.headers,
  });
  try {
    const draft = await service.readMessage(accountId, draftId, false);
    if (!/draft/i.test(draft.mailbox)) return null;
    return {
      accountId, draftId: draft.engineId,
      subject: draft.subject || "(No subject)",
      to: draft.to.map(recipient => recipient.email),
      cc: draft.cc.map(recipient => recipient.email),
      textBody: draft.textBody || "",
    };
  } catch {
    // A draft may have been manually removed, moved, or sent.
    return null;
  }
}
