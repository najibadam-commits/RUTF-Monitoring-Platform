require("dotenv").config({ quiet: true });
const { Client } = require("pg");
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const t = await client.query(
    "select (select count(*) from states) states, (select count(*) from lgas) lgas, (select count(*) from wards) wards, (select count(*) from settlements) settlements, (select count(*) from activity_sites) activity_sites"
  );
  console.log(t.rows[0]);
  await client.end();
})();
