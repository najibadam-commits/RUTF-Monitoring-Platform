require("dotenv").config({ quiet: true });
const { Client } = require("pg");

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const r = await client.query(`
    select conname, conrelid::regclass as table_name, confrelid::regclass as ref_table,
           pg_get_constraintdef(oid) as def
    from pg_constraint
    where contype = 'f' and connamespace = 'public'::regnamespace
    order by conrelid::regclass::text, conname;
  `);
  console.table(r.rows);
  await client.end();
})();
