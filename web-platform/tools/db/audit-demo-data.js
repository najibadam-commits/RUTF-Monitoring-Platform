require("dotenv").config({ quiet: true });
const { Client } = require("pg");
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const profiles = await c.query(`select id, name, email, role, project_id from profiles order by role, name`);
  const issues = await c.query(`select count(*)::int as n from issues`);
  const history = await c.query(`select count(*)::int as n from issue_history`);
  const notifications = await c.query(`select count(*)::int as n from notifications`);
  const settlements = await c.query(`select id, statename, lganame, settlementname, status from settlements`);
  const activitySites = await c.query(`select id, statename, lganame, activitysitename, status from activity_sites`);
  const projects = await c.query(`select id, name from projects`);

  console.log("=== profiles ===");
  console.table(profiles.rows);
  console.log("issues:", issues.rows[0].n, " issue_history:", history.rows[0].n, " notifications:", notifications.rows[0].n);
  console.log("\n=== settlements ===");
  console.table(settlements.rows);
  console.log("\n=== activity_sites ===");
  console.table(activitySites.rows);
  console.log("\n=== projects ===");
  console.table(projects.rows);

  await c.end();
})();
