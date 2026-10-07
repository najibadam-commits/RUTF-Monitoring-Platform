// Pause the nightly Finding checks for a demo (DECISIONS R127). The DUMMY ledger stops at its last
// entry, so every night after that the checks flag each OTP site for "late reporting" in the new
// month — real behaviour, but noise in a demo. --pause stops only the nightly Findings job and
// removes the automatic Findings raised for periods after the last ledger entry (with their history,
// by cascade); nothing for earlier months is touched. --resume puts the nightly job back. The
// 06:00 sync digest and the checks run when a phone submits a count or receipt keep running.
//
//   node demo-pause-checks.js            # show the job and the Findings --pause would remove
//   node demo-pause-checks.js --pause    # before the demo
//   node demo-pause-checks.js --resume   # after the demo
require("dotenv").config({ quiet: true });
const { Client } = require("pg");

const JOB = "rutf-nightly-findings";
const SCHEDULE = "30 1 * * *"; // as migration 0102
const AFTER_LEDGER = `auto_generated and period_start > (select max(txn_date) from stock_transactions where status <> 'voided')`;

(async () => {
  const pause = process.argv.includes("--pause");
  const resume = process.argv.includes("--resume");
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  try {
    const job = async () => (await pg.query("select active from cron.job where jobname = $1", [JOB])).rows[0];
    const { rows: [last] } = await pg.query("select max(txn_date)::text d from stock_transactions where status <> 'voided'");

    if (resume) {
      if (!(await job())) await pg.query("select cron.schedule($1, $2, 'select public.evaluate_recent()')", [JOB, SCHEDULE]);
      console.log(`Nightly Finding checks back on (${SCHEDULE} UTC). The next run raises Findings for the months since ${last.d} again.`);
      return;
    }

    const { rows: byType } = await pg.query(
      `select finding_type, count(*)::int n from issues where ${AFTER_LEDGER} group by 1 order by 2 desc`);
    const total = byType.reduce((n, r) => n + r.n, 0);

    if (!pause) {
      console.log(`Nightly job "${JOB}": ${(await job()) ? "running" : "paused"}. Last ledger entry: ${last.d}.`);
      console.log(`Automatic Findings for periods after it (removed by --pause): ${total}`);
      if (total) console.table(byType);
      return;
    }

    await pg.query("begin");
    if (await job()) await pg.query("select cron.unschedule($1)", [JOB]);
    const del = await pg.query(`delete from issues where ${AFTER_LEDGER}`);
    await pg.query("commit");
    console.log(`Nightly Finding checks paused. Removed ${del.rowCount} automatic Findings for periods after ${last.d}.`);
    console.log("After the demo: node demo-pause-checks.js --resume");
  } catch (e) {
    await pg.query("rollback").catch(() => {});
    throw e;
  } finally {
    await pg.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
