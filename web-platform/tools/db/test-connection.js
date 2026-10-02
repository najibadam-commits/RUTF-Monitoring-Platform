require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    const r = await client.query("select now(), version();");
    console.log("CONNECTED:", r.rows[0]);
  } catch (e) {
    console.error("CONNECTION FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
