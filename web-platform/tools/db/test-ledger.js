// M2 acceptance test for the stock ledger (migration 0101, brief §11):
//   "State -> LGA -> OTP transfer and a week of dispensing reconcile to the right balance;
//    offline entries sync once, no duplicates after 3 forced retries."
//
// Runs as real demo facility users (seed-demo-accounts.js) under their own JWT claims, so the
// record_* functions' own checks and the RLS policies decide — inside ONE transaction that is
// always rolled back, on a throwaway SST -> LST -> {OTP1, OTP2} chain. Nothing is left behind.
//
// Usage: node test-ledger.js [--with-migration ../../supabase/migrations/0101_rutf_ledger.sql]
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
  const pg = new Client({ connectionString: process.env.DATABASE_URL, keepAlive: true });
  await pg.connect();
  const one = async (sql, params) => (await pg.query(sql, params)).rows[0];

  try {
    await pg.query("begin");
    if (migrationFile) await pg.query(fs.readFileSync(path.resolve(migrationFile), "utf8"));

    const user = async (email) => (await one(`select id from profiles where email = $1`, [email]))?.id;
    const U = {
      sst: await user("bello.lawal@rutf-demo.example"),
      lst: await user("maryam.rabiu@rutf-demo.example"),
      otp: await user("safiya.isa@rutf-demo.example"),
      sup: await user("hadiza.danjuma@rutf-demo.example"),
    };
    if (Object.values(U).some((v) => !v)) throw new Error("Demo accounts missing — run seed-demo-accounts.js first");

    // Throwaway chain inside the transaction.
    const kt = await one(`select id lga from lgas limit 1`);
    const P = (await one(`select id from projects where name = 'Katsina RUTF Pilot'`)).id;
    const fac = async (type, name, supplier, otp = false) =>
      (await one(`insert into facilities (project_id, facility_type, name, lga_id, supplied_by_facility_id, is_otp_site)
                  values ($1,$2,$3,$4,$5,$6) returning id`, [P, type, `LEDGER TEST ${name}`, kt.lga, supplier, otp])).id;
    const SST = await fac("state_store", "SST", null);
    const LST = await fac("lga_store", "LST", SST);
    const OTP1 = await fac("health_facility", "OTP1", LST, true);
    const OTP2 = await fac("health_facility", "OTP2", LST, true);
    const OTHER_LST = await fac("lga_store", "LST2", SST);
    for (const [u, f] of [[U.sst, SST], [U.lst, LST], [U.otp, OTP1]]) await pg.query(`update profiles set facility_id = $2 where id = $1`, [u, f]);

    const day = (n) => (n === 0 ? "current_date" : `current_date - ${n}`);
    // JWT claims set with set_config(..., true) last until the transaction ends — cleared after
    // every call so later direct-connection queries don't act as that user.
    const clearIdentity = () => pg.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`);
    // Runs fn under a user's identity; a statement error is caught and returned as { error }.
    async function as(userId, sql, params = []) {
      await pg.query("savepoint s");
      await pg.query("set local role authenticated");
      await pg.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
        [JSON.stringify({ sub: userId, role: "authenticated" }), userId]);
      try {
        const r = await pg.query(sql, params);
        await pg.query("reset role");
        await pg.query("release savepoint s");
        await clearIdentity();
        return { rows: r.rows };
      } catch (e) {
        await pg.query("rollback to savepoint s");
        await pg.query("reset role");
        await clearIdentity();
        return { error: e.message };
      }
    }
    const rpc = async (userId, sql, params) => {
      const r = await as(userId, sql, params);
      if (r.error) throw new Error(`${sql.slice(0, 40)}… -> ${r.error}`);
      return Object.values(r.rows[0])[0];
    };
    const balance = async (f) => (await one(`select ledger_balance($1, null, current_date) b`, [f])).b;
    const lines = (arr) => JSON.stringify(arr);

    // 1. Supplier delivery at the State store — a new lot, read off the carton.
    const r1 = await rpc(U.sst, `select record_receipt('LT-1', $1, ${day(14)}, $2, null, 'GRN-TEST-1')`,
      [SST, lines([{ lot_no: "LEDGER-TEST-LOT", expiry_date: "2027-12-31", quantity: 3000 }])]);
    check("supplier delivery: State store balance", 3000, await balance(SST));
    const lotId = (await one(`select id from product_lots where lot_no = 'LEDGER-TEST-LOT'`)).id;

    // 2. State store -> LGA store.
    const r2 = await rpc(U.sst, `select record_issue('LT-2', $1, $2, ${day(13)}, $3, 'IV-TEST-1')`, [SST, LST, lines([{ lot_id: lotId, quantity: 1500 }])]);
    check("issue creates an in-transit transfer", "in_transit", (await one(`select status from transfers where id = $1`, [r2.transfer_id])).status);
    check("State store after issue", 1500, await balance(SST));

    // 3. LGA store receives it in full.
    const r3 = await rpc(U.lst, `select record_receipt('LT-3', $1, ${day(12)}, $2, $3)`, [LST, lines([{ lot_id: lotId, quantity: 1500 }]), r2.transfer_id]);
    check("full receipt marks the transfer received", "received", r3.transfer_status);

    // 4. LGA store -> OTP1, and OTP1 receives 10 short (2 of them damaged).
    const r4 = await rpc(U.lst, `select record_issue('LT-4', $1, $2, ${day(10)}, $3)`, [LST, OTP1, lines([{ lot_id: lotId, quantity: 600 }])]);
    // The pre-fill comes through incoming_transfer_lines(); the supplier's ledger rows stay hidden (0108, R44).
    const issueLinesSeen = (await as(U.otp, `select count(*)::int n from incoming_transfer_lines($1) where transfer_id = $2`, [OTP1, r4.transfer_id])).rows[0].n;
    check("OTP user sees the issue lines addressed to it (pre-fill)", 1, issueLinesSeen);
    const supplierRowsSeen = (await as(U.otp, `select count(*)::int n from stock_transactions where transfer_id = $1 and txn_type = 'issue'`, [r4.transfer_id])).rows[0].n;
    check("OTP user can't read the supplier's ledger rows", 0, supplierRowsSeen);
    const r5 = await rpc(U.otp, `select record_receipt('LT-5', $1, ${day(9)}, $2, $3)`, [OTP1, lines([{ lot_id: lotId, quantity: 590, damaged: 2 }]), r4.transfer_id]);
    check("short receipt marks a discrepancy", "discrepancy", r5.transfer_status);
    check("transfer gap", 10, (await one(`select gap from transfer_overview where id = $1`, [r4.transfer_id])).gap);

    // 5. A week of dispensing at OTP1, 60 sachets a day.
    for (let d = 7; d >= 1; d--) {
      await rpc(U.otp, `select record_dispensing('LT-D${d}', $1, ${day(d)}, 2, 12, 62, 60)`, [OTP1]);
    }
    check("OTP1 after a week of dispensing (590 − 2 damaged − 420)", 168, await balance(OTP1));

    // 6. Forced retries: the same submissions three more times each.
    const before = Number((await one(`select count(*) n from stock_transactions where submission_local_id like 'LT-%'`)).n);
    let dup = 0;
    for (let i = 0; i < 3; i++) {
      if ((await rpc(U.otp, `select record_dispensing('LT-D1', $1, ${day(1)}, 2, 12, 62, 60)`, [OTP1])).duplicate) dup++;
      if ((await rpc(U.lst, `select record_issue('LT-4', $1, $2, ${day(10)}, $3)`, [LST, OTP1, lines([{ lot_id: lotId, quantity: 600 }])])).duplicate) dup++;
      if ((await rpc(U.otp, `select record_receipt('LT-5', $1, ${day(9)}, $2, $3)`, [OTP1, lines([{ lot_id: lotId, quantity: 590, damaged: 2 }]), r4.transfer_id])).duplicate) dup++;
    }
    const after = Number((await one(`select count(*) n from stock_transactions where submission_local_id like 'LT-%'`)).n);
    check("3 forced retries × 3 submissions all answered as duplicates", 9, dup);
    check("no new ledger rows from retries", before, after);
    check("one transfer per issue submission", 2, Number((await one(`select count(*) n from transfers where local_id like 'LT-%'`)).n));
    check("one dispensing row per day", 7, Number((await one(`select count(*) n from otp_daily_dispensing where local_id like 'LT-D%'`)).n));

    // 7. Month-end count 3 short, then a loss.
    const r7 = await rpc(U.otp, `select record_stock_count('LT-7', $1, current_date, $2)`, [OTP1, lines([{ lot_id: lotId, physical_count: 165 }])]);
    check("count returns the ledger balance it was compared with", 168, r7.lines[0].ledger_balance);
    check("count difference becomes an adjustment", -3, (await one(`select quantity_sachets q from stock_transactions where submission_local_id = 'LT-7' and txn_type = 'adjustment'`)).q);
    await rpc(U.otp, `select record_loss('LT-8', $1, current_date, 'loss_expired', 5, 'rodent damage, written off', $2)`, [OTP1, lotId]);

    // 8. Final reconciliation across the chain.
    check("final balances SST / LST / OTP1", [1500, 900, 160], [await balance(SST), await balance(LST), await balance(OTP1)]);
    check("stock_balances view agrees for OTP1", 160, (await one(`select balance from stock_balances where facility_id = $1 and lot_id = $2`, [OTP1, lotId])).balance);

    // 9. Who may record what.
    const denied = async (userId, sql, params) => ((await as(userId, sql, params)).error ? "denied" : "allowed");
    check("OTP user recording at the LGA store", "denied", await denied(U.otp, `select record_loss('LT-X1', $1, current_date, 'loss_other', 1, 'x')`, [LST]));
    check("OTP (not a store) issuing stock", "denied", await denied(U.otp, `select record_issue('LT-X2', $1, $2, current_date, $3)`, [OTP1, OTP2, lines([{ lot_id: lotId, quantity: 1 }])]));
    check("LGA store issuing to a facility it doesn't supply", "denied", await denied(U.lst, `select record_issue('LT-X3', $1, $2, current_date, $3)`, [LST, OTHER_LST, lines([{ lot_id: lotId, quantity: 1 }])]));
    check("supervisor recording stock", "denied", await denied(U.sup, `select record_loss('LT-X4', $1, current_date, 'loss_other', 1, 'x')`, [OTP1]));
    check("second dispensing entry for the same day (new local_id)", "denied", await denied(U.otp, `select record_dispensing('LT-X5', $1, ${day(1)}, 0, 1, 1, 1)`, [OTP1]));
    check("direct insert into the ledger", "denied", await denied(U.otp,
      `insert into stock_transactions (facility_id, txn_type, txn_date, quantity_sachets, recorded_by) values ($1, 'receipt', current_date, 1, $2)`, [OTP1, U.otp]));
    check("receipt dated in the future", "denied", await denied(U.lst, `select record_receipt('LT-X6', $1, current_date + 1, $2, null, 'GRN')`, [LST, lines([{ lot_id: lotId, quantity: 1 }])]));

    // 10. What each user can read.
    const seen = async (userId, f) => (await as(userId, `select count(*)::int n from stock_transactions where facility_id = $1`, [f])).rows[0].n;
    check("OTP user cannot read the State store's ledger", 0, await seen(U.otp, SST));
    check("OTP user reads its own ledger", Number((await one(`select count(*) n from stock_transactions where facility_id = $1`, [OTP1])).n), await seen(U.otp, OTP1));
    // A supervisor reads the ledgers of the facilities in their LGAs (0134, R169): give them the
    // State store's LGA for this check (rolled back with everything else).
    await pg.query(`insert into supervisor_lgas (profile_id, lga_id) select $1, lga_id from facilities where id = $2 on conflict do nothing`, [U.sup, SST]);
    check("supervisor reads the State store's ledger (its LGA assigned)", Number((await one(`select count(*) n from stock_transactions where facility_id = $1`, [SST])).n), await seen(U.sup, SST));
    check("LGA Nutrition Officer reads an OTP site's ledger in their LGA", Number((await one(`select count(*) n from stock_transactions where facility_id = $1`, [OTP1])).n), await seen(U.lst, OTP1));
    check("LGA Nutrition Officer cannot read the State store's ledger", 0, await seen(U.lst, SST));

    // 11. Voiding by an administrator (migration 0109). Balances now: SST 1500, LST 900, OTP1 160.
    const rowsBeforeVoid = Number((await one(`select count(*) n from stock_transactions where submission_local_id like 'LT-%'`)).n);
    const PA = (await one(`select id from profiles where email like '%@rutf-demo.example' and role = 'project_admin' and status = 'active' limit 1`)).id;
    const voidAs = (u, localId, reason = "Entered twice by mistake, confirmed by phone") =>
      as(u, `select void_ledger_submission($1, $2) r`, [localId, reason]);
    check("facility user voiding", "denied", (await voidAs(U.otp, "LT-8")).error ? "denied" : "allowed");
    check("supervisor voiding", "denied", (await voidAs(U.sup, "LT-8")).error ? "denied" : "allowed");
    check("void without a proper reason", "denied", (await voidAs(PA, "LT-8", "oops")).error ? "denied" : "allowed");
    check("void an issue whose transfer was received", "denied", (await voidAs(PA, "LT-4")).error ? "denied" : "allowed");

    const v5 = (await voidAs(PA, "LT-5")).rows[0].r;
    check("void the short receipt: rows voided, transfer back in transit", [2, "in_transit"], [v5.rows_voided, v5.transfer_status]);
    check("OTP1 after voiding the receipt (160 − 590 + 2)", -428, await balance(OTP1));
    check("void reports lots below zero", 1, v5.lots_below_zero);
    const v4 = (await voidAs(PA, "LT-4")).rows[0].r;
    check("then the issue can be voided: transfer cancelled", "cancelled", v4.transfer_status);
    check("LGA store gets the 600 back", 1500, await balance(LST));

    await voidAs(PA, "LT-D1");
    check("voided dispensing day leaves the daily totals", 6, Number((await one(`select count(*) n from otp_daily_dispensing where local_id like 'LT-D%'`)).n));
    check("voided day kept, marked with who and why", 1, Number((await one(`select count(*) n from otp_daily_dispensing_entries where local_id = 'LT-D1' and voided_by = $1 and void_reason is not null`, [PA])).n));
    check("OTP1 gets the day's 60 back", -368, await balance(OTP1));
    check("the voided day can be recorded again", "allowed",
      (await as(U.otp, `select record_dispensing('LT-D1b', $1, ${day(1)}, 2, 12, 62, 60)`, [OTP1])).error ? "denied" : "allowed");
    check("voiding again is answered as a duplicate", true, (await voidAs(PA, "LT-D1")).rows[0].r.duplicate);

    await voidAs(PA, "LT-7");
    check("voided count: its adjustment drops out", 0, Number((await one(`select count(*) n from stock_transactions where submission_local_id = 'LT-7' and status <> 'voided'`)).n));
    check("voids are in the audit trail", true, Number((await one(`select count(*) n from audit_log where table_name = 'stock_transactions' and changes ? 'status' and actor = $1`, [PA])).n) > 0);
    check("nothing deleted (every row still there, voided or not)", rowsBeforeVoid,
      Number((await one(`select count(*) n from stock_transactions where submission_local_id like 'LT-%' and submission_local_id <> 'LT-D1b'`)).n));
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
