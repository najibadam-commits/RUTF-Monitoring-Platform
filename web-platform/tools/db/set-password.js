// One-off: set a known password directly on an existing Supabase Auth user via the service-role
// admin API — no email involved. Use when reset-email delivery is unreliable (see DECISIONS.md /
// the Resend sandbox-domain limitation this project hit earlier) and it's the account's own owner
// asking.
//
// Usage: node set-password.js <email> <new-password>
require("dotenv").config({ quiet: true });
const { createClient } = require("@supabase/supabase-js");

const email = process.argv[2];
const newPassword = process.argv[3];
if (!email || !newPassword) {
  console.error("Usage: node set-password.js <email> <new-password>");
  process.exit(1);
}

(async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: list, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) { console.error("Lookup failed:", listErr.message); process.exit(1); }
  const user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) { console.error(`No auth user found for ${email}`); process.exit(1); }

  const { error } = await admin.auth.admin.updateUserById(user.id, { password: newPassword });
  if (error) { console.error("Password update failed:", error.message); process.exit(1); }

  console.log(`✅ Password set for ${email} (id ${user.id}).`);
})();
