// M5 acceptance test (brief §11): "KPIs match hand-calculated values on seed data."
// Compares the database's rutf_kpis() with tools/dummy-data/kpis.py, which works the same KPIs
// out independently from the dummy CSV files (definitions: DECISIONS R38). Counts must match
// exactly; percentages and ratios within 0.06 (Python and Postgres round halves differently).
// Also sanity-checks facility_risk() and supervision_plan(). Read-only (one rolled-back
// transaction, so --with-migration can test a migration before it is applied).
//
// Usage: node test-kpis.js [YYYY-MM] [--with-migration ../../supabase/migrations/0105_rutf_metrics.sql]
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const month = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) ?? "2026-09";
const migIdx = process.argv.indexOf("--with-migration");
const migrationFile = migIdx > -1 ? process.argv[migIdx + 1] : null;
const results = [];
function check(what, expected, actual, tolerance = 0) {
  const pass = typeof expected === "number" && typeof actual === "number"
    ? Math.abs(expected - actual) <= tolerance + 1e-9
    : JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ check: what, expected: JSON.stringify(expected), actual: JSON.stringify(actual), result: pass ? "PASS" : "FAIL" });
}

(async () => {
  const repoRoot = path.join(__dirname, "..", "..", "..");
  const ref = JSON.parse(execFileSync("python", [path.join(repoRoot, "tools", "dummy-data", "kpis.py"), month], { encoding: "utf8" }));

  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  try {
    await pg.query("begin");
    if (migrationFile) await pg.query(fs.readFileSync(path.resolve(migrationFile), "utf8"));
    const [start, end] = ref.period;
    const k = (await pg.query("select rutf_kpis($1, $2) k", [start, end])).rows[0].k;
    const num = (v) => (v === null || v === undefined ? null : Number(v));

    for (const lv of ["state_store", "lga_store", "otp"]) {
      check(`stock on hand — ${lv}`, ref.stock_on_hand[lv], num(k.stock_on_hand[lv]));
      check(`months of stock — ${lv}`, ref.months_of_stock[lv], num(k.months_of_stock[lv]), 0.01);
    }
    check("stockout rate %", ref.stockout_rate_pct, num(k.stockout_rate_pct), 0.06);
    check("mean stock variance %", ref.mean_stock_variance_pct, num(k.mean_stock_variance_pct), 0.01);
    check("transfers in transit", ref.transfers_in_transit, num(k.transfers_in_transit));
    check("transfers with a discrepancy", ref.transfers_with_discrepancy, num(k.transfers_with_discrepancy));
    check("short-dispensing %", ref.short_dispensing_pct, num(k.short_dispensing_pct), 0.01);
    check("OTP VF median", ref.otp_vf_median, num(k.otp_vf_median), 0.001);
    check("OTP VF outside range %", ref.otp_vf_outside_pct, num(k.otp_vf_outside_pct), 0.06);
    check("dispensing completeness %", ref.dispensing_completeness_pct, num(k.dispensing_completeness_pct), 0.06);
    check("month-end counts on time %", ref.count_on_time_pct, num(k.count_on_time_pct), 0.06);
    for (const t of ["loss_damaged", "loss_expired", "loss_other"]) check(`losses — ${t}`, ref.losses[t], num(k.losses[t]));
    check("supervision — facilities visited this quarter", ref.supervision_quarter.visited, num(k.supervision_quarter.visited));
    check("supervision — facilities to visit", ref.supervision_quarter.to_visit, num(k.supervision_quarter.to_visit));

    // Risk score and planner: bounded, and consistent with the inputs.
    const risk = (await pg.query("select * from facility_risk($1)", [end])).rows;
    check("risk scored for every active store and OTP site", ref.supervision_quarter.to_visit, risk.length);
    check("risk scores within 0–100", true, risk.every((r) => r.risk_score >= 0 && r.risk_score <= 100));
    const sum = (c) => Object.entries(c).filter(([key]) => ["variance", "vf", "transfers", "stockout", "short_dispensing", "reporting", "critical_findings", "since_visit"].includes(key)).reduce((s, [, v]) => s + Number(v), 0);
    check("risk score = sum of its components (±1 rounding)", true, risk.every((r) => Math.abs(sum(r.components) - r.risk_score) <= 1));
    const plan = (await pg.query("select * from supervision_plan($1)", [end])).rows;
    const bySup = {};
    for (const p of plan) (bySup[p.supervisor_id] ??= []).push(p);
    check("every demo supervisor has a plan", 37, Object.keys(bySup).length);
    check("no more than the workload (8) suggested per supervisor", true, Object.values(bySup).every((rows) => rows.filter((r) => r.suggested).length <= 8));
    check("suggested facilities are all due", true, plan.filter((p) => p.suggested).every((p) => p.due));
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
