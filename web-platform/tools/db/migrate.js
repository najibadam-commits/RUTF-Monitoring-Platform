require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const SUPABASE_DIR = path.join(__dirname, "..", "..", "supabase");
const MIGRATIONS_DIR = path.join(SUPABASE_DIR, "migrations");

const files = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("begin");

    console.log("Dropping stale pre-existing tables (confirmed empty, see conversation)...");
    await client.query("drop table if exists issues cascade;");
    await client.query("drop table if exists profiles cascade;");

    for (const file of files) {
      console.log(`Applying ${file} ...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query(sql);
    }

    console.log("Applying seed.sql ...");
    await client.query(fs.readFileSync(path.join(SUPABASE_DIR, "seed.sql"), "utf8"));

    await client.query("commit");
    console.log("\n✅ All migrations + seed applied successfully.");
  } catch (e) {
    await client.query("rollback");
    console.error("\n❌ Migration failed, rolled back everything:", e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
