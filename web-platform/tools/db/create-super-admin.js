// One-off: create a Super Admin account with no password and no email sent — then set the
// password with set-password.js. Use when invite emails don't arrive. If the address already has
// an account, it is promoted to Super Admin instead.
//
// Usage: node create-super-admin.js <email> <full-name>
//        node set-password.js <email> <new-password>
require("dotenv").config({ quiet: true });
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const email = (process.argv[2] ?? "").trim().toLowerCase();
const name = (process.argv[3] ?? "").trim();
if (!email || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: node create-super-admin.js <email> <full-name>");
  process.exit(1);
}

(async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let userId;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { name } });
  if (error) {
    if (!/already|registered|exists/i.test(error.message)) {
      console.error("Create failed:", error.message);
      process.exit(1);
    }
    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    userId = (await pg.query(`select id from auth.users where lower(email) = $1`, [email])).rows[0]?.id;
    await pg.end();
    if (!userId) { console.error(`Account exists but couldn't be found: ${email}`); process.exit(1); }
    console.log(`  ${email} already has an account (${userId}) — promoting it.`);
  } else {
    userId = data.user.id;
    console.log(`  Account created: ${userId}`);
  }

  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const r = await pg.query(
    `update profiles set name = $2, role = 'super_admin', status = 'active' where id = $1 returning role, status`,
    [userId, name],
  );
  await pg.end();
  if (!r.rowCount) { console.error("No profile row for the account — check the on_auth_user_created trigger."); process.exit(1); }

  console.log(`✅ ${email} is a Super Admin (no password yet).`);
  console.log(`   Next: node set-password.js ${email} "<new password>"`);
})();
