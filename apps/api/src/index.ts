import { createMobileNotificationWorker, ensureMobileNotificationSchema } from "./mobile/notificationWorker.js";
import { ensureAutomationSummaryEmailSchema } from "./ai/automationSummaryEmail.js";
import { ensureCalendarEmailReminderSchema, deliverDueCalendarEmailReminders } from "./calendar/emailReminders.js";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/client.js";
import { ensureWebOAuthTestClient } from "./auth/ensureWebOAuthTestClient.js";
import { ensureScheduledSendSchema } from "./outbound/ensureScheduledSchema.js";
import { ensureCalendarRsvpSchema } from "./calendar/ensureRsvpSchema.js";
import { ensureAiAgentSchema } from "./ai/ensureAgentSchema.js";
import { startChatExecutionWorker } from "./ai/chatBackgroundWorker.js";
import { ensureBackgroundMailboxGrantSchema } from "./ai/backgroundMailboxGrants.js";
import { ensureInboxTriageSchema } from "./ai/ensureInboxTriageSchema.js";
import { ensureChatExecutionSchema } from "./ai/ensureChatExecutionSchema.js";
import { getOutboundWorker } from "./outbound/worker.js";
import { getAutomationWorker } from "./ai/automationWorker.js";
import { getAgentTaskRunner } from "./ai/taskRunner.js";
import { ensureEmailTemplateSchema } from "./mail/ensureTemplateSchema.js";
import { ensureFilesSchema } from "./files/ensureFilesSchema.js";
import { startOrganizationWorker } from "./files/organizationJobs.js";
import { ensureFileOrganizationSchema } from "./files/ensureOrganizationSchema.js";
import { ensureEngagementAnalyticsSchema } from "./analytics/ensureSchema.js";
import { ensurePromptingQuotaSchema } from "./ai/ensurePromptingQuotaSchema.js";
import { ensureProposalSchema } from "./ai/proposalStore.js";
import { ensureProposalConversationSchema } from "./ai/proposalConversation.js";
import { startProposalNotificationWorker } from "./ai/proposalNotificationWorker.js";
import { startMcpPayloadRetentionWorker } from "./mcp/payloadRetentionWorker.js";

const app = buildApp();
const worker = getOutboundWorker();
const automationWorker = getAutomationWorker();
const agentTaskRunner = getAgentTaskRunner();
const mobileNotificationWorker=createMobileNotificationWorker({onError:error=>app.log.error(error,"mobile notification delivery failed")});
let stopChatWorker: (()=>void)|null=null;
let stopFileOrganizer: (() => void) | null = null;
let stopProposalNotifier: (() => void) | null = null;
let stopMcpPayloadRetention: (() => void) | null = null;

async function main() {
  await ensureScheduledSendSchema();
  await ensureCalendarRsvpSchema();
  await ensureCalendarEmailReminderSchema();
  await ensureMobileNotificationSchema();
  await ensureAutomationSummaryEmailSchema();
  await ensureAiAgentSchema();
  await ensureInboxTriageSchema();
  await ensureChatExecutionSchema();
  await ensureBackgroundMailboxGrantSchema();
  await ensureEmailTemplateSchema();
  await ensureFilesSchema();
  await ensureFileOrganizationSchema();
  await ensureEngagementAnalyticsSchema();
  await ensurePromptingQuotaSchema();
  await ensureProposalSchema();
  await ensureProposalConversationSchema();
  await ensureWebOAuthTestClient();
  stopMcpPayloadRetention = startMcpPayloadRetentionWorker(
    error => app.log.error(error, "MCP payload retention cleanup failed"),
    count => app.log.info({ count }, "Expired MCP encrypted payloads removed"),
  );
  worker.start();
  stopProposalNotifier = startProposalNotificationWorker(error => app.log.error(error, "proposal notification worker failed"));
  const reminderTimer = setInterval(() => { void deliverDueCalendarEmailReminders().catch(error => app.log.error(error, "calendar reminder worker failed")); }, 60_000);
  reminderTimer.unref();
  void deliverDueCalendarEmailReminders().catch(error => app.log.error(error, "calendar reminder worker failed"));
  mobileNotificationWorker.start();
  automationWorker.start();
  agentTaskRunner.start();
  stopChatWorker=startChatExecutionWorker();
  stopFileOrganizer = startOrganizationWorker(error => app.log.error(error, "file organization worker failed"));
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

const shutdown = async (signal: string) => {
  app.log.info(`received ${signal}, shutting down`);
  worker.stop();
  stopProposalNotifier?.();
  stopMcpPayloadRetention?.();
  mobileNotificationWorker.stop();
  automationWorker.stop();
  agentTaskRunner.stop();
  stopChatWorker?.();
  stopFileOrganizer?.();
  await app.close();
  await pool.end();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

void main().catch(async (err) => {
  app.log.error(err);
  await pool.end();
  process.exit(1);
});
