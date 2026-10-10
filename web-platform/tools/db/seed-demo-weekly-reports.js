// DUMMY weekly OTP reports for the demo (DECISIONS R148): last week's report for 20 OTP sites,
// prepared and submitted by each site's DUMMY OTP Officer through the real functions
// (otp_report_open, otp_report_submit — every flagged issue explained), then the DUMMY State
// Coordinator approves 12 and returns 2 with a note; the rest wait for review, and every other
// OTP site shows as not submitted. Explanations and notes end "(DUMMY)".
// --remove deletes the reports, their versions and the weekly-report notifications they raised.
//
//   node seed-demo-weekly-reports.js
//   node seed-demo-weekly-reports.js --remove
require("dotenv").config({ quiet: true });
const { Client } = require("pg");

const SITES = 20, APPROVE = 12, RETURN = 2;

(async () => {
  const remove = process.argv.includes("--remove");
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  try {
    await pg.query("begin");
    if (remove) {
      const reps = (await pg.query(`select distinct r.id from otp_weekly_reports r join otp_weekly_report_versions v on v.report_id = r.id
        where v.comments::text like '%(DUMMY)%'`)).rows.map((x) => x.id);
      const v = await pg.query(`delete from otp_weekly_report_versions where report_id = any($1)`, [reps]);
      const r = await pg.query(`delete from otp_weekly_reports where id = any($1)`, [reps]);
      const n = await pg.query(`delete from notifications where type = 'weekly_report' and user_id in (select id from profiles where name like '%(DUMMY)%')`);
      await pg.query("commit");
      console.log(`Removed ${r.rowCount} DUMMY weekly reports, ${v.rowCount} versions, ${n.rowCount} notifications.`);
      return;
    }
    const week = (await pg.query(`select lower(otp_week_of(current_date - 7))::text w`)).rows[0].w;
    const officers = (await pg.query(`
      select distinct on (f.id) p.id, f.id facility, f.name from profiles p join facilities f on f.id = p.facility_id
      where p.role = 'dri' and p.status = 'active' and p.name like '%(DUMMY)%' and f.facility_type = 'health_facility' and f.is_otp_site and f.is_active
        and not exists (select 1 from otp_weekly_reports r where r.facility_id = f.id and r.week_start = $2::date)
      order by f.id, p.name limit $1`, [SITES, week])).rows;
    const as = async (id) => {
      await pg.query("set local role authenticated");
      await pg.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: id, role: "authenticated" }), id]);
    };
    const ids = [];
    for (const o of officers) {
      await as(o.id);
      const rep = (await pg.query(`select otp_report_open($1::date) r`, [week])).rows[0].r;
      const comments = { general: "Week reviewed against the OTP register and stock card (DUMMY)" };
      for (const i of rep.issues.filter((x) => x.severity === "blocking")) {
        comments[i.code] = i.code.includes("count") ? "Recounted at the end of the week; the difference was a damaged carton not yet recorded as a loss (DUMMY)"
          : "Checked with the register: explained (DUMMY)";
      }
      await pg.query(`select otp_report_submit($1, $2::jsonb, true)`, [rep.report_id, JSON.stringify(comments)]);
      ids.push(rep.report_id);
      await pg.query("reset role");
    }
    const sc = (await pg.query(`select p.id from profiles p join facilities f on f.state_id = p.managed_state_id
      where p.role = 'state_coordinator' and p.status = 'active' and p.name like '%(DUMMY)%' and f.id = $1 order by p.name limit 1`, [officers[0]?.facility])).rows[0];
    if (sc) {
      await as(sc.id);
      for (const [k, id] of ids.entries()) {
        if (k < APPROVE) await pg.query(`select otp_report_decide($1, 'approved', 'Figures and stock reconcile (DUMMY)')`, [id]);
        else if (k < APPROVE + RETURN) await pg.query(`select otp_report_decide($1, 'returned', 'Please recount the RUTF stock and record the damaged carton as a loss before resubmitting (DUMMY)')`, [id]);
      }
      await pg.query("reset role");
    }
    await pg.query("commit");
    console.log(`Week of ${week}: ${ids.length} DUMMY reports submitted; ${Math.min(APPROVE, ids.length)} approved, ${Math.max(0, Math.min(RETURN, ids.length - APPROVE))} returned, the rest waiting.`);
    console.log("Undo: node seed-demo-weekly-reports.js --remove");
  } catch (e) {
    await pg.query("rollback").catch(() => {});
    throw e;
  } finally {
    await pg.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
