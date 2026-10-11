// Tests for automatic deletion at the end of retention (migration 0141, DECISIONS R177): each
// rule deletes what is past its period and nothing newer; photo files are queued for the Storage
// API; "report" mode and the dry run delete nothing; only the Super Admin runs or changes it.
//
// Runs in ONE transaction that is always rolled back (records are back-dated inside it): nothing
// is left behind, and no file is deleted (pg_net only sends after a commit).
//
//   node test-retention.js
require("dotenv").config({ quiet: true });
const { Client } = require("pg");

const results = [];
const check = (area, what, expected, actual) => {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ area, what, expected: JSON.stringify(expected), actual: JSON.stringify(actual), result: pass ? "PASS" : "FAIL" });
};
const has = (v, s) => JSON.stringify(v).includes(s);

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const one = async (sql, p = []) => (await pg.query(sql, p)).rows[0];
  try {
    await pg.query("begin");
    const admin = await one(`select id from profiles where role = 'super_admin' and status = 'active' limit 1`);
    const coordinator = await one(`select id from profiles where role = 'state_coordinator' and status = 'active' limit 1`);
    async function as(userId, fn) {
      await pg.query("savepoint ctx");
      await pg.query("set local role authenticated");
      await pg.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: "authenticated" })]);
      try { return await fn(); } finally { await pg.query("reset role"); await pg.query("release savepoint ctx"); }
    }
    async function call(sql, params = []) {
      await pg.query("savepoint a");
      try { const r = (await pg.query(sql, params)).rows[0]; await pg.query("release savepoint a"); return r ? Object.values(r)[0] : null; }
      catch (e) { await pg.query("rollback to savepoint a"); await pg.query("release savepoint a"); return "error: " + e.message; }
    }

    // ── Back-date some records past their periods (rolled back) ──
    // Two discharged children: one 3 years ago (due), one last month (not due).
    const kids = (await pg.query(`select c.id, c.child_code from otp_children c join otp_child_identity i on i.child_id = c.id order by c.child_code limit 2`)).rows;
    for (const [k, daysAgo] of [[kids[0], 1100], [kids[1], 30]]) {
      await pg.query(`update otp_admissions set status = 'closed', outcome = 'cured', outcome_on = current_date - $2::int where child_id = $1`, [k.id, daysAgo]);
    }
    // An RUTF photo from a visit 2 years ago; one recent.
    const photos = (await pg.query(`select p.id, p.visit_id, p.storage_path from otp_visit_photos p order by p.uploaded_at limit 2`)).rows;
    await pg.query(`update otp_visits set visit_on = current_date - 800 where id = $1`, [photos[0].visit_id]);
    await pg.query(`update otp_visits set visit_on = current_date - 3 where id = $1 and id <> $2`, [photos[1].visit_id, photos[0].visit_id]);
    // Access log: one 3 years old.
    await pg.query(`insert into otp_access_log (at, actor, child_id, action) values (now() - interval '1100 days', $1, $2, 'lookup')`, [admin.id, kids[0].id]);
    // A sync error resolved a year ago, one resolved yesterday.
    for (const [lid, days] of [["RET-TEST-OLD", 365], ["RET-TEST-NEW", 1]]) {
      await pg.query(`insert into sync_failures (device_id, profile_id, local_id, error, resolved_at) values ('RET-TEST', $1, $2, 'x', now() - make_interval(days => $3::int))`, [admin.id, lid, days]);
    }

    // ── Who may ──
    await as(coordinator.id, async () => {
      check("access", "a State Coordinator cannot see retention", true, has(await call(`select retention_overview()`), "Only the Super Admin"));
      check("access", "nor run it", true, has(await call(`select retention_run(false)`), "Only the Super Admin"));
      check("access", "nor change a rule", true, has(await call(`select retention_set_mode('selfies', 'off')`), "Only the Super Admin"));
    });

    // ── Preview (dry run) ──
    let ov;
    await as(admin.id, async () => {
      ov = await call(`select retention_overview()`);
      const due = Object.fromEntries(ov.rules.map((r) => [r.key, Number(r.due_rows)]));
      check("due", "one child's details are due", 1, due.child_identity);
      check("due", "one RUTF photo is due", 1, due.otp_rutf_photos);
      check("due", "one access-log row is due", true, due.otp_access_log >= 1);
      check("due", "one sync error is due", 1, due.sync_failures);
      const dry = await call(`select retention_run(true)`);
      check("dry run", "a preview deletes nothing", 0, Object.values(dry).reduce((a, r) => a + (r.deleted || 0), 0));
    });
    check("dry run", "the details are still there", 1, Number((await one(`select count(*) n from otp_child_identity where child_id = $1`, [kids[0].id])).n));

    // ── "Report" mode for one rule ──
    await as(admin.id, async () => { await call(`select retention_set_mode('sync_failures', 'report')`); });

    // ── The run ──
    let run;
    await as(admin.id, async () => { run = await call(`select retention_run(false)`); });
    check("identity", "the old child's details are deleted", 0, Number((await one(`select count(*) n from otp_child_identity where child_id = $1`, [kids[0].id])).n));
    check("identity", "the Child ID and clinical record stay", 1, Number((await one(`select count(*) n from otp_children c join otp_admissions a on a.child_id = c.id where c.id = $1`, [kids[0].id])).n));
    check("identity", "marked with the date", true, !!(await one(`select identity_removed_on d from otp_children where id = $1`, [kids[0].id])).d);
    check("identity", "a child discharged last month keeps the details", 1, Number((await one(`select count(*) n from otp_child_identity where child_id = $1`, [kids[1].id])).n));
    check("photos", "the old RUTF photo row is gone", 0, Number((await one(`select count(*) n from otp_visit_photos where id = $1`, [photos[0].id])).n));
    check("photos", "and its file is queued for the Storage API", 1, Number((await one(`select count(*) n from retention_file_queue where bucket = 'otp-rutf-evidence' and path = $1`, [photos[0].storage_path])).n));
    check("photos", "a recent photo stays", 1, Number((await one(`select count(*) n from otp_visit_photos where id = $1`, [photos[1].id])).n));
    check("access log", "rows older than 2 years are gone", 0, Number((await one(`select count(*) n from otp_access_log where at < now() - interval '730 days'`)).n));
    check("report mode", "a rule in report mode deletes nothing", 2, Number((await one(`select count(*) n from sync_failures where device_id = 'RET-TEST'`)).n));
    check("report mode", "but reports what is due", 1, run.sync_failures.due);
    check("files", "without the storage key, files wait in the queue", true, has(run.files, "not stored yet"));
    check("record", "the run is recorded, with counts and no values", true,
      !!(await one(`select 1 x from retention_runs where not dry_run and results ? 'child_identity'`)) && !has(run, kids[0].child_code));

    // ── With the key stored (fake, rolled back), files are sent to the Storage API ──
    await pg.query(`select vault.create_secret('http://127.0.0.1:9', 'retention_supabase_url'), vault.create_secret('test-key', 'retention_service_key')`);
    const sent = await one(`select retention_delete_files() r`);
    check("files", "with the key, the queued files are sent for deletion", true, sent.r.sent >= 1);
    check("files", "each send is tracked", true, Number((await one(`select count(*) n from retention_file_queue where request_id is not null`)).n) >= 1);
    check("schedule", "the daily job is scheduled", 1, Number((await one(`select count(*) n from cron.job where jobname = 'rutf-retention'`)).n));
  } finally {
    await pg.query("rollback");
    await pg.end();
  }
  console.table(results);
  const failed = results.filter((r) => r.result === "FAIL").length;
  console.log(`${results.length - failed}/${results.length} passed (rolled back: nothing was saved, no file deleted)`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
