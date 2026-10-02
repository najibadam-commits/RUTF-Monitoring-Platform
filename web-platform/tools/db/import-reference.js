// Loads the RUTF reference data (brief M1) into the 0100 tables:
//   data/dummy/facilities.csv   -> facilities   (2,420 registry facilities + dummy State/LGA stores)
//   data/dummy/product_lots.csv -> product_lots
// Products, protocol rules and thresholds are seeded by migration 0100 itself.
//
// Rows keep the CSV's fixed ids (people.csv and the ledger files reference them) and insert with
// ON CONFLICT (id) DO NOTHING, so a re-run adds only what is missing. Stores go in before health
// facilities because supplied_by_facility_id must point at an existing row.
//
// LGA is matched by name; ward by name within that LGA when it matches a boundary ward, otherwise
// left empty for derive_facility_location() to resolve from coordinates (brief §12 "Still open" 1:
// 67 registry rows use ward names that aren't boundary names). The CSV ward is kept in
// ward_name_source either way.
//
// Usage: node import-reference.js [--facilities path.csv] [--lots path.csv]
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const DATA_DIR = path.join(__dirname, "..", "..", "..", "data", "dummy");
const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const FACILITIES_CSV = arg("--facilities", path.join(DATA_DIR, "facilities.csv"));
const LOTS_CSV = arg("--lots", path.join(DATA_DIR, "product_lots.csv"));
const PROJECT_NAME = "Katsina RUTF Pilot";
const BATCH = 300;

const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
const bool = (s) => /^(true|1|yes)$/i.test((s || "").trim());
const blank = (s) => ((s || "").trim() === "" ? null : s.trim());
const num = (s) => (blank(s) === null ? null : Number(s));

async function insertBatch(client, table, cols, rows) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const params = [];
    const tuples = rows.slice(i, i + BATCH).map((row) =>
      `(${cols.map((c) => { params.push(row[c]); return `$${params.length}`; }).join(",")})`);
    const res = await client.query(
      `insert into ${table} (${cols.join(",")}) values ${tuples.join(",")} on conflict (id) do nothing`,
      params,
    );
    inserted += res.rowCount;
  }
  return inserted;
}

(async () => {
  const facilities = parse(fs.readFileSync(FACILITIES_CSV), { columns: true, skip_empty_lines: true });
  const lots = parse(fs.readFileSync(LOTS_CSV), { columns: true, skip_empty_lines: true });

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");

    const project = await client.query("select id from projects where name = $1", [PROJECT_NAME]);
    if (!project.rowCount) throw new Error(`Project "${PROJECT_NAME}" not found — apply migration 0100 first`);
    const projectId = project.rows[0].id;

    const lgaByName = new Map();
    (await client.query("select id, name from lgas")).rows.forEach((r) => lgaByName.set(norm(r.name), r.id));
    const wardByLgaName = new Map();
    (await client.query("select id, lga_id, name from wards")).rows
      .forEach((r) => wardByLgaName.set(`${r.lga_id}|${norm(r.name)}`, r.id));

    const unknownLga = [];
    let wardFromCoords = 0;
    const rows = [];
    for (const f of facilities) {
      const lgaId = lgaByName.get(norm(f.lga));
      if (!lgaId) { unknownLga.push(`${f.name} (${f.lga})`); continue; }
      const wardId = f.ward_name_source ? wardByLgaName.get(`${lgaId}|${norm(f.ward_name_source)}`) ?? null : null;
      if (!wardId) wardFromCoords++;
      rows.push({
        id: f.id,
        project_id: projectId,
        facility_type: f.facility_type,
        name: f.name.trim(),
        national_code: blank(f.national_code),
        lga_id: lgaId,
        ward_id: wardId,
        ward_name_source: blank(f.ward_name_source),
        lat: num(f.lat),
        lng: num(f.lng),
        geocode_source: blank(f.geocode_source),
        is_otp_site: bool(f.is_otp_site),
        supplied_by_facility_id: blank(f.supplied_by_facility_id),
        is_hard_to_reach: bool(f.is_hard_to_reach),
        functional_status: blank(f.functional_status),
        registry_category: blank(f.category),
        dummy_fields: blank(f.dummy_fields),
      });
    }
    if (unknownLga.length) throw new Error(`LGA not found for ${unknownLga.length} rows, e.g. ${unknownLga.slice(0, 3).join("; ")}`);

    const cols = Object.keys(rows[0]);
    let inserted = 0;
    for (const type of ["state_store", "lga_store", "health_facility"]) {
      const n = await insertBatch(client, "facilities", cols, rows.filter((r) => r.facility_type === type));
      console.log(`  facilities ${type}: ${n} inserted`);
      inserted += n;
    }

    const lotRows = lots.map((l) => ({ id: l.id, product_id: l.product_id, lot_no: l.lot_no.trim(), expiry_date: l.expiry_date }));
    const lotsInserted = await insertBatch(client, "product_lots", ["id", "product_id", "lot_no", "expiry_date"], lotRows);

    await client.query("commit");

    console.log(`\nFacilities: ${inserted} inserted of ${rows.length} (${wardFromCoords} with ward resolved from coordinates)`);
    console.log(`Lots: ${lotsInserted} inserted of ${lotRows.length}`);
    const summary = await client.query(`
      select facility_type, count(*) total, count(*) filter (where is_otp_site) otp,
             count(*) filter (where ward_id is null) no_ward, count(*) filter (where location_flag is not null) flagged
      from facilities group by facility_type order by facility_type`);
    console.table(summary.rows);
    const flags = await client.query(`select location_flag, count(*) from facilities where location_flag is not null group by 1`);
    if (flags.rowCount) console.table(flags.rows);
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.error("\n❌ Import failed, rolled back:", e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
