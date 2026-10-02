// Applies a single migration file against the live DB, in its own
// transaction. Use this for incremental migrations added after the initial
// `node migrate.js` run — migrate.js itself always starts by dropping
// issues/profiles, so re-running it would destroy live data (including the
// imported boundary geometry) and must NOT be used for incremental changes.
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
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(sql);
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
