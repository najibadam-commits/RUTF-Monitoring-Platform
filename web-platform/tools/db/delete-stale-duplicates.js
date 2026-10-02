// Deletes the stale settlement rows left under the OLD (fuzzy-text-matched) ward from the earlier
// import, now superseded by a wardcode-correct entry under the right ward — see chat: confirmed by
// the user after check-stale-duplicates.js verified all 15,444 candidates exist and that 0 issues
// reference any settlement (nothing to orphan). Recomputes the exact same (old_ward_id, name)
// candidate list, then deletes only those precise pairs — never touches the new, correct copy
// (different ward_id, so it's a different row entirely).
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const fs = require("fs");
const { parse } = require("csv-parse");

const SETTLEMENT_CSV = "C:/Users/najib.adam/Desktop/settlements.csv";
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

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows: wardRows } = await client.query(`
    select w.id as ward_id, w.code, w.name as ward_name, l.name as lga_name, s.name as state_name
    from wards w join lgas l on l.id = w.lga_id join states s on s.id = l.state_id
  `);
  const byCode = new Map(wardRows.map((r) => [r.code, r.ward_id]));
  const byTextVariant = new Map();
  for (const r of wardRows) {
    for (const sv of variants(r.state_name)) for (const lv of variants(r.lga_name)) for (const wv of variants(r.ward_name)) {
      byTextVariant.set(`${sv}|${lv}|${wv}`, r.ward_id);
    }
  }
  function lookupText(state, lga, ward) {
    for (const sv of variants(state)) for (const lv of variants(lga)) for (const wv of variants(ward)) {
      const id = byTextVariant.get(`${sv}|${lv}|${wv}`);
      if (id) return id;
    }
    return null;
  }

  const candidates = new Map();
  const parser = fs.createReadStream(SETTLEMENT_CSV).pipe(parse({ columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true }));
  for await (const rec of parser) {
    const name = rec.settlement_name;
    if (!name || !name.trim()) continue;
    const wc = (rec.wardcode || "").trim();
    const correctWardId = wc ? byCode.get(wc) : null;
    if (!correctWardId) continue;
    const oldWardId = lookupText(rec.state_name, rec.lga_name, rec.ward_name);
    if (!oldWardId || oldWardId === correctWardId) continue;
    candidates.set(`${oldWardId}|${baseNorm(name)}`, { oldWardId, name: name.trim() });
  }
  console.log(`recomputed ${candidates.size} stale candidates (must match the earlier check's 15,444)`);

  const before = await client.query("select count(*) from settlements");
  console.log("settlements before delete:", before.rows[0].count);

  let deleted = 0;
  const arr = [...candidates.values()];
  const CHUNK = 500;
  for (let i = 0; i < arr.length; i += CHUNK) {
    const chunk = arr.slice(i, i + CHUNK);
    const wardIds = chunk.map((c) => c.oldWardId);
    const names = chunk.map((c) => c.name);
    await client.query("begin");
    try {
      const { rows } = await client.query(
        `with pairs as (select * from unnest($1::uuid[], $2::text[]) as t(ward_id, name))
         delete from settlements s
         using pairs p
         where s.ward_id = p.ward_id and lower(s.settlementname) = lower(p.name) and s.status <> 'rejected'
         returning s.id`,
        [wardIds, names]
      );
      await client.query("commit");
      deleted += rows.length;
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  }
  console.log("rows deleted:", deleted);

  const after = await client.query("select count(*) from settlements");
  console.log("settlements after delete:", after.rows[0].count);

  await client.end();
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
