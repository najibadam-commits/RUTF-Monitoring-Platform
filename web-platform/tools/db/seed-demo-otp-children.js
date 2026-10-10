// DUMMY children for the Digital OTP Admission Card demo (DECISIONS R143). For a spread of OTP
// sites, each site's DUMMY OTP Officer screens children through the real functions (otp_screen,
// otp_register_child, otp_record_visit, otp_record_medication) — so every rule and check runs
// exactly as for a real child: some are admitted, some sent to stabilisation care, some moderate or
// normal. Every child's name ends "(DUMMY)". --remove deletes them, their admissions, visits,
// medication, access-log entries, and the screenings those officers recorded (Child IDs are never
// reused, so the counters stay where they are).
//
//   node seed-demo-otp-children.js            # add (skips sites that already have DUMMY children)
//   node seed-demo-otp-children.js --remove
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const crypto = require("crypto");

const SITES = 40;
const FIRST = ["Amina", "Fatima", "Zainab", "Hauwa", "Maryam", "Aisha", "Khadija", "Halima", "Musa", "Ibrahim", "Abubakar", "Usman", "Sani", "Yusuf", "Aliyu", "Bashir"];
const LAST = ["Bello", "Sani", "Lawal", "Musa", "Abdullahi", "Garba", "Usman", "Idris", "Shehu", "Danjuma"];
const draw = (s) => parseInt(crypto.createHash("sha1").update(s).digest("hex").slice(0, 8), 16) / 0xffffffff;
const pick = (arr, s) => arr[Math.floor(draw(s) * arr.length)];

(async () => {
  const remove = process.argv.includes("--remove");
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  try {
    await pg.query("begin");
    if (remove) {
      const kids = (await pg.query(`select c.id from otp_children c join otp_child_identity i on i.child_id = c.id where i.child_name like '%(DUMMY)%'`)).rows.map((r) => r.id);
      const adm = (await pg.query(`select id from otp_admissions where child_id = any($1)`, [kids])).rows.map((r) => r.id);
      const m = await pg.query(`delete from otp_medications where admission_id = any($1)`, [adm]);
      const v = await pg.query(`delete from otp_visits where admission_id = any($1)`, [adm]);
      await pg.query(`update otp_screenings set child_id = null where child_id = any($1)`, [kids]);
      const a = await pg.query(`delete from otp_admissions where id = any($1)`, [adm]);
      await pg.query(`delete from otp_access_log where child_id = any($1)`, [kids]);
      const c = await pg.query(`delete from otp_children where id = any($1)`, [kids]);
      const s = await pg.query(`delete from otp_screenings where recorded_by in (select id from profiles where name like '%(DUMMY)%')`);
      await pg.query("commit");
      console.log(`Removed ${c.rowCount} DUMMY children, ${a.rowCount} admissions, ${v.rowCount} visits, ${m.rowCount} medication records, ${s.rowCount} screenings.`);
      return;
    }

    const officers = (await pg.query(`
      select distinct on (f.id) p.id, f.id facility, f.name from profiles p join facilities f on f.id = p.facility_id
      where p.role = 'dri' and p.status = 'active' and p.name like '%(DUMMY)%' and f.facility_type = 'health_facility' and f.is_otp_site and f.is_active
        and not exists (select 1 from otp_children c join otp_child_identity i on i.child_id = c.id where c.facility_id = f.id and i.child_name like '%(DUMMY)%')
      order by f.id, p.name limit $1`, [SITES])).rows;

    const asOfficer = async (id) => {
      await pg.query("set local role authenticated");
      await pg.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: id, role: "authenticated" }), id]);
    };
    const call = async (fn, p) => (await pg.query(`select ${fn}($1::jsonb) r`, [JSON.stringify(p)])).rows[0].r;

    let admitted = 0, screened = 0, visits = 0;
    for (const o of officers) {
      await asOfficer(o.id);
      // Per site: 3 admitted, plus 1 moderate, 1 normal and (every 4th site) 1 to stabilisation care.
      const plan = ["sam", "sam", "sam_oedema", "mam", "normal"];
      if (draw(o.facility + "stab") < 0.25) plan.push("stab");
      for (const [i, kind] of plan.entries()) {
        const seed = `${o.facility}:${i}`;
        const sex = draw(seed + "sex") < 0.52 ? "F" : "M";
        const age = 6 + Math.floor(draw(seed + "age") * 48);
        const weight = Math.round((4.5 + age * 0.1 + draw(seed + "w") * 1.5) * 10) / 10;
        const p = { sex, age_months: age, weight_kg: weight, height_cm: Math.round(60 + age * 0.6), oedema: "absent",
                    medical_complications: false, appetite_test: "pass", client_id: crypto.randomUUID() };
        if (kind === "sam") p.muac_cm = Math.round((10.2 + draw(seed + "m") * 1.2) * 10) / 10;            // 10.2–11.4
        if (kind === "sam_oedema") { p.muac_cm = 12.0 + Math.round(draw(seed + "m") * 5) / 10; p.oedema = draw(seed + "o") < 0.6 ? "+" : "++"; }
        if (kind === "mam") p.muac_cm = 11.7 + Math.round(draw(seed + "m") * 7) / 10;                        // 11.7–12.4
        if (kind === "normal") p.muac_cm = 12.8 + Math.round(draw(seed + "m") * 15) / 10;
        if (kind === "stab") { p.muac_cm = 10.6; p.medical_complications = true; }
        const res = await call("otp_screen", p);
        screened += 1;
        if (res.pathway !== "otp") continue;
        const name = `${pick(FIRST, seed + "f")} ${pick(LAST, seed + "l")} (DUMMY)`;
        const reg = await call("otp_register_child", {
          screening_id: res.screening_id, child_name: name, caregiver_name: `${pick(FIRST, seed + "cf")} ${pick(LAST, seed + "l")} (DUMMY)`,
          physical_address: "DUMMY address", mobile_number: "+234 800 000 0000", sex, admission_source: pick(["community", "self", "community", "other_centre"], seed + "src"),
          walking_hours: Math.round(draw(seed + "walk") * 30) / 10, confirm_not_duplicate: true, client_id: crypto.randomUUID(),
        });
        admitted += 1;
        await call("otp_record_medication", { child_code: reg.child_code, medication: "amoxicillin", status: "given", dose_text: "As prescribed (DUMMY)" });
        await call("otp_record_medication", { child_code: reg.child_code, medication: "malaria_test", status: draw(seed + "mal") < 0.3 ? "test_positive" : "test_negative" });
        // A first follow-up visit for about half of them, with the ration from the table.
        if (draw(seed + "visit") < 0.5) {
          const w = Math.round((weight + 0.2) * 10) / 10;
          const ration = (await pg.query(`select otp_ration($1) r`, [w])).rows[0].r;
          await call("otp_record_visit", { child_code: reg.child_code, weight_kg: w, muac_cm: p.muac_cm + 0.2, oedema: "absent", appetite_test: "good",
            rutf_dispensed: ration.ok ? ration.packets_per_week : null, examiner_initials: "DM", client_id: crypto.randomUUID() });
          visits += 1;
        }
      }
      await pg.query("reset role");
    }
    await pg.query("commit");
    console.log(`Seeded ${officers.length} OTP sites: ${screened} DUMMY screenings, ${admitted} children admitted, ${visits} follow-up visits.`);
    console.log("Undo: node seed-demo-otp-children.js --remove");
  } catch (e) {
    await pg.query("rollback").catch(() => {});
    throw e;
  } finally {
    await pg.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
