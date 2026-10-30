import { readFile } from "node:fs/promises";
import { pool } from "../db/client.js";

export async function ensureIntegrationSchema(): Promise<void> {
  const migration = (await Promise.all(["0041_integration_email_api", "0042_mailbox_credential_vault"].map(name => readFile(new URL(`../../drizzle/${name}.sql`, import.meta.url), "utf8")))).join("\n");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('gsw-integration-api-v1'))");
    await client.query(migration);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
