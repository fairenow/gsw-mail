import { ensureAutomationSummaryEmailSchema } from "./ai/automationSummaryEmail.js";
import { ensureCalendarEmailReminderSchema, deliverDueCalendarEmailReminders } from "./calendar/emailReminders.js";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/client.js";
import { ensureWebOAuthTestClient } from "./auth/ensureWebOAuthTestClient.js";
import { ensureScheduledSendSchema } from "./outbound/ensureScheduledSchema.js";
import { ensureCalendarRsvpSchema } from "./calendar/ensureRsvpSchema.js";
import { ensureAiAgentSchema } from "./ai/ensureAgentSchema.js";
import { getOutboundWorker } from "./outbound/worker.js";
import { getAutomationWorker } from "./ai/automationWorker.js";
import { getAgentTaskRunner } from "./ai/taskRunner.js";
import { ensureEmailTemplateSchema } from "./mail/ensureTemplateSchema.js";
import { ensureFilesSchema } from "./files/ensureFilesSchema.js";

const app = buildApp();
const worker = getOutboundWorker();
const automationWorker = getAutomationWorker();
const agentTaskRunner = getAgentTaskRunner();

async function main() {
  await ensureScheduledSendSchema();
  await ensureCalendarRsvpSchema();
  await ensureCalendarEmailReminderSchema();
  await ensureAutomationSummaryEmailSchema();
  await ensureAiAgentSchema();
  await ensureEmailTemplateSchema();
  await ensureFilesSchema();
  await ensureWebOAuthTestClient();
  worker.start();
  const reminderTimer = setInterval(() => { void deliverDueCalendarEmailReminders().catch(error => app.log.error(error, "calendar reminder worker failed")); }, 60_000);
  reminderTimer.unref();
  void deliverDueCalendarEmailReminders().catch(error => app.log.error(error, "calendar reminder worker failed"));
  automationWorker.start();
  agentTaskRunner.start();
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

const shutdown = async (signal: string) => {
  app.log.info(`received ${signal}, shutting down`);
  worker.stop();
  automationWorker.stop();
  agentTaskRunner.stop();
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
