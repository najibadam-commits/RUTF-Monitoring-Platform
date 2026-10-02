// One-off: invite a real Super Admin account (replaces/adds to the demo
// f.yusuf@tpmops.org account). Sends a genuine Supabase Auth invite email
// with a link to set their own password — this script never sees or sets
// the password itself.
//
// Usage: node invite-super-admin.js <email> <full-name>
require("dotenv").config({ quiet: true });
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const email = process.argv[2];
const name = process.argv[3];
if (!email || !name) {
  console.error("Usage: node invite-super-admin.js <email> <full-name>");
  process.exit(1);
}

const SITE_URL = "https://tpm-monitoring-platform.vercel.app";

(async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Inviting ${email} as Super Admin...`);
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { name },
    redirectTo: `${SITE_URL}/auth/confirm?next=/auth/update-password`,
  });
  if (error) {
    console.error("Invite failed:", error.message);
    process.exit(1);
  }
  console.log(`  Auth user created: ${data.user.id}`);

  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  await pg.query(`update profiles set name=$2, role='super_admin', status='active' where id=$1`, [data.user.id, name]);
  await pg.end();

  console.log("✅ Invited. Check the inbox for the invite email (also check spam).");
  console.log(`   Once they click the link and set a password, they can sign in at ${SITE_URL}/login as Super Admin.`);
})();
