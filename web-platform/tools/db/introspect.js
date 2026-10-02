require("dotenv").config({ quiet: true });
const { Client } = require("pg");

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const tables = await client.query(`
    select table_name, table_type from information_schema.tables
    where table_schema = 'public' order by table_name;
  `);
  console.log("=== public tables ===");
  console.table(tables.rows);

  for (const row of tables.rows) {
    if (row.table_type !== "BASE TABLE") continue;
    const cols = await client.query(
      `select column_name, data_type, is_nullable, column_default
       from information_schema.columns where table_schema='public' and table_name=$1
       order by ordinal_position;`,
      [row.table_name],
    );
    const count = await client.query(`select count(*)::int as n from "${row.table_name}"`);
    console.log(`\n--- ${row.table_name} (${count.rows[0].n} rows) ---`);
    console.table(cols.rows);
  }

  const exts = await client.query("select extname, extversion from pg_extension order by extname;");
  console.log("\n=== extensions ===");
  console.table(exts.rows);

  const enums = await client.query(`
    select t.typname, e.enumlabel
    from pg_type t join pg_enum e on t.oid = e.enumtypid
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' order by t.typname, e.enumsortorder;
  `);
  console.log("\n=== enums ===");
  console.table(enums.rows);

  await client.end();
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
