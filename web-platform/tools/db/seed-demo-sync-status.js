// DUMMY phone sync reports for the demo (DECISIONS R119): every DUMMY facility user and supervisor
// gets a phone that reported recently, so Offline Sync Health looks like a running pilot — most
// syncing well, a few with records waiting, not syncing, or failing (with the failing submission).
// Every device id starts "DUMMY-"; re-running replaces them, and --remove deletes them (nothing else
// is touched). Reports age: after `sync_stale_days` (3) a phone counts as "not syncing", so re-run
// this shortly before a demo. The 06:00 UTC digest posts an in-app notice to administrators while
// any DUMMY phone is waiting, failing or not syncing (no email).
//
//   node seed-demo-sync-status.js            # add (or refresh) the DUMMY phone reports
//   node seed-demo-sync-status.js --remove   # delete them
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const crypto = require("crypto");

const PREFIX = "DUMMY-";
const HOUR = 3_600_000;
const MODELS = ["Samsung Galaxy A14", "Tecno Spark 10", "Infinix Hot 30", "Samsung Galaxy A05", "itel A70", "Tecno Pop 7"];
const ERRORS = [
  ["ReceiveStock", "Transfer not found for this receipt — the issuing store's record has not arrived yet"],
  ["StockCount", "Count date is in the future — check the phone's date setting"],
  ["DailyDispensing", "Facility not in your scope — ask your administrator to check your facility"],
];

/** A stable 0–1 number per person, so a re-run gives everyone the same kind of phone. */
const draw = (id, salt) => parseInt(crypto.createHash("sha1").update(id + salt).digest("hex").slice(0, 8), 16) / 0xffffffff;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

(async () => {
  const remove = process.argv.includes("--remove");
  const pg = new Client({ connectionString: process.env.DATABASE_URL, keepAlive: true });
  await pg.connect();
  try {
    await pg.query("begin");
    const f = await pg.query("delete from sync_failures where device_id like $1", [`${PREFIX}%`]);
    const d = await pg.query("delete from device_sync_status where device_id like $1", [`${PREFIX}%`]);
    if (remove) {
      await pg.query("commit");
      console.log(`Removed ${d.rowCount} DUMMY phone reports and ${f.rowCount} DUMMY sync failures.`);
      return;
    }

    const { rows: people } = await pg.query(
      `select id, project_id, facility_id from profiles
       where role in ('dri', 'tpm_supervisor') and status = 'active' and name like '%(DUMMY)%'`,
    );
    const tally = { ok: 0, stuck: 0, not_syncing: 0, failing: 0 };
    for (const p of people) {
      const r = draw(p.id, "status");
      const kind = r < 0.86 ? "ok" : r < 0.93 ? "stuck" : r < 0.97 ? "not_syncing" : "failing";
      tally[kind] += 1;
      const device = `${PREFIX}${p.id.slice(0, 8)}`;
      const version = draw(p.id, "version") < 0.85 ? "1.1" : "1.0";
      const model = MODELS[Math.floor(draw(p.id, "model") * MODELS.length)];
      const reportedAt = kind === "not_syncing" ? ago((4 + draw(p.id, "age") * 3) * 24 * HOUR) : ago((0.2 + draw(p.id, "age") * 18) * HOUR);
      const pending = kind === "stuck" ? 2 + Math.floor(draw(p.id, "pending") * 4) : kind === "failing" ? 1 : 0;
      const oldest = kind === "stuck" ? ago((30 + draw(p.id, "oldest") * 30) * HOUR) : kind === "failing" ? ago(40 * HOUR) : null;
      const error = kind === "failing" ? ERRORS[Math.floor(draw(p.id, "error") * ERRORS.length)] : null;
      await pg.query(
        `insert into device_sync_status (device_id, profile_id, project_id, facility_id, app_version, device_model, os_version,
           last_report_at, last_success_at, pending_count, failed_count, oldest_pending_at, last_error)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [device, p.id, p.project_id, p.facility_id, version, model, "Android 13",
          reportedAt, kind === "not_syncing" ? reportedAt : reportedAt, pending, kind === "failing" ? 1 : 0, oldest, error ? error[1] : null],
      );
      if (error) {
        await pg.query(
          `insert into sync_failures (device_id, profile_id, project_id, local_id, submission_type, error, attempts, queued_at, first_seen_at, last_seen_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`,
          [device, p.id, p.project_id, `${PREFIX}${crypto.randomUUID()}`, error[0], error[1], 4 + Math.floor(draw(p.id, "attempts") * 6), oldest, reportedAt],
        );
      }
    }
    await pg.query("commit");
    console.log(`Added ${people.length} DUMMY phone reports (replaced ${d.rowCount}):`, tally);
  } catch (e) {
    await pg.query("rollback").catch(() => {});
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await pg.end();
  }
})();
