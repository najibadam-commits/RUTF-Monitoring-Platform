// Removes everything traceable to seed-demo.js and to CSV-upload testing,
// leaving only the real Super Admin account (najibadam@gmail.com) and
// reference data (categories/states/lgas/wards) intact. Explicitly does
// NOT touch najibadama@gmail.com (unrecognized account, left alone pending
// the user's own decision) or any account not in the DEMO_EMAILS list.
require("dotenv").config({ quiet: true });
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const DEMO_EMAILS = [
  "f.yusuf@tpmops.org",
  "a.bello@tpmops.org",
  "b.adeyemi@tpmops.org",
  "e.okafor@tpmops.org",
  "s.abdullahi@tpmops.org",
  "a.obi@tpmops.org",
  "g.effiong@tpmops.org",
  "i.suleiman@tpmops.org",
  "j.okonkwo@tpmops.org",
];
const DEMO_PROJECT_NAME = "Northern Corridor Program";

(async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  try {
    console.log("1. Deleting all issues (cascades issue_history, issue_photos, notifications)...");
    const issuesDeleted = await pg.query("delete from issues returning id");
    console.log(`   Deleted ${issuesDeleted.rowCount} issues.`);

    console.log("2. Clearing settings.updated_by if it points at a demo account...");
    await pg.query(`
      update settings set updated_by = null
      where updated_by in (select id from profiles where email = any($1::text[]))
    `, [DEMO_EMAILS]);

    console.log("3. Deleting test data-set entries (settlements/activity_sites)...");
    const settlementsDeleted = await pg.query("delete from settlements returning id");
    const sitesDeleted = await pg.query("delete from activity_sites returning id");
    console.log(`   Deleted ${settlementsDeleted.rowCount} settlements, ${sitesDeleted.rowCount} activity sites.`);

    console.log("4. Deleting demo accounts (via Admin API, cascades their profiles row)...");
    const { data: userList } = await admin.auth.admin.listUsers();
    for (const email of DEMO_EMAILS) {
      const user = userList.users.find((u) => u.email === email);
      if (!user) {
        console.log(`   - ${email}: not found, skipping`);
        continue;
      }
      const { error } = await admin.auth.admin.deleteUser(user.id);
      console.log(error ? `   ✗ ${email}: ${error.message}` : `   - ${email}: deleted`);
    }

    console.log("5. Deleting the demo project...");
    const projectDeleted = await pg.query("delete from projects where name = $1 returning id", [DEMO_PROJECT_NAME]);
    console.log(`   Deleted ${projectDeleted.rowCount} project(s).`);

    console.log("\n✅ Cleanup complete.");
  } finally {
    await pg.end();
  }
})();
