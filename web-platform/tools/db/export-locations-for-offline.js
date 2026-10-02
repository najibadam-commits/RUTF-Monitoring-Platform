// Exports settlements/activity_sites joined to their ward's wardcode, for building the Android
// app's offline SQLite assets (Settlement.sqlite / ActivitySite.sqlite) — mirrors the existing
// Ward.sqlite/LGA.sqlite/state.sqlite bundled-asset pattern (see ReferenceRepository.kt).
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const OUT_DIR = process.argv[2] || ".";

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const settlements = await client.query(`
    select w.code as wardcode, s.settlementname
    from settlements s join wards w on w.id = s.ward_id
    where s.status <> 'rejected'
    order by w.code, s.settlementname
  `);
  fs.writeFileSync(
    path.join(OUT_DIR, "settlements_export.json"),
    JSON.stringify(settlements.rows),
  );
  console.log(`settlements exported: ${settlements.rows.length}`);

  const activitySites = await client.query(`
    select w.code as wardcode, a.activitysitename
    from activity_sites a join wards w on w.id = a.ward_id
    where a.status <> 'rejected'
    order by w.code, a.activitysitename
  `);
  fs.writeFileSync(
    path.join(OUT_DIR, "activity_sites_export.json"),
    JSON.stringify(activitySites.rows),
  );
  console.log(`activity sites exported: ${activitySites.rows.length}`);

  await client.end();
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
