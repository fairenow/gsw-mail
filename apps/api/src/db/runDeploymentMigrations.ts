import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { applyMcpApprovalMigration } from "./applyMcpApprovalMigration.js";

/**
 * Railway's forward-only deployment migration runner.
 *
 * IMPORTANT: The production Drizzle history is not a complete record of
 * schema changes applied by earlier ensureSchema / targeted migrations.
 * Do NOT replace this with an unconditional drizzle-kit migrate command:
 * that would attempt to replay unrelated historical migrations.
 *
 * Add each new production migration to the explicit ordered manifest below.
 * Each migration runs at most once, guarded by a checksum + transaction
 * scoped advisory lock. The existing MCP approval pre-deploy runner remains.
 */
export const DEPLOYMENT_MIGRATIONS = [
  "0045_billing_foundation.sql",
] as const;

export async function runDeploymentMigrations(connectionString: string): Promise<void> {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  // Preserve the existing MCP approval/send-policy pre-deploy migration.
  await applyMcpApprovalMigration(connectionString);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    // Serialize deployment migrations across overlapping Railway deploys.
    await client.query("SELECT pg_advisory_xact_lock(20261112, 45)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.gsw_deployment_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const name of DEPLOYMENT_MIGRATIONS) {
      const sql = readFileSync(new URL(`../../drizzle/${name}`, import.meta.url), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const previous = await client.query<{ checksum: string }>(
        "SELECT checksum FROM public.gsw_deployment_migrations WHERE name = $1",
        [name],
      );
      if (previous.rows.length) {
        if (previous.rows[0]?.checksum !== checksum) {
          throw new Error(`Previously applied deployment migration ${name} has changed; use a new migration file`);
        }
        process.stdout.write(`Already applied: ${name}\n`);
        continue;
      }
      await client.query(sql);
      await client.query(
        "INSERT INTO public.gsw_deployment_migrations (name, checksum) VALUES ($1, $2)",
        [name, checksum],
      );
      process.stdout.write(`Applied: ${name}\n`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("runDeploymentMigrations.js")) {
  runDeploymentMigrations(process.env.DATABASE_URL ?? "").catch((error: unknown) => {
    process.stderr.write(`Deployment migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
