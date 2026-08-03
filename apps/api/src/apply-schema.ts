import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error("DATABASE_ADMIN_URL is required to apply schema versions");
const applicationConnection = process.env.DATABASE_URL;
if (!applicationConnection) throw new Error("DATABASE_URL is required to apply schema versions");
const pool = new Pool({ connectionString });
await pool.query("CREATE TABLE IF NOT EXISTS schema_versions (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
const dir = new URL("../schema/", import.meta.url);
for (const name of (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort()) {
  const applied = await pool.query("SELECT 1 FROM schema_versions WHERE name=$1", [name]);
  if (applied.rowCount) continue;
  const sql = await readFile(new URL(name, dir), "utf8");
  const client = await pool.connect();
  try { await client.query("BEGIN"); await client.query(sql); await client.query("INSERT INTO schema_versions(name) VALUES($1)", [name]); await client.query("COMMIT"); console.log(`Applied ${name}`); }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
const rolePassword = decodeURIComponent(new URL(applicationConnection).password).replace(/'/g, "''");
await pool.query(`ALTER ROLE salus_app WITH LOGIN PASSWORD '${rolePassword}'`);
await pool.end();
