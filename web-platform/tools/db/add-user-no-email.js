// Adds a user the same way the web app's "Add User" screen does (addUserAction in
// web/src/lib/actions/users.ts) — same profile fields, same project_id derivation — but via
// admin.createUser + a directly-set password instead of inviteUserByEmail, which is what's
// hitting Supabase's "email rate limit exceeded". No email is sent; the account is created
// pre-confirmed and immediately usable with the password printed at the end.
//
// Usage: node add-user-no-email.js <email> <full-name> <role> [phone] [password]
//   role: super_admin | project_admin | tpm_supervisor | dri | viewer
//   password: optional — a random one is generated and printed if omitted.
require("dotenv").config({ quiet: true });
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");
const crypto = require("crypto");

const [, , email, name, role, phone, passwordArg] = process.argv;
if (!email || !name || !role) {
  console.error("Usage: node add-user-no-email.js <email> <full-name> <role> [phone] [password]");
  process.exit(1);
}
const VALID_ROLES = ["super_admin", "project_admin", "tpm_supervisor", "dri", "viewer"];
if (!VALID_ROLES.includes(role)) {
  console.error(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(", ")}`);
  process.exit(1);
}
const password = passwordArg || crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "x") + "!1";

(async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let userId;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error?.message?.includes("already been registered")) {
    // A prior inviteUserByEmail attempt (e.g. from the web app's Add User screen) creates the
    // auth.users row BEFORE attempting the email send — if that send then fails (rate limit),
    // the row still persists, unconfirmed and passwordless, and the caller's profile update
    // never ran (addUserAction returns early on the invite error). Recover it instead of
    // erroring: find it, confirm it, set its password, then apply the same profile update.
    console.log("Account already exists (likely a stuck invite attempt) — recovering it instead of creating new.");
    const { data: list, error: listErr } = await admin.auth.admin.listUsers();
    if (listErr) { console.error("Lookup failed:", listErr.message); process.exit(1); }
    const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!existing) { console.error("Could not find the existing user despite the 'already registered' error."); process.exit(1); }
    userId = existing.id;
    const { error: updateErr } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    if (updateErr) { console.error("Failed to update the existing account:", updateErr.message); process.exit(1); }
    console.log(`Recovered existing auth user: ${userId}`);
  } else if (error || !data.user) {
    console.error("Failed to create the account:", error?.message);
    process.exit(1);
  } else {
    userId = data.user.id;
    console.log(`Auth user created: ${userId}`);
  }

  // Same project_id derivation addUserAction uses for a super_admin caller: null (unscoped).
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  await pg.query(
    `update profiles set name = $2, phone = $3, role = $4, project_id = null, status = 'active' where id = $1`,
    [userId, name, phone || null, role],
  );
  await pg.end();

  console.log(`\n✅ ${name} <${email}> added as ${role}.`);
  console.log(`   Password: ${password}`);
  console.log(`   Share this with them directly — no email was sent.`);
})();
