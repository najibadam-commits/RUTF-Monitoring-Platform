// Stores (or replaces) the project URL and the service key in Supabase Vault, where the daily
// retention job (migration 0141, DECISIONS R177) reads them to delete expired photo files through
// the Storage API. Both are read from this folder's .env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
// and go straight into the encrypted vault.secrets table: nothing is printed or written to a file.
//
// Usage: node set-storage-key.js
// Re-running replaces them in place (e.g. after the service key is rotated).
require("dotenv").config({ quiet: true });
const { Client } = require("pg");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in tools/db/.env");
  process.exit(1);
}

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  for (const [name, value, note] of [
    ["retention_supabase_url", url, "Project URL for the retention job's Storage API calls (migration 0141)"],
    ["retention_service_key", key, "Service key for the retention job's Storage API calls (migration 0141)"],
  ]) {
    const existing = await client.query(`select id from vault.secrets where name = $1`, [name]);
    if (existing.rows.length > 0) {
      await client.query(`select vault.update_secret($1, $2)`, [existing.rows[0].id, value]);
      console.log(`✅ Updated ${name} in Vault.`);
    } else {
      await client.query(`select vault.create_secret($1, $2, $3)`, [value, name, note]);
      console.log(`✅ Stored ${name} in Vault.`);
    }
  }
  const check = await client.query(
    `select count(*)::int n from vault.decrypted_secrets where (name = 'retention_supabase_url' and decrypted_secret = $1) or (name = 'retention_service_key' and decrypted_secret = $2)`,
    [url, key]);
  console.log(`Verified readable: ${check.rows[0].n === 2 ? "yes" : "NO — check manually"}`);
  await client.end();
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
