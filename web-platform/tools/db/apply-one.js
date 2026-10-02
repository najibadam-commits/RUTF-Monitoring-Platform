// Applies a single migration file against the live DB, in its own
// transaction. Use this for incremental migrations added after the initial
// `node migrate.js` run — migrate.js itself always starts by dropping
// issues/profiles, so re-running it would destroy live data (including the
// imported boundary geometry) and must NOT be used for incremental changes.
//
// Records the file in supabase_migrations.schema_migrations in the same transaction (as
// migrate.js's database was, RUTF DECISIONS.md R8), so the Supabase GitHub integration treats it
// as applied, and refuses a version that is already recorded.
//
// Usage: node apply-one.js ../../supabase/migrations/0013_something.sql
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const file = process.argv[2];
if (!file) {
  console.error("Usage: node apply-one.js <path-to-migration.sql>");
  process.exit(1);
}

(async () => {
  const sql = fs.readFileSync(path.resolve(file), "utf8");
  const match = path.basename(file).match(/^(\d+)_(.+)\.sql$/);
  if (!match) {
    console.error("Migration file name must look like 0100_name.sql");
    process.exit(1);
  }
  const [, version, name] = match;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");
    const recorded = await client.query(
      "select 1 from supabase_migrations.schema_migrations where version = $1",
      [version],
    );
    if (recorded.rowCount) throw new Error(`version ${version} is already recorded as applied`);
    await client.query(sql);
    await client.query(
      "insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)",
      [version, name],
    );
    await client.query("commit");
    console.log(`✅ Applied ${file}`);
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.error(`❌ Failed to apply ${file}:`, e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
