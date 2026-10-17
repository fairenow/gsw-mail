import { readFileSync } from "node:fs";
import { Client } from "pg";

/**
 * Production-safe, idempotent MCP approval migration runner.
 * This does not enable any MCP write tools.
 *
 * Run after the API build:
 *   node apps/api/dist/db/applyMcpApprovalMigration.js
 */
export async function applyMcpApprovalMigration(connectionString: string): Promise<void> {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = readFileSync(new URL("../../drizzle/0035_mcp_action_approvals.sql", import.meta.url), "utf8");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    // Prevent two overlapping deploys from racing the DDL.
    await client.query("SELECT pg_advisory_xact_lock(20261017, 35)");
    await client.query(sql);
    const verified = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'mcp_action_approvals'",
    );
    if (verified.rowCount !== 1) throw new Error("MCP approval table verification failed");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("applyMcpApprovalMigration.js")) {
  applyMcpApprovalMigration(process.env.DATABASE_URL ?? "")
    .then(() => { process.stdout.write("MCP approval schema verified\n"); })
    .catch((error: unknown) => {
      process.stderr.write(`MCP approval migration failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
      process.exitCode = 1;
    });
}
