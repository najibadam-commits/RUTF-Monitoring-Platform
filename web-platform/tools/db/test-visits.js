// M4 acceptance test for supervision visits (migration 0103, brief §11):
//   "VF Finding raised from seeded data" + both visit types end to end at the database level
//   (the on-device part is checked on a phone).
//
// Runs as real demo users (seed-demo-accounts.js) under their own JWT claims — inside ONE
// transaction that is always rolled back, on a throwaway LGA store -> OTP in the supervisors'
// LGAs. Nothing is left behind.
//
// Usage: node test-visits.js [--with-migration ../../supabase/migrations/0103_rutf_supervision.sql]
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const migIdx = process.argv.indexOf("--with-migration");
const migrationFile = migIdx > -1 ? process.argv[migIdx + 1] : null;
const results = [];
function check(what, expected, actual) {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ check: what, expected: JSON.stringify(expected), actual: JSON.stringify(actual), result: pass ? "PASS" : "FAIL" });
}

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const one = async (sql, params) => (await pg.query(sql, params)).rows[0];

  try {
    await pg.query("begin");
    if (migrationFile) await pg.query(fs.readFileSync(path.resolve(migrationFile), "utf8"));

    const user = async (email) => (await one(`select id from profiles where email = $1`, [email]))?.id;
    const U = {
      lst: await user("maryam.rabiu@rutf-demo.example"),     // LGA store officer
      otp: await user("safiya.isa@rutf-demo.example"),       // OTP in-charge
      otpSup: await user("hadiza.danjuma@rutf-demo.example"),// LGA Nutrition Officer (OTP sites)
      storeSup: await user("hadiza.kankia@rutf-demo.example"),// State officer (stores)
    };
    if (Object.values(U).some((v) => !v)) throw new Error("Demo accounts missing — run seed-demo-accounts.js first");
    const otpSupLga = (await one(`select lga_id from supervisor_lgas where profile_id = $1 limit 1`, [U.otpSup])).lga_id;
    const storeSupLga = (await one(`select lga_id from supervisor_lgas where profile_id = $1 limit 1`, [U.storeSup])).lga_id;
    const otherLga = (await one(`select id from lgas where id <> $1 and id not in (select lga_id from supervisor_lgas where profile_id = $2) limit 1`, [otpSupLga, U.storeSup])).id;
    const P = (await one(`select id from projects where name = 'Katsina RUTF Pilot'`)).id;
    const SST = (await one(`select id from facilities where facility_type = 'state_store' limit 1`)).id;

    // Throwaway facilities with coordinates (for the geofence).
    const fac = async (type, name, lga, supplier, otp, lat, lng) =>
      (await one(`insert into facilities (project_id, facility_type, name, lga_id, supplied_by_facility_id, is_otp_site, lat, lng)
                  values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [P, type, `VISIT TEST ${name}`, lga, supplier, otp, lat, lng])).id;
    const LST = await fac("lga_store", "LST", storeSupLga, SST, false, 11.5, 7.5);
    const OTP = await fac("health_facility", "OTP", otpSupLga, LST, true, 12.0, 7.6);
    const OTP_ELSEWHERE = await fac("health_facility", "OTP2", otherLga, LST, true, 12.1, 7.7);
    await pg.query(`update profiles set facility_id = $2 where id = $1`, [U.lst, LST]);
    await pg.query(`update profiles set facility_id = $2 where id = $1`, [U.otp, OTP]);

    const clearIdentity = () => pg.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`);
    async function as(userId, sql, params = []) {
      await pg.query("savepoint s");
      await pg.query("set local role authenticated");
      await pg.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
        [JSON.stringify({ sub: userId, role: "authenticated" }), userId]);
      try {
        const r = await pg.query(sql, params);
        await pg.query("reset role"); await pg.query("release savepoint s"); await clearIdentity();
        return { rows: r.rows };
      } catch (e) {
        await pg.query("rollback to savepoint s"); await pg.query("reset role"); await clearIdentity();
        return { error: e.message };
      }
    }
    const rpc = async (u, sql, params) => {
      const r = await as(u, sql, params);
      if (r.error) throw new Error(`${sql.slice(0, 50)}… -> ${r.error}`);
      return Object.values(r.rows[0])[0];
    };
    const J = (x) => JSON.stringify(x);

    // Stock and a week of recorded dispensing at the OTP: 7 days × 100 sachets = 700 recorded.
    await rpc(U.lst, `select record_receipt('VT-1', $1, current_date - 12, $2, null, 'GRN-VT')`, [LST, J([{ lot_no: "VISIT-TEST-LOT", expiry_date: "2027-12-31", quantity: 3000 }])]);
    const lot = (await one(`select id from product_lots where lot_no = 'VISIT-TEST-LOT'`)).id;
    const tr = await rpc(U.lst, `select record_issue('VT-2', $1, $2, current_date - 11, $3)`, [LST, OTP, J([{ lot_id: lot, quantity: 1500 }])]);
    await rpc(U.otp, `select record_receipt('VT-3', $1, current_date - 10, $2, $3)`, [OTP, J([{ lot_id: lot, quantity: 1500 }]), tr.transfer_id]);
    for (let d = 8; d >= 2; d--) await rpc(U.otp, `select record_dispensing('VT-D${d}', $1, current_date - ${d}, 1, 10, 100, 100)`, [OTP]);

    // 1. OTP verification: the register shows 875 dispensed vs 700 in the app -> VF 1.25.
    const visitArgs = [OTP, J([{ lot_id: lot, physical_count: 800 }]), J({ register_present: true, admissions_counted: 7, sachets_dispensed_counted: 875 })];
    const visitSql = `select record_visit('VT-V1', 'otp_verification', $1, current_date, 12.0005, 7.6005, 8, $2, $3, current_date - 8, current_date - 2, 'test-device')`;
    const v1 = await rpc(U.otpSup, visitSql, visitArgs);
    check("OTP verification recorded with the app's dispensing for the period", 700, v1.sachets_dispensed_recorded);
    const vf = (await pg.query(`select * from issues where visit_id = $1 and finding_type = 'dispensing_gap'`, [v1.visit_id])).rows;
    check("VF outside 0.90–1.10 raises exactly one dispensing_gap Finding", 1, vf.length);
    check("…in review, VF 1.25", "pending_review/1.25", vf[0] ? `${vf[0].status}/${Number(vf[0].metric.vf)}` : null);
    check("supervisor count against the ledger (800 vs 800) raises no variance", 0,
      Number((await one(`select count(*) n from issues where visit_id = $1 and finding_type = 'stock_variance'`, [v1.visit_id])).n));
    check("visit within 150 m is not flagged", false, v1.outside_geofence);

    // 2. Retried sync -> same visit, nothing new.
    const again = await rpc(U.otpSup, visitSql, visitArgs);
    check("retried sync returns the same visit, marked duplicate", `${v1.visit_id}/true`, `${again.visit_id}/${again.duplicate}`);
    check("still one visit and one VF Finding", "1/1", `${(await one(`select count(*) n from monitoring_visits where local_id = 'VT-V1'`)).n}/${(await one(`select count(*) n from issues where finding_type = 'dispensing_gap' and facility_id = $1`, [OTP])).n}`);

    // 3. Store check at the LGA store, ~1 km from its point, with checklist problems.
    const v2 = await rpc(U.storeSup, `select record_visit('VT-V2', 'store_check', $1, current_date, 11.509, 7.5, 12, $2, $3, null, null, 'test-device')`,
      [LST, J([{ lot_id: lot, physical_count: 1300, expired_count: 0 }]), J({ stock_card_present: false, storage_dry: true, storage_off_floor: false, pests_seen: false })]);
    const types = (await pg.query(`select finding_type from issues where visit_id = $1 order by 1`, [v2.visit_id])).rows.map((r) => r.finding_type);
    check("store check: 1,300 counted vs 1,500 ledger (13%) + no stock card + stock on the floor", ["no_stock_card", "poor_storage", "stock_variance"], types);
    check("visit ~1 km away flagged outside the geofence", true, v2.outside_geofence);

    // 4. Who may record visits.
    const denied = async (u, sql, params) => ((await as(u, sql, params)).error ? "denied" : "allowed");
    check("LGA supervisor at an OTP outside their LGA", "denied", await denied(U.otpSup,
      `select record_visit('VT-X1', 'otp_verification', $1, current_date, 12.1, 7.7, 5, '[]', '{"register_present": true}', current_date - 7, current_date, 'd')`, [OTP_ELSEWHERE]));
    check("OTP supervisor doing a store check", "denied", await denied(U.otpSup,
      `select record_visit('VT-X2', 'store_check', $1, current_date, 11.5, 7.5, 5, '[]', '{"stock_card_present": true}', null, null, 'd')`, [LST]));
    check("facility user recording a visit to their own facility", "denied", await denied(U.otp,
      `select record_visit('VT-X3', 'otp_verification', $1, current_date, 12.0, 7.6, 5, '[]', '{"register_present": true}', current_date - 7, current_date, 'd')`, [OTP]));
    check("store check typed at an OTP site", "denied", await denied(U.storeSup,
      `select record_visit('VT-X4', 'store_check', $1, current_date, 12.0, 7.6, 5, '[]', '{"stock_card_present": true}', null, null, 'd')`, [OTP]));
    check("visit dated in the future", "denied", await denied(U.otpSup,
      `select record_visit('VT-X5', 'otp_verification', $1, current_date + 1, 12.0, 7.6, 5, '[]', '{"register_present": true}', current_date - 7, current_date, 'd')`, [OTP]));

    // 5. Adjustment confirmation: the OTP's count was 5 short -> adjustment pending.
    await rpc(U.otp, `select record_stock_count('VT-C1', $1, current_date - 1, $2)`, [OTP, J([{ lot_id: lot, physical_count: 795 }])]);
    const adj = (await one(`select id from stock_transactions where submission_local_id = 'VT-C1' and txn_type = 'adjustment'`)).id;
    check("supervisor from another LGA confirming it", "denied", await denied(U.storeSup, `select confirm_adjustment($1, 'ok')`, [adj]));
    check("facility user confirming their own adjustment", "denied", await denied(U.otp, `select confirm_adjustment($1, 'ok')`, [adj]));
    await rpc(U.otpSup, `select confirm_adjustment($1, 'Recounted with the OTP in-charge')`, [adj]);
    const conf = await one(`select status, confirmed_by, confirmation_note from stock_transactions where id = $1`, [adj]);
    check("the OTP's own supervisor confirms it", `confirmed/${U.otpSup}`, `${conf.status}/${conf.confirmed_by}`);
    check("confirming again (retried sync) is harmless", "allowed", await denied(U.otpSup, `select confirm_adjustment($1, null)`, [adj]));

    // 6. Who sees the visit.
    const seen = async (u) => (await as(u, `select count(*)::int n from monitoring_visits where id = $1`, [v1.visit_id])).rows[0].n;
    check("the OTP's facility user sees the visit to their facility", 1, await seen(U.otp));
    // The LGA Nutrition Officer sees the records of the OTP sites in their LGA (0134, R169).
    check("the LGA Nutrition Officer sees it too (an OTP site in their LGA)", 1, await seen(U.lst));
    check("history says the Finding came from a supervision visit", true,
      /supervision visit/.test((await one(`select note from issue_history where issue_id = $1`, [vf[0]?.id]))?.note ?? ""));
  } finally {
    await pg.query("rollback").catch(() => {});
    await pg.end();
  }

  console.table(results);
  const failed = results.filter((r) => r.result === "FAIL").length;
  console.log(`\n${results.length - failed}/${results.length} passed.`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
