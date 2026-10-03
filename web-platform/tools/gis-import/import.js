// Imports Nigeria administrative boundaries (state.sqlite / LGA.sqlite /
// Ward.sqlite — SpatiaLite, EPSG:4326) into the states/lgas/wards tables
// created by supabase/migrations/0002_lookup_tables.sql.
//
// Usage: node import.js [--states KT,KN]
// Reads DATABASE_URL from ../db/.env (same connection used for migrations).
// --states limits the import to those state codes (and their LGAs/wards); the full
// all-Nigeria import dropped its connection part-way, and the RUTF pilot is Katsina only.
// Inserts use ON CONFLICT DO NOTHING, so a later run without the flag adds the rest.

require("dotenv").config({ path: require("path").join(__dirname, "..", "db", ".env"), quiet: true });
const gdal = require("gdal-async");
const { Client } = require("pg");

const SRC = {
  state: "C:/Users/najib.adam/Desktop/App/state.sqlite",
  lga: "C:/Users/najib.adam/Desktop/App/LGA.sqlite",
  ward: "C:/Users/najib.adam/Desktop/App/Ward.sqlite",
};

const statesArg = process.argv.indexOf("--states");
const STATE_FILTER = statesArg > -1 ? new Set(process.argv[statesArg + 1].split(",").map((s) => s.trim())) : null;

function readLayer(path) {
  const ds = gdal.open(path);
  const layer = ds.layers.get(0); // each source file has exactly one layer
  const rows = [];
  layer.features.forEach((f) => {
    const geom = f.getGeometry();
    rows.push({ fields: f.fields.toObject(), geojson: geom ? geom.toObject() : null });
  });
  ds.close();
  return rows;
}

/**
 * Batched parameterized insert. `mapRow` returns a plain object whose keys
 * become the non-geometry columns, plus a `geojson` key (GeoJSON geometry
 * object, or null) that's inserted via a bound-parameter ST_GeomFromGeoJSON
 * call — never string-interpolated into the SQL text.
 */
async function importWithGeom(client, table, rows, mapRow, batchSize = 50) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map(mapRow);
    if (batch.length === 0) continue;
    const cols = Object.keys(batch[0]).filter((c) => c !== "geojson");
    const tuples = [];
    const params = [];
    batch.forEach((row) => {
      const placeholders = cols.map((c) => {
        params.push(row[c]);
        return `$${params.length}`;
      });
      let geomExpr = "null";
      if (row.geojson) {
        params.push(JSON.stringify(row.geojson));
        geomExpr = `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($${params.length}), 4326))`;
      }
      tuples.push(`(${placeholders.join(",")}, ${geomExpr})`);
    });
    await client.query(
      `insert into ${table} (${cols.join(",")}, geom) values ${tuples.join(",")} on conflict do nothing;`,
      params,
    );
    process.stdout.write(`\r  ${table}: ${Math.min(i + batchSize, rows.length)}/${rows.length}`);
  }
  console.log("");
}

(async () => {
  console.log("Reading SpatiaLite layers...");
  // Ward rows carry no state code, so the filter follows the chain: states -> their LGAs -> those LGAs' wards.
  const inStates = (r) => !STATE_FILTER || STATE_FILTER.has(r.fields.statecode);
  const states = readLayer(SRC.state).filter(inStates);
  const lgas = readLayer(SRC.lga).filter(inStates);
  const keptLgaCodes = new Set(lgas.map((r) => r.fields.lgacode));
  const wards = readLayer(SRC.ward).filter((r) => !STATE_FILTER || keptLgaCodes.has(r.fields.lgacode));
  console.log(`states=${states.length} lgas=${lgas.length} wards=${wards.length}`);

  const client = new Client({ connectionString: process.env.DATABASE_URL, keepAlive: true });
  await client.connect();

  try {
    // No wrapping transaction: each batch commits on its own, and every insert is
    // `on conflict do nothing`, so a dropped connection can simply be re-run to resume.

    console.log("Importing states...");
    await importWithGeom(client, "states", states, (r) => ({
      code: r.fields.statecode,
      name: r.fields.statename,
      geozone: r.fields.geozone ?? null,
      capital: r.fields.capcity ?? null,
      geojson: r.geojson,
    }));

    console.log("Resolving state_id map...");
    const stateMap = new Map();
    const { rows: stateRows } = await client.query("select id, code from states");
    stateRows.forEach((row) => stateMap.set(row.code, row.id));

    console.log("Importing LGAs...");
    await importWithGeom(
      client,
      "lgas",
      lgas.filter((r) => stateMap.has(r.fields.statecode)),
      (r) => ({
        state_id: stateMap.get(r.fields.statecode),
        code: r.fields.lgacode,
        name: r.fields.lganame,
        geojson: r.geojson,
      }),
    );

    console.log("Resolving lga_id map...");
    const lgaMap = new Map();
    const { rows: lgaRows } = await client.query("select id, code from lgas");
    lgaRows.forEach((row) => lgaMap.set(row.code, row.id));

    console.log("Importing wards...");
    await importWithGeom(
      client,
      "wards",
      wards.filter((r) => lgaMap.has(r.fields.lgacode)),
      (r) => ({
        lga_id: lgaMap.get(r.fields.lgacode),
        code: r.fields.wardcode,
        name: r.fields.wardname,
        urban: r.fields.urban === "Yes" ? true : r.fields.urban === "No" ? false : null,
        geojson: r.geojson,
      }),
    );

    console.log("Simplifying geometry for map rendering (this can take a minute)...");
    // ST_SimplifyPreserveTopology can degrade a MultiPolygon down to a plain
    // Polygon (or, at extreme tolerances, a lower-dimension geometry) —
    // ST_Multi() coerces back so it fits the strictly-typed geom_simplified
    // column; a fallback to the unsimplified geom guards the (rare, only at
    // very coarse tolerance) case where simplification empties a geometry.
    await client.query(
      `update states set geom_simplified = coalesce(ST_Multi(ST_SimplifyPreserveTopology(geom, 0.01)), geom) where geom is not null;`,
    );
    await client.query(
      `update lgas set geom_simplified = coalesce(ST_Multi(ST_SimplifyPreserveTopology(geom, 0.003)), geom) where geom is not null;`,
    );
    await client.query(
      `update wards set geom_simplified = coalesce(ST_Multi(ST_SimplifyPreserveTopology(geom, 0.001)), geom) where geom is not null;`,
    );

    console.log("\n✅ Boundary import complete.");

    const counts = await client.query(
      `select (select count(*) from states) states,
              (select count(*) from lgas) lgas,
              (select count(*) from wards) wards`,
    );
    console.table(counts.rows);

    const unmatchedLgas = lgas.length - lgas.filter((r) => stateMap.has(r.fields.statecode)).length;
    const unmatchedWards = wards.length - wards.filter((r) => lgaMap.has(r.fields.lgacode)).length;
    if (unmatchedLgas || unmatchedWards) {
      console.warn(`⚠ Skipped ${unmatchedLgas} LGAs with no matching state and ${unmatchedWards} wards with no matching LGA.`);
    }
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.error("\n❌ Import failed, rolled back:", e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
