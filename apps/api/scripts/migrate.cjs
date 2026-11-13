const { readdir, readFile } = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to run database migrations.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined });
  try {
    await pool.query("CREATE TABLE IF NOT EXISTS app_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const directory = path.resolve(__dirname, "../migrations");
    const files = (await readdir(directory)).filter((name) => /^\d+_[\w-]+\.sql$/.test(name)).sort();
    for (const name of files) {
      const applied = await pool.query("SELECT 1 FROM app_schema_migrations WHERE name = $1", [name]);
      if (applied.rowCount) continue;
      const sql = await readFile(path.join(directory, name), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO app_schema_migrations(name) VALUES ($1)", [name]);
        await client.query("COMMIT");
        process.stdout.write(`Applied ${name}\n`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    process.stdout.write("Database migrations are up to date.\n");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
