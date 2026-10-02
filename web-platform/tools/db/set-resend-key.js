// Stores (or replaces) the Resend API key in Supabase Vault, where create_notification()
// (migration 0021) reads it from at send time. The key is never written to any file this
// script touches, and never appears in a git-tracked file — it's passed as a CLI arg and goes
// straight into the encrypted vault.secrets table.
//
// Usage: node set-resend-key.js <resend-api-key>
// Re-running with a new key updates it in place (same secret name).
require("dotenv").config({ quiet: true });
const { Client } = require("pg");

const apiKey = process.argv[2];
if (!apiKey || !apiKey.startsWith("re_")) {
  console.error("Usage: node set-resend-key.js <resend-api-key>   (should start with 're_')");
  process.exit(1);
}

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const existing = await client.query(`select id from vault.secrets where name = 'resend_api_key'`);
  if (existing.rows.length > 0) {
    await client.query(`select vault.update_secret($1, $2)`, [existing.rows[0].id, apiKey]);
    console.log("✅ Updated existing resend_api_key in Vault.");
  } else {
    await client.query(`select vault.create_secret($1, 'resend_api_key', 'Resend API key for issue notification emails (migration 0021)')`, [apiKey]);
    console.log("✅ Stored resend_api_key in Vault.");
  }

  const check = await client.query(`select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key'`);
  console.log(`Verified readable: ${check.rows.length === 1 && check.rows[0].decrypted_secret === apiKey ? "yes" : "NO — check manually"}`);

  await client.end();
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
