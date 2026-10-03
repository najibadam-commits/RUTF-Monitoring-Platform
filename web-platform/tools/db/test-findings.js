// M3 acceptance test for auto-Findings (migration 0102, brief §11):
//   "Seeded 7% month-end variance raises exactly one stock_variance Finding into review;
//    a short receipt raises one transfer_mismatch."
//
// Records through the real record_* functions as demo facility users (seed-demo-accounts.js), so
// the on-sync check fires exactly as it would from a phone — inside ONE transaction that is always
// rolled back, on a throwaway LGA store -> OTP chain. Nothing is left behind.
//
// Usage: node test-findings.js [--with-migration ../../supabase/migrations/0102_rutf_findings.sql]
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
      lst: await user("maryam.rabiu@rutf-demo.example"),
      otp: await user("safiya.isa@rutf-demo.example"),
      sc: await user("umar.isa@rutf-demo.example"),
    };
    if (Object.values(U).some((v) => !v)) throw new Error("Demo accounts missing — run seed-demo-accounts.js first");

    const lga = (await one(`select id from lgas limit 1`)).id;
    const P = (await one(`select id from projects where name = 'Katsina RUTF Pilot'`)).id;
    const fac = async (type, name, supplier, otp = false) =>
      (await one(`insert into facilities (project_id, facility_type, name, lga_id, supplied_by_facility_id, is_otp_site)
                  values ($1,$2,$3,$4,$5,$6) returning id`, [P, type, `FINDINGS TEST ${name}`, lga, supplier, otp])).id;
    const SST = (await one(`select id from facilities where facility_type = 'state_store' limit 1`)).id;
    const LST = await fac("lga_store", "LST", SST);
    const OTP = await fac("health_facility", "OTP", LST, true);
    const OTP2 = await fac("health_facility", "OTP2", LST, true);
    await pg.query(`update profiles set facility_id = $2 where id = $1`, [U.lst, LST]);
    await pg.query(`update profiles set facility_id = $2 where id = $1`, [U.otp, OTP]);

    // JWT claims set with set_config(..., true) last until the transaction ends, so they are
    // cleared after every call — otherwise later "direct connection" calls would act as that user.
    const clearIdentity = () => pg.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`);
    async function as(userId, sql, params = []) {
      await pg.query("savepoint s");
      await pg.query("set local role authenticated");
      await pg.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
        [JSON.stringify({ sub: userId, role: "authenticated" }), userId]);
      try {
        const r = await pg.query(sql, params);
        await pg.query("reset role"); await pg.query("release savepoint s"); await clearIdentity();
        return r.rows;
      } catch (e) {
        await pg.query("rollback to savepoint s"); await pg.query("reset role"); await clearIdentity();
        throw e;
      }
    }
    const lines = (arr) => JSON.stringify(arr);
    const findings = async (type, facility) =>
      (await pg.query(`select * from issues where finding_type = $1 and facility_id = $2`, [type, facility])).rows;

    // Stock: the LGA store gets 2,000 from a supplier, issues 1,000 to the OTP, which receives it all.
    await as(U.lst, `select record_receipt('FT-1', $1, current_date - 3, $2, null, 'GRN-FT')`,
      [LST, lines([{ lot_no: "FINDINGS-TEST-LOT", expiry_date: "2027-12-31", quantity: 2000 }])]);
    const lot = (await one(`select id from product_lots where lot_no = 'FINDINGS-TEST-LOT'`)).id;
    const issue1 = (await as(U.lst, `select record_issue('FT-2', $1, $2, current_date - 2, $3) r`, [LST, OTP, lines([{ lot_id: lot, quantity: 1000 }])]))[0].r;
    await as(U.otp, `select record_receipt('FT-3', $1, current_date - 1, $2, $3)`, [OTP, lines([{ lot_id: lot, quantity: 1000 }]), issue1.transfer_id]);

    // 1. Month-end count 7% below the ledger (930 of 1,000) — checked on sync.
    await as(U.otp, `select record_stock_count('FT-4', $1, current_date, $2)`, [OTP, lines([{ lot_id: lot, physical_count: 930 }])]);
    let sv = await findings("stock_variance", OTP);
    check("7% count variance raises exactly one stock_variance Finding", 1, sv.length);
    check("…into review (pending_review, auto-generated)", "pending_review/true", sv[0] ? `${sv[0].status}/${sv[0].auto_generated}` : null);
    check("…with the measured variance and limit", { variance_pct: 7, threshold: 5 }, sv[0] ? { variance_pct: Number(sv[0].metric.variance_pct), threshold: Number(sv[0].metric.threshold) } : null);
    check("…filed under the facility's level (OTP)", "OTP", (await one(`select c.abbr from issues i join categories c on c.id = i.category_id where i.id = $1`, [sv[0]?.id]))?.abbr);
    check("…with a structured Finding ID (STATE-LGA-WARD-LEVEL-YYNNN, migration 0118)", true, /^[A-Z]{2,3}-[A-Z]{3}-[A-Z]{3}-OTP-\d{5,}$/.test(sv[0]?.code ?? ""));

    // 2. Re-running the checks (nightly job, a retried sync) never duplicates.
    const month = await one(`select date_trunc('month', current_date)::date s, (date_trunc('month', current_date) + interval '1 month - 1 day')::date e`);
    await pg.query(`select evaluate_facility_period($1, $2, $3)`, [OTP, month.s, month.e]);
    await pg.query(`select evaluate_all_facilities($1, $2)`, [month.s, month.e]);
    await as(U.otp, `select record_stock_count('FT-4', $1, current_date, $2)`, [OTP, lines([{ lot_id: lot, physical_count: 930 }])]); // retried sync
    sv = await findings("stock_variance", OTP);
    check("re-running checks and a retried sync: still one stock_variance", 1, sv.length);

    // 3. A count within the limit (3%) raises nothing. (OTP2 gets stock first.)
    const issue2 = (await as(U.lst, `select record_issue('FT-5', $1, $2, current_date - 2, $3) r`, [LST, OTP2, lines([{ lot_id: lot, quantity: 500 }])]))[0].r;
    await pg.query(`update profiles set facility_id = $2 where id = $1`, [U.otp, OTP2]);
    // 4. …and OTP2 receives the transfer 10 short.
    await as(U.otp, `select record_receipt('FT-6', $1, current_date - 1, $2, $3)`, [OTP2, lines([{ lot_id: lot, quantity: 490 }]), issue2.transfer_id]);
    const tm = await findings("transfer_mismatch", OTP2);
    check("short receipt raises exactly one transfer_mismatch Finding", 1, tm.length);
    check("…linked to the transfer, with the gap", { transfer: issue2.transfer_id, gap: 10 }, tm[0] ? { transfer: tm[0].transfer_id, gap: Number(tm[0].metric.gap) } : null);
    await as(U.otp, `select record_stock_count('FT-7', $1, current_date, $2)`, [OTP2, lines([{ lot_id: lot, physical_count: 475 }])]); // 490 ledger, 3.1% short
    check("3% count difference raises no stock_variance", 0, (await findings("stock_variance", OTP2)).length);
    await pg.query(`select evaluate_facility_period($1, $2, $3)`, [OTP2, month.s, month.e]);
    check("re-run: still one transfer_mismatch", 1, (await findings("transfer_mismatch", OTP2)).length);

    // 5. The reviewer sees them; a facility user can't run the checks.
    await pg.query(`update profiles set managed_state_id = (select state_id from facilities where id = $2) where id = $1`, [U.sc, OTP]);
    const seenBySc = (await as(U.sc, `select count(*)::int n from issues where facility_id = any($1) and status = 'pending_review'`, [[OTP, OTP2]]))[0].n;
    check("State Coordinator sees both Findings in review", 2, seenBySc);
    let denied = "allowed";
    try { await as(U.otp, `select evaluate_facility_period($1, $2, $3)`, [OTP, month.s, month.e]); } catch { denied = "denied"; }
    check("facility user running the checks", "denied", denied);
    const hist = await one(`select actor_label, action from issue_history where issue_id = $1`, [sv[0].id]);
    check("history says it was raised automatically", "RUTF Monitoring (automatic check)", hist?.actor_label);
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
