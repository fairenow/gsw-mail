import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/client.js";
import { ensureWebOAuthTestClient } from "./auth/ensureWebOAuthTestClient.js";
import { ensureScheduledSendSchema } from "./outbound/ensureScheduledSchema.js";
import { ensureCalendarRsvpSchema } from "./calendar/ensureRsvpSchema.js";
import { ensureAiAgentSchema } from "./ai/ensureAgentSchema.js";
import { getOutboundWorker } from "./outbound/worker.js";

const app = buildApp();
const worker = getOutboundWorker();

async function main() {
  await ensureScheduledSendSchema();
  await ensureCalendarRsvpSchema();
  await ensureAiAgentSchema();
  await ensureWebOAuthTestClient();
  worker.start();
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

const shutdown = async (signal: string) => {
  app.log.info(`received ${signal}, shutting down`);
  worker.stop();
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
