// Bulk-imports the two national reference CSVs (Desktop\settlement.csv, Desktop\activity site.csv)
// into settlements/activity_sites as approved rows. Matches state/lga/ward against the live wards
// table using the same normalization as analyze-location-csvs-v2.js (case/whitespace, roman
// numeral <-> arabic, "/" <-> "-", trailing " ward"). Matched rows are inserted in batches with
// ON CONFLICT DO NOTHING against the existing (ward_id, name) unique index, so it's safe to re-run.
// Rows whose state/lga/ward doesn't resolve to a real ward are written to a CSV report instead of
// being inserted or guessed at — see DECISIONS.md #9 / the "don't invent data" rule.
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse");

const SETTLEMENT_CSV = "C:/Users/najib.adam/Desktop/settlement.csv";
const ACTIVITY_CSV = "C:/Users/najib.adam/Desktop/activity site.csv";
const REPORT_DIR = "C:/Users/najib.adam/Desktop";
const BATCH_SIZE = 2000;

const ROMAN = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8" };
function baseNorm(s) { return (s || "").trim().toLowerCase().replace(/\s+/g, " "); }
function romanToArabic(s) { return s.replace(/\b(viii|vii|vi|v|iv|iii|ii|i)\b/g, (m) => ROMAN[m]); }
function variants(raw) {
  const b = baseNorm(raw);
  const set = new Set([b]);
  set.add(b.replace(/\bward\b/g, "").replace(/\s+/g, " ").trim());
  set.add(romanToArabic(b));
  set.add(b.replace(/[/-]/g, " ").replace(/\s+/g, " ").trim());
  set.add(b.replace(/[/-]/g, "").replace(/\s+/g, " ").trim());
  set.add(romanToArabic(b.replace(/[/-]/g, " ").replace(/\s+/g, " ").trim()));
  return [...set];
}

async function loadWardMap(client) {
  const { rows } = await client.query(`
    select w.id as ward_id, w.name as ward_name, l.name as lga_name, s.name as state_name
    from wards w join lgas l on l.id = w.lga_id join states s on s.id = l.state_id
  `);
  const map = new Map();
  for (const r of rows) {
    for (const sv of variants(r.state_name)) for (const lv of variants(r.lga_name)) for (const wv of variants(r.ward_name)) {
      map.set(`${sv}|${lv}|${wv}`, r.ward_id);
    }
  }
  return map;
}

function lookup(map, state, lga, ward) {
  for (const sv of variants(state)) for (const lv of variants(lga)) for (const wv of variants(ward)) {
    const id = map.get(`${sv}|${lv}|${wv}`);
    if (id) return id;
  }
  return null;
}

async function importFile({ client, csvPath, cols, table, nameCol: nameColumn, wardMap, reportPath, label }) {
  const [stateCol, lgaCol, wardCol, srcNameCol] = cols;
  let total = 0, blankName = 0, unmatched = 0, inserted = 0, skippedDupeInFile = 0;
  const seen = new Set(); // `${ward_id}|${normalizedName}` — de-dupe within this file before insert
  let batch = [];
  const unmatchedRows = [["state", "lga", "ward", "name"]];

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
      insert into ${table} (ward_id, ${nameColumn})
      values ${placeholders.join(",")}
      on conflict (ward_id, ${nameColumn}) where status <> 'rejected' do nothing
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

  const parser = fs.createReadStream(csvPath).pipe(parse({ columns: true, skip_empty_lines: true, relax_quotes: true }));
  for await (const rec of parser) {
    total++;
    const state = rec[stateCol], lga = rec[lgaCol], ward = rec[wardCol], name = rec[srcNameCol];
    if (!name || !name.trim()) { blankName++; continue; }
    const wardId = lookup(wardMap, state, lga, ward);
    if (!wardId) {
      unmatched++;
      unmatchedRows.push([state, lga, ward, name]);
      continue;
    }
    const dedupeKey = `${wardId}|${baseNorm(name)}`;
    if (seen.has(dedupeKey)) { skippedDupeInFile++; continue; }
    seen.add(dedupeKey);
    batch.push({ wardId, name: name.trim() });
    if (batch.length >= BATCH_SIZE) await flush();
    if (total % 50000 === 0) console.log(`  ${label}: processed ${total} rows...`);
  }
  await flush();

  const csvOut = unmatchedRows.map((r) => r.map((v) => `"${(v || "").replace(/"/g, '""')}"`).join(",")).join("\n");
  fs.writeFileSync(reportPath, csvOut, "utf8");

  console.log(`\n=== ${label} ===`);
  console.log(`total rows: ${total}`);
  console.log(`blank name: ${blankName}`);
  console.log(`unmatched (written to ${reportPath}): ${unmatched}`);
  console.log(`duplicate ward+name within file (skipped): ${skippedDupeInFile}`);
  console.log(`attempted insert (existing rows silently skipped via ON CONFLICT): ${inserted}`);
}

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log("loading ward map...");
  const wardMap = await loadWardMap(client);
  console.log(`loaded ${wardMap.size} normalized-variant keys`);

  const beforeCounts = await client.query("select (select count(*) from settlements) s, (select count(*) from activity_sites) a");
  console.log("before:", beforeCounts.rows[0]);

  await importFile({
    client, csvPath: SETTLEMENT_CSV,
    cols: ["state_name", "lga_name", "ward_name", "settlement_name"],
    table: "settlements", nameCol: "settlementname", wardMap,
    reportPath: path.join(REPORT_DIR, "settlement_unmatched.csv"),
    label: "SETTLEMENTS",
  });

  await importFile({
    client, csvPath: ACTIVITY_CSV,
    cols: ["statename", "lganame", "wardname", "primary_name"],
    table: "activity_sites", nameCol: "activitysitename", wardMap,
    reportPath: path.join(REPORT_DIR, "activity_site_unmatched.csv"),
    label: "ACTIVITY SITES",
  });

  const afterCounts = await client.query("select (select count(*) from settlements) s, (select count(*) from activity_sites) a");
  console.log("\nafter:", afterCounts.rows[0]);

  await client.end();
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
