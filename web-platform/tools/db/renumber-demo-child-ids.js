// Renumbers the DUMMY demo children into the RUTF-DTAP Beneficiary Card's Child ID format
// (DTAP-KTS-MTZ-0001245; migration 0130, DECISIONS R157), in the order they were registered, per
// LGA, using each LGA's counter so the next real child continues from there. DUMMY children only
// (name ending "(DUMMY)"): a real child's Child ID is permanent and is never changed. Children
// already in the new format are left as they are, so re-running changes nothing.
//
//   node renumber-demo-child-ids.js
require("dotenv").config({ quiet: true });
const { Client } = require("pg");

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  try {
    await pg.query("begin");
    const kids = (await pg.query(`
      select c.id, c.child_code, c.lga_id from otp_children c join otp_child_identity i on i.child_id = c.id
      where i.child_name like '%(DUMMY)%' and c.child_code not like 'DTAP-%'
      order by c.lga_id, c.registered_at, c.child_code`)).rows;
    let changed = 0;
    const sample = [];
    for (const k of kids) {
      const cfg = (await pg.query(`select prefix, include_year, digits, next_number from otp_child_id_config where lga_id = $1 for update`, [k.lga_id])).rows[0];
      if (!cfg || !cfg.prefix.startsWith("DTAP-")) continue;
      const code = `${cfg.prefix}${cfg.include_year ? "-" + String(new Date().getFullYear()).slice(2) : ""}-${String(cfg.next_number).padStart(cfg.digits, "0")}`;
      await pg.query(`update otp_children set child_code = $2 where id = $1`, [k.id, code]);
      await pg.query(`update otp_child_id_config set next_number = next_number + 1, updated_at = now() where lga_id = $1`, [k.lga_id]);
      if (sample.length < 3) sample.push(`${k.child_code} -> ${code}`);
      changed += 1;
    }
    await pg.query("commit");
    console.log(`Renumbered ${changed} DUMMY children into the Beneficiary Card format. ${sample.join(", ")}`);
  } catch (e) {
    await pg.query("rollback").catch(() => {});
    throw e;
  } finally {
    await pg.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
