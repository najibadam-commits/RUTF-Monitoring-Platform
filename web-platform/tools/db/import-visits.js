// Loads the dummy supervision visits (DECISIONS R2) into the 0103 tables and runs the visit-based
// Finding rules on each:
//   data/dummy/monitoring_visits.csv -> monitoring_visits
//   data/dummy/stock_check_lines.csv -> stock_check_lines   (system_balance as in the file)
//   data/dummy/store_checks.csv      -> store_checks
//   data/dummy/otp_verifications.csv -> otp_verifications
// Needs the demo accounts (seed-demo-accounts.js) for supervisor_id. Re-runnable: rows keep their
// CSV ids (ON CONFLICT DO NOTHING) and the rules never raise the same Finding twice.
//
// Usage: node import-visits.js [--dry-run] [--with-migration <file.sql>]
//   --dry-run          everything in one transaction that is rolled back; prints what it would raise
//   --with-migration   applies that migration first, inside the same transaction (with --dry-run)
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const DATA_DIR = path.join(__dirname, "..", "..", "..", "data", "dummy");
const read = (f) => parse(fs.readFileSync(path.join(DATA_DIR, f)), { columns: true, skip_empty_lines: true });
const blank = (s) => ((s ?? "").trim() === "" ? null : s.trim());
const bool = (s) => (blank(s) === null ? null : /^true$/i.test(s));
const int = (s) => (blank(s) === null ? null : Number(s));
const dryRun = process.argv.includes("--dry-run");
const migIdx = process.argv.indexOf("--with-migration");
const migrationFile = migIdx > -1 ? process.argv[migIdx + 1] : null;

async function insertAll(client, table, rows, conflict = "id") {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  let n = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const params = [];
    const tuples = rows.slice(i, i + 400).map((r) => `(${cols.map((c) => { params.push(r[c]); return `$${params.length}`; }).join(",")})`);
    n += (await client.query(`insert into ${table} (${cols.join(",")}) values ${tuples.join(",")} on conflict (${conflict}) do nothing`, params)).rowCount;
  }
  return n;
}

(async () => {
  const visits = read("monitoring_visits.csv");
  const lines = read("stock_check_lines.csv");
  const stores = read("store_checks.csv");
  const otps = read("otp_verifications.csv");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");
    if (migrationFile) await client.query(fs.readFileSync(path.resolve(migrationFile), "utf8"));

    const profileByEmail = new Map((await client.query("select id, email from profiles")).rows.map((r) => [r.email.toLowerCase(), r.id]));
    const projectByFacility = new Map((await client.query("select id, project_id from facilities")).rows.map((r) => [r.id, r.project_id]));
    const geofence = Number((await client.query("select value from rutf_thresholds where key = 'geofence_m' limit 1")).rows[0]?.value ?? 150);

    const missing = visits.filter((v) => !profileByEmail.has(v.supervisor_email.toLowerCase()));
    if (missing.length) throw new Error(`No profile for supervisor ${missing[0].supervisor_email} — run seed-demo-accounts.js first`);

    const nV = await insertAll(client, "monitoring_visits", visits.map((v) => ({
      id: v.id, code: v.code, project_id: projectByFacility.get(v.facility_id), visit_type: v.visit_type, facility_id: v.facility_id,
      supervisor_id: profileByEmail.get(v.supervisor_email.toLowerCase()), visit_date: v.visit_date,
      period_start: blank(v.period_start), period_end: blank(v.period_end), lat: Number(v.lat), lng: Number(v.lng),
      gps_accuracy_m: int(v.gps_accuracy_m), distance_to_facility_m: int(v.distance_to_facility_m),
      outside_geofence: int(v.distance_to_facility_m) > geofence, device_id: v.device_id, local_id: v.local_id, status: v.status,
    })));
    // stock_check_lines has no id in the file — skip visits whose lines are already loaded.
    const loaded = new Set((await client.query("select distinct visit_id from stock_check_lines")).rows.map((r) => r.visit_id));
    const nL = await insertAll(client, "stock_check_lines", lines.filter((l) => !loaded.has(l.visit_id)).map((l) => ({
      visit_id: l.visit_id, lot_id: blank(l.lot_id), lot_no_seen: blank(l.lot_no_seen), expiry_seen: blank(l.expiry_seen),
      stock_card_balance: int(l.stock_card_balance), system_balance: int(l.system_balance), physical_count: int(l.physical_count),
      damaged_count: int(l.damaged_count) ?? 0, expired_count: int(l.expired_count) ?? 0,
    })), "id");
    const nS = await insertAll(client, "store_checks", stores.map((s) => ({
      visit_id: s.visit_id, stock_card_present: bool(s.stock_card_present), stock_card_up_to_date: bool(s.stock_card_up_to_date),
      storage_dry: bool(s.storage_dry), storage_off_floor: bool(s.storage_off_floor), storage_ventilated: bool(s.storage_ventilated),
      pests_seen: bool(s.pests_seen), fefo_followed: bool(s.fefo_followed), notes: blank(s.notes),
    })), "visit_id");
    const nO = await insertAll(client, "otp_verifications", otps.map((o) => ({
      visit_id: o.visit_id, register_present: bool(o.register_present), admissions_counted: int(o.admissions_counted),
      sachets_dispensed_counted: int(o.sachets_dispensed_counted), admissions_recorded: int(o.admissions_recorded),
      sachets_dispensed_recorded: int(o.sachets_dispensed_recorded), notes: blank(o.notes),
    })), "visit_id");
    // Keep generated codes clear of the dummy ones' numbers.
    await client.query("select setval('visit_code_seq', greatest((select count(*) from monitoring_visits), 1))");

    let raised = 0;
    for (const v of visits) raised += (await client.query("select evaluate_visit_internal($1) n", [v.id])).rows[0].n;

    console.log(`Visits ${nV}, count lines ${nL}, store checks ${nS}, OTP verifications ${nO}; Findings raised ${raised}.`);
    console.table((await client.query(`
      select finding_type, count(*)::int findings from issues where visit_id is not null group by 1 order by 1`)).rows);
    console.log("Visits outside the geofence:", (await client.query("select count(*)::int n from monitoring_visits where outside_geofence")).rows[0].n);

    await client.query(dryRun ? "rollback" : "commit");
    if (dryRun) console.log("\n(dry run — rolled back)");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.error("\n❌ Import failed, rolled back:", e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
