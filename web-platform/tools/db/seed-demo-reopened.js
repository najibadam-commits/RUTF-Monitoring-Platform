// DUMMY reopened cases for the demo (DECISIONS R134): four Findings at "Action recorded" are reopened
// as a supervisor would at the follow-up visit (reject_and_reopen_issue, migration 0041) — status
// "reopened" and the same two history entries ("Final Verification — Not Resolved" with the reason,
// then "Issue Reopened"), by that LGA's DUMMY supervisor. They fill the Corrective Action Tracker's
// red Reopen case stage. Every note ends "(DUMMY)"; no notification is sent. Re-running changes
// nothing that's already reopened; --remove puts them back to "Action recorded" and deletes the two
// history entries (nothing else is touched).
//
//   node seed-demo-reopened.js            # reopen the four DUMMY cases
//   node seed-demo-reopened.js --remove   # undo
require("dotenv").config({ quiet: true });
const { Client } = require("pg");

const MARK = "(DUMMY)";
// Chosen for the demo story: Daura (the tracker's "Daura, past target only" step) and three other
// LGAs, one of each kind of Finding.
const CASES = [
  ["KT-DAU-MAO-OTP-26003", "Register at the follow-up visit still shows children given fewer sachets than prescribed in the last two weeks."],
  ["KT-KAT-KUU-OTP-26001", "Recount at the follow-up visit is still short of the ledger, and the stock card has not been updated."],
  ["KT-SAF-RUN-OTP-26003", "No signed waybill for the shortfall at the receiving site; the gap is still unexplained."],
  ["KT-ING-MAN-OTP-26001", "Re-supply was recorded, but the site ran out again the following week; the reorder level is unchanged."],
];
const DAY = 86_400_000;

(async () => {
  const remove = process.argv.includes("--remove");
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  try {
    await pg.query("begin");
    if (remove) {
      const { rows } = await pg.query(
        `select distinct issue_id from issue_history where action = 'Final Verification — Not Resolved' and note like $1`, [`%${MARK}`]);
      const ids = rows.map((r) => r.issue_id);
      const h = await pg.query(
        `delete from issue_history where issue_id = any($1) and action in ('Final Verification — Not Resolved', 'Issue Reopened') and note like $2`,
        [ids, `%${MARK}`]);
      const s = await pg.query(`update issues set status = 'resolved' where id = any($1) and status = 'reopened'`, [ids]);
      await pg.query("commit");
      console.log(`Put ${s.rowCount} DUMMY reopened cases back to "Action recorded" and removed ${h.rowCount} history entries.`);
      return;
    }

    let done = 0;
    for (const [i, [code, reason]] of CASES.entries()) {
      const { rows: [f] } = await pg.query(
        `select i.id, i.status, i.lga_id, d.name as dri from issues i left join profiles d on d.id = i.assigned_dri where i.code = $1`, [code]);
      if (!f) { console.log(`skip ${code}: not found`); continue; }
      if (f.status === "reopened") { console.log(`skip ${code}: already reopened`); continue; }
      if (f.status !== "resolved") { console.log(`skip ${code}: status is ${f.status}, not "Action recorded"`); continue; }
      // The LGA's DUMMY supervisor, as at the follow-up visit; any DUMMY supervisor otherwise.
      const { rows: [sup] } = await pg.query(
        `select p.id, p.name from profiles p
           left join supervisor_lgas s on s.profile_id = p.id and s.lga_id = $1
          where p.role = 'tpm_supervisor' and p.name like '%(DUMMY)%'
          order by (s.lga_id is null), p.name limit 1`, [f.lga_id]);
      const at = new Date(Date.now() - (i + 1) * DAY - 3 * 3_600_000); // over the last few days
      await pg.query(`update issues set status = 'reopened' where id = $1`, [f.id]);
      await pg.query(
        `insert into issue_history (issue_id, occurred_at, actor_id, actor_label, actor_role, action, note) values
           ($1, $2, $3, $4, 'tpm_supervisor', 'Final Verification — Not Resolved', $5),
           ($1, $2::timestamptz + interval '1 second', $3, $4, 'tpm_supervisor', 'Issue Reopened', $6)`,
        [f.id, at.toISOString(), sup?.id ?? null, sup?.name ?? "Supervisor (DUMMY)", `${reason} ${MARK}`,
         `Routed back to ${f.dri ?? "the assigned DRI"}. ${MARK}`]);
      console.log(`reopened ${code} (${sup?.name ?? "no supervisor found"})`);
      done += 1;
    }
    await pg.query("commit");
    console.log(`Reopened ${done} DUMMY cases. Undo: node seed-demo-reopened.js --remove`);
  } catch (e) {
    await pg.query("rollback").catch(() => {});
    throw e;
  } finally {
    await pg.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
