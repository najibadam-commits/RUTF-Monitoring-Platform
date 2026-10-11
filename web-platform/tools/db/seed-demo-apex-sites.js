// DUMMY data: marks one Apex OTP centre per LGA (lga_apex_otp, migration 0138, DECISIONS R173) so
// the allocation plan and the reports show Apex and satellites. The pick is not real: a hospital if
// the LGA has one among its OTP sites, otherwise a Primary Health Centre, otherwise the first by
// name. Rows are flagged dummy = true; --remove deletes only those (an Apex set by an officer stays).
//
//   node seed-demo-apex-sites.js            # mark LGAs without an Apex
//   node seed-demo-apex-sites.js --remove   # remove the DUMMY marks
require("dotenv").config({ quiet: true });
const { Client } = require("pg");

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  try {
    await pg.query("begin");
    if (process.argv.includes("--remove")) {
      const r = await pg.query(`delete from lga_apex_otp where dummy`);
      console.log(`Removed ${r.rowCount} DUMMY Apex marks.`);
    } else {
      const r = await pg.query(`
        insert into lga_apex_otp (lga_id, facility_id, dummy)
        select distinct on (f.lga_id) f.lga_id, f.id, true from facilities f
        where f.is_otp_site and f.facility_type = 'health_facility' and f.is_active and f.status = 'approved'
          and not exists (select 1 from lga_apex_otp a where a.lga_id = f.lga_id)
        order by f.lga_id,
          case when f.name ~* 'general hospital|comprehensive|cottage' then 0 when f.name ~* 'primary health' then 1 else 2 end, f.name`);
      console.log(`Marked ${r.rowCount} DUMMY Apex centres (one per LGA without one).`);
    }
    await pg.query("commit");
  } catch (e) {
    await pg.query("rollback");
    throw e;
  } finally {
    await pg.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
