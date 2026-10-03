// Loads a DHIS2 monthly RUTF extract (brief §12.8) into dhis2_reports — by default the dummy
// data/dummy/dhis2_monthly.csv (DECISIONS R2). Columns: facility_id, period (YYYYMM),
// otp_admissions, rutf_sachets_received, rutf_sachets_distributed, rutf_sachets_wasted,
// rutf_stockout_days. Re-runnable: one row per facility and month, updated in place.
// The web DHIS2 Triangulation page does the same upload for a real extract.
//
// Usage: node import-dhis2.js [path.csv]
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const file = process.argv[2] ?? path.join(__dirname, "..", "..", "..", "data", "dummy", "dhis2_monthly.csv");
const int = (s) => ((s ?? "").trim() === "" ? null : Number(s));

(async () => {
  const rows = parse(fs.readFileSync(file), { columns: true, skip_empty_lines: true });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");
    const project = new Map((await client.query("select id, project_id from facilities")).rows.map((r) => [r.id, r.project_id]));
    let n = 0;
    for (let i = 0; i < rows.length; i += 400) {
      const params = [];
      const tuples = rows.slice(i, i + 400).map((r) => {
        if (!project.has(r.facility_id)) throw new Error(`Unknown facility ${r.facility_id} (${r.facility_name ?? ""})`);
        const p = String(r.period).trim();
        const vals = [project.get(r.facility_id), r.facility_id, `${p.slice(0, 4)}-${p.slice(4, 6)}-01`, int(r.otp_admissions),
          int(r.rutf_sachets_received), int(r.rutf_sachets_distributed), int(r.rutf_sachets_wasted), int(r.rutf_stockout_days)];
        return `(${vals.map((v) => { params.push(v); return `$${params.length}`; }).join(",")})`;
      });
      n += (await client.query(
        `insert into dhis2_reports (project_id, facility_id, period, otp_admissions, sachets_received, sachets_distributed, sachets_wasted, stockout_days)
         values ${tuples.join(",")}
         on conflict (facility_id, period) do update set otp_admissions = excluded.otp_admissions,
           sachets_received = excluded.sachets_received, sachets_distributed = excluded.sachets_distributed,
           sachets_wasted = excluded.sachets_wasted, stockout_days = excluded.stockout_days, imported_at = now()`, params)).rowCount;
    }
    await client.query("commit");
    console.log(`${n} DHIS2 facility-months loaded.`);
    const t = await client.query(`select count(*)::int n, count(*) filter (where abs(distributed_diff_pct) > 10)::int off
                                  from dhis2_triangulation('2026-04-01', '2026-09-30')`);
    console.log(`Triangulation: ${t.rows[0].n} facility-months, ${t.rows[0].off} differ from the ledger by more than 10% on sachets distributed.`);
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.error("❌ Import failed, rolled back:", e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
