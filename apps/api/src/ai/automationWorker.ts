import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { inboundMessages } from "../db/schema.js";
import { appendAiMessage, completeAiRun, failAiRun, startAiRun } from "./agentState.js";
import {
  beginAutomationRun,
  claimDueAutomation,
  completeAutomationRun,
  failAutomationRun,
} from "./automationService.js";
import { getAiProvider, type AiProviderMessage } from "./providers/index.js";

export interface AutomationWorker {
  start(): void;
  stop(): void;
  runOnce(): Promise<number>;
}

const buildMailboxSnapshot = async (accountId: string | null) => {
  if (!accountId) return "No mailbox is attached to this scheduled task.";
  const rows = await db.select({
    engineId: inboundMessages.engineId,
    fromEmail: inboundMessages.fromEmail,
    fromName: inboundMessages.fromName,
    subject: inboundMessages.subject,
    snippet: inboundMessages.snippet,
    date: inboundMessages.date,
    read: inboundMessages.read,
    flagged: inboundMessages.flagged,
    hasAttachments: inboundMessages.hasAttachments,
  }).from(inboundMessages).where(and(
    eq(inboundMessages.accountId, accountId),
    eq(inboundMessages.mailboxRole, "inbox"),
  )).orderBy(desc(inboundMessages.date)).limit(120);

  if (rows.length === 0) return "The indexed inbox snapshot is currently empty.";
  return rows.map((message, index) => [
    `#${index + 1}`,
    `Date: ${message.date.toISOString()}`,
    `From: ${message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail}`,
    `Subject: ${message.subject ?? "(no subject)"}`,
    `Read: ${message.read ? "yes" : "no"}`,
    `Flagged: ${message.flagged ? "yes" : "no"}`,
    `Attachments: ${message.hasAttachments ? "yes" : "no"}`,
    `Snippet: ${message.snippet ?? "(none)"}`,
  ].join("\n")).join("\n\n");
};

export function createAutomationWorker(intervalMs = 60_000): AutomationWorker {
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  const runOnce = async () => {
    if (running) return 0;
    running = true;
    let processed = 0;
    try {
      for (let index = 0; index < 5; index += 1) {
        const automation = await claimDueAutomation();
        if (!automation) break;
        processed += 1;
        const automationRun = await beginAutomationRun(automation.id, automation.conversationId);
        let aiRunId: string | undefined;
        try {
          const provider = getAiProvider();
          if (!automation.conversationId) throw new Error("automation conversation is unavailable");

          const aiRun = await startAiRun({
            conversationId: automation.conversationId,
            userId: automation.userId,
            accountId: automation.accountId ?? undefined,
            provider: provider.id,
            metadata: {
              kind: "scheduled_automation",
              automationId: automation.id,
              automationRunId: automationRun.id,
            },
          });
          aiRunId = aiRun.id;

          const mailboxSnapshot = automation.allowedScopes.includes("mail.read")
            ? await buildMailboxSnapshot(automation.accountId)
            : "Mailbox reading is not authorized for this scheduled task.";

          const messages: AiProviderMessage[] = [{
            role: "user",
            content: [
              "Execute this scheduled GSW Mail task as a background briefing.",
              `Task: ${automation.instruction}`,
              `Time zone: ${automation.timeZone}`,
              `Run time: ${new Date().toISOString()}`,
              "",
              "Important execution boundary:",
              "- You may reason over the indexed mailbox snapshot below when mail.read is authorized.",
              "- This background scheduler currently does not send email, mutate drafts, launch campaigns, or perform other external actions.",
              "- If the instruction asks for an unavailable mutation, give the useful preparation/analysis that can be completed safely and state what still requires an interactive confirmed action.",
              "- Do not invent message contents beyond the provided metadata/snippets.",
              "",
              "Indexed inbox snapshot:",
              mailboxSnapshot,
            ].join("\n"),
          }];

          const result = await provider.run({ messages });
          const content = result.content?.trim() || "The scheduled task completed without a written result.";

          await appendAiMessage({
            conversationId: automation.conversationId,
            role: "assistant",
            content,
            provider: provider.id,
            model: result.model,
            metadata: {
              kind: "automation_result",
              automationId: automation.id,
              automationRunId: automationRun.id,
              scheduledFor: automation.nextRunAt.toISOString(),
            },
          });
          await completeAiRun(aiRun.id, {
            model: result.model,
            metadata: { automationId: automation.id, automationRunId: automationRun.id },
          });
          await completeAutomationRun({
            automationId: automation.id,
            runId: automationRun.id,
            schedule: automation.schedule,
            timeZone: automation.timeZone,
            result: content,
            conversationId: automation.conversationId,
          });
        } catch (error) {
          if (aiRunId) await failAiRun(aiRunId, error).catch(() => undefined);
          await failAutomationRun({
            automationId: automation.id,
            runId: automationRun.id,
            schedule: automation.schedule,
            timeZone: automation.timeZone,
            error,
          });
          console.warn("[ai:automation] run failed", {
            automationId: automation.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      running = false;
    }
    return processed;
  };

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => { void runOnce(); }, intervalMs);
      void runOnce();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    runOnce,
  };
}

let worker: AutomationWorker | undefined;

export function getAutomationWorker() {
  worker ??= createAutomationWorker();
  return worker;
}
