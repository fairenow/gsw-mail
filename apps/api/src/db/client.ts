import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "../config.js";
import * as schema from "./schema.js";

export const pool = new Pool({ connectionString: config.databaseUrl });

export const db = drizzle(pool, { schema });

export async function pingDatabase(): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}