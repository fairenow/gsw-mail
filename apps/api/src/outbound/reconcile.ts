import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { outboundMessages } from "../db/schema.js";
import { getEngine } from "../engine/index.js";
import { failSendPreparation, finalizeSend } from "./queue.js";

export async function reconcilePreparing(thresholdMinutes = 5): Promise<number> {
  const rows = await db
    .select()
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.transportStatus, "preparing"),
        lte(outboundMessages.preparingStartedAt, sql`now() - (${thresholdMinutes} * interval '1 minute')`),
      ),
    )
    .limit(25);

  let reconciled = 0;
  for (const row of rows) {
    if (!row.messageId) {
      await failSendPreparation(row.id, "preparing_no_message_id", "send operation has no message id to reconcile");
      reconciled += 1;
      continue;
    }
    try {
      const engine = getEngine();
      const found = await engine.findMessageByRfcMessageId(row.accountId, row.messageId);
      if (found) {
        await finalizeSend(row.id, { engineMessageId: found.engineMessageId, engineThreadId: found.engineThreadId }, new Date());
        reconciled += 1;
        continue;
      }
      const saved = await engine.saveSent(
        row.accountId,
        {
          from: row.fromAddress,
          to: row.to,
          cc: row.cc ?? undefined,
          bcc: row.bcc ?? undefined,
          subject: row.subject ?? undefined,
          textBody: row.textBody ?? undefined,
          htmlBody: row.htmlBody ?? undefined,
          replyTo: row.replyTo ?? undefined,
          inReplyTo: row.inReplyTo ?? undefined,
          references: row.references ?? undefined,
          messageId: row.messageId,
        },
      );
      await finalizeSend(row.id, { engineMessageId: saved.engineMessageId, engineThreadId: saved.threadId }, new Date());
      reconciled += 1;
    } catch (err) {
      console.warn("[outbound:reconcile] preparing job still unsettled", row.id, err instanceof Error ? err.message : err);
    }
  }
  return reconciled;
}