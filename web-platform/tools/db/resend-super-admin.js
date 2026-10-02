// Resends account-setup access for an existing-but-passwordless Super Admin.
// Tries a fresh invite first; if the account already registered from the
// earlier attempt, falls back to a password-recovery email instead — both
// land on /auth/confirm -> /auth/update-password with the templates fixed.
require("dotenv").config({ quiet: true });
const { createClient } = require("@supabase/supabase-js");

const email = process.argv[2];
if (!email) {
  console.error("Usage: node resend-super-admin.js <email>");
  process.exit(1);
}

const SITE_URL = "https://tpm-monitoring-platform.vercel.app";

(async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Attempting fresh invite for ${email}...`);
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${SITE_URL}/auth/confirm?next=/auth/update-password`,
  });

  if (!inviteError) {
    console.log("✅ Invite email resent.");
    return;
  }

  console.log(`  Invite failed (${inviteError.message}) — falling back to a password-recovery email...`);
  const { error: resetError } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo: `${SITE_URL}/auth/confirm?next=/auth/update-password`,
  });
  if (resetError) {
    console.error("❌ Recovery email also failed:", resetError.message);
    process.exit(1);
  }
  console.log("✅ Password-recovery email sent instead.");
})();
