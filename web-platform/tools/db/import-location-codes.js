// Bulk-imports the code-augmented CSVs (Desktop\settlements.csv, Desktop\activity site.csv) using
// the exact `wardcode` column as the join key against wards.code — no fuzzy text matching needed,
// codes are unique. Per the user's explicit decision, wardcode wins over the row's own
// state/lga/ward text when they disagree (see chat: "trust wardcode"). Matched rows are inserted
// in batches with ON CONFLICT DO NOTHING against the (ward_id, name) unique index, so it's safe to
// re-run and won't duplicate anything from the earlier fuzzy-text import. Rows with a blank or
// unrecognized wardcode go to a CSV report instead of being inserted or guessed at.
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse");

const SETTLEMENT_CSV = "C:/Users/najib.adam/Desktop/settlements.csv";
const ACTIVITY_CSV = "C:/Users/najib.adam/Desktop/activity site.csv";
const REPORT_DIR = "C:/Users/najib.adam/Desktop";
const BATCH_SIZE = 2000;

function norm(s) { return (s || "").trim().toLowerCase().replace(/\s+/g, " "); }

async function loadWardCodeMap(client) {
  const { rows } = await client.query(`select id as ward_id, code from wards`);
  const map = new Map();
  for (const r of rows) map.set(r.code, r.ward_id);
  return map;
}

async function importFile({ client, csvPath, wardCol, nameCol: srcNameCol, table, dbNameCol, wardMap, reportPath, label }) {
  let total = 0, blankName = 0, unmatched = 0, inserted = 0, skippedDupeInFile = 0;
  const seen = new Set();
  let batch = [];
  const unmatchedRows = [["wardcode", "name"]];

  async function flush() {
    if (batch.length === 0) return;
    const values = [];
    const placeholders = [];
    batch.forEach((row, i) => {
      const base = i * 2;
      placeholders.push(`($${base + 1}, $${base + 2})`);
      values.push(row.wardId, row.name);
    });
    const sql = `
      insert into ${table} (ward_id, ${dbNameCol})
      values ${placeholders.join(",")}
      on conflict (ward_id, ${dbNameCol}) where status <> 'rejected' do nothing
    `;
    await client.query("begin");
    try {
      await client.query(sql, values);
      await client.query("commit");
      inserted += batch.length;
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
    batch = [];
  }

  const parser = fs.createReadStream(csvPath).pipe(parse({ columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true }));
  for await (const rec of parser) {
    total++;
    const name = rec[srcNameCol];
    const wc = (rec[wardCol] || "").trim();
    if (!name || !name.trim()) { blankName++; continue; }
    const wardId = wc ? wardMap.get(wc) : null;
    if (!wardId) {
      unmatched++;
      unmatchedRows.push([wc, name]);
      continue;
    }
    const dedupeKey = `${wardId}|${norm(name)}`;
    if (seen.has(dedupeKey)) { skippedDupeInFile++; continue; }
    seen.add(dedupeKey);
    batch.push({ wardId, name: name.trim() });
    if (batch.length >= BATCH_SIZE) await flush();
    if (total % 100000 === 0) console.log(`  ${label}: processed ${total} rows...`);
  }
  await flush();

  const csvOut = unmatchedRows.map((r) => r.map((v) => `"${(v || "").replace(/"/g, '""')}"`).join(",")).join("\n");
  fs.writeFileSync(reportPath, csvOut, "utf8");

  console.log(`\n=== ${label} ===`);
  console.log(`total rows: ${total}`);
  console.log(`blank name: ${blankName}`);
  console.log(`no usable wardcode (written to ${reportPath}): ${unmatched}`);
  console.log(`duplicate ward+name within file (skipped): ${skippedDupeInFile}`);
  console.log(`attempted insert (existing rows silently skipped via ON CONFLICT): ${inserted}`);
}

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log("loading ward code map...");
  const wardMap = await loadWardCodeMap(client);
  console.log(`loaded ${wardMap.size} wards keyed by code`);

  const before = await client.query("select (select count(*) from settlements) s, (select count(*) from activity_sites) a");
  console.log("before:", before.rows[0]);

  await importFile({
    client, csvPath: SETTLEMENT_CSV, wardCol: "wardcode", nameCol: "settlement_name",
    table: "settlements", dbNameCol: "settlementname", wardMap,
    reportPath: path.join(REPORT_DIR, "settlement_no_wardcode.csv"),
    label: "SETTLEMENTS",
  });

  await importFile({
    client, csvPath: ACTIVITY_CSV, wardCol: "wardcode", nameCol: "activity site name",
    table: "activity_sites", dbNameCol: "activitysitename", wardMap,
    reportPath: path.join(REPORT_DIR, "activity_site_no_wardcode.csv"),
    label: "ACTIVITY SITES",
  });

  const after = await client.query("select (select count(*) from settlements) s, (select count(*) from activity_sites) a");
  console.log("\nafter:", after.rows[0]);

  await client.end();
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
