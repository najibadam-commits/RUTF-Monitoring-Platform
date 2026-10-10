// DUMMY follow-up for the OTP demo (DECISIONS R150–R153): gives the DUMMY children from
// seed-demo-otp-children.js a history of one to five weeks — the admission visit, weekly follow-up
// visits, an absence, a child whose weight falls, a child with severe oedema who is referred (some
// back at the OTP, some still away), visits waiting for their RUTF photo and children whose visit
// is overdue. Everything goes through the real functions as each site's DUMMY OTP Officer
// (otp_record_visit, otp_refer_child, otp_update_referral, otp_attach_visit_photo), so every rule,
// comparison and schedule runs as for a real child. Only the admission date is moved back, as the
// database owner, so the visits can be weekly. Photos are one labelled SAMPLE IMAGE
// (sample-assets/rutf_sachets.jpg), copied per visit in the private bucket.
//
// --remove deletes the follow-up records of DUMMY children (photos and their files, referrals,
// appointments, visits) and puts their admission dates back to the registration day.
//
//   node seed-demo-otp-followup.js
//   node seed-demo-otp-followup.js --remove
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

const BUCKET = "otp-rutf-evidence";
const draw = (s) => parseInt(crypto.createHash("sha1").update(s).digest("hex").slice(0, 8), 16) / 0xffffffff;
const r1 = (x) => Math.round(x * 10) / 10;

(async () => {
  const remove = process.argv.includes("--remove");
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  await pg.connect();
  const dummyAdmissions = `select a.id, a.child_id, a.facility_id, a.weight_kg, a.muac_cm, a.oedema, a.admitted_on, c.child_code, c.registered_at
    from otp_admissions a join otp_children c on c.id = a.child_id join otp_child_identity i on i.child_id = c.id
    where i.child_name like '%(DUMMY)%'`;
  try {
    if (remove) {
      await pg.query("begin");
      const adm = (await pg.query(dummyAdmissions)).rows;
      const ids = adm.map((a) => a.id);
      const photos = (await pg.query(`select ph.storage_path from otp_visit_photos ph join otp_visits v on v.id = ph.visit_id where v.admission_id = any($1)`, [ids])).rows.map((x) => x.storage_path);
      const ph = await pg.query(`delete from otp_visit_photos where visit_id in (select id from otp_visits where admission_id = any($1))`, [ids]);
      const rf = await pg.query(`delete from otp_referrals where admission_id = any($1)`, [ids]);
      const ap = await pg.query(`delete from otp_appointments where admission_id = any($1)`, [ids]);
      const v = await pg.query(`delete from otp_visits where admission_id = any($1)`, [ids]);
      await pg.query(`update otp_admissions a set admitted_on = c.registered_at::date from otp_children c where c.id = a.child_id and a.id = any($1)`, [ids]);
      await pg.query("commit");
      for (let i = 0; i < photos.length; i += 100) {
        const { error } = await admin.storage.from(BUCKET).remove(photos.slice(i, i + 100));
        if (error) console.warn("storage cleanup warning:", error.message);
      }
      console.log(`Removed DUMMY follow-up: ${v.rowCount} visits, ${ap.rowCount} appointments, ${rf.rowCount} referrals, ${ph.rowCount} photos (files deleted).`);
      return;
    }

    // The one sample photo, uploaded once; each visit gets a server-side copy at {site}/{visit}/demo.jpg.
    const samplePath = "_sample/rutf_sachets.jpg";
    const body = fs.readFileSync(path.join(__dirname, "sample-assets", "rutf_sachets.jpg"));
    const up = await admin.storage.from(BUCKET).upload(samplePath, body, { contentType: "image/jpeg", upsert: true });
    if (up.error) throw new Error(`upload sample: ${up.error.message}`);

    const today = new Date((await pg.query(`select current_date::text d`)).rows[0].d + "T00:00:00Z");
    const iso = (d) => d.toISOString().slice(0, 10);
    const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);
    const kids = (await pg.query(`${dummyAdmissions} and a.status = 'active'
      and not exists (select 1 from otp_appointments ap where ap.admission_id = a.id)
      and not exists (select 1 from otp_visits v where v.admission_id = a.id and v.visit_kind = 'admission')`)).rows;
    const officers = new Map((await pg.query(`select distinct on (facility_id) facility_id, id from profiles
      where role = 'dri' and status = 'active' and name like '%(DUMMY)%' order by facility_id, name`)).rows.map((o) => [o.facility_id, o.id]));

    let visits = 0, photos = 0, referrals = 0, children = 0;
    for (const k of kids) {
      const officer = officers.get(k.facility_id);
      if (!officer) continue;
      const s = k.child_code;
      const weeks = 1 + Math.floor(draw(s + "weeks") * 5);            // admitted 1–5 weeks ago
      const kind = draw(s + "kind");                                    // the child's story
      const story = kind < 0.66 ? "improving" : kind < 0.8 ? "falls" : kind < 0.88 ? "oedema" : "absent";
      const overdue = draw(s + "overdue") < 0.18;                       // the latest visit not done yet
      const admitted = addDays(today, -7 * weeks);
      await pg.query("begin");
      // Earlier single follow-up visits from seed-demo-otp-children are replaced by this history.
      await pg.query(`delete from otp_visits where admission_id = $1`, [k.id]);
      await pg.query(`update otp_admissions set admitted_on = $2 where id = $1`, [k.id, iso(admitted)]);
      await pg.query("set local role authenticated");
      await pg.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
        [JSON.stringify({ sub: officer, role: "authenticated" }), officer]);
      const call = async (fn, p) => (await pg.query(`select ${fn}($1::jsonb) r`, [JSON.stringify(p)])).rows[0].r;
      const ration = async (w) => (await pg.query(`select otp_ration($1) r`, [w])).rows[0].r;
      const recorded = [];

      const r0 = await ration(Number(k.weight_kg));
      recorded.push(await call("otp_record_visit", { child_code: s, admission_visit: true, appetite_test: "good",
        rutf_dispensed: r0.ok ? r0.packets_per_week : 0, examiner_initials: "DM", client_id: crypto.randomUUID() }));
      let w = Number(k.weight_kg), m = Number(k.muac_cm), oed = k.oedema;
      const last = overdue ? weeks - 1 : weeks;
      for (let n = 1; n <= last; n++) {
        const on = iso(addDays(admitted, 7 * n));
        if (story === "absent" && n === 2) { recorded.push(await call("otp_record_visit", { child_code: s, visit_on: on, attended: false, client_id: crypto.randomUUID() })); continue; }
        w = r1(w + (story === "falls" && n === last ? -0.3 : 0.1 + draw(s + n + "w") * 0.25));
        m = r1(Math.min(m + (story === "falls" && n === last ? 0 : 0.1 + draw(s + n + "m") * 0.15), 13.5));
        if (oed !== "absent" && oed !== null) oed = n >= 2 ? "absent" : oed === "++" ? "+" : oed;
        const severe = story === "oedema" && n === last;
        const rt = await ration(w);
        const give = severe || !rt.ok ? 0 : rt.packets_per_week;
        recorded.push(await call("otp_record_visit", { child_code: s, visit_on: on, weight_kg: w, muac_cm: m, oedema: severe ? "+++" : (oed ?? "absent"),
          appetite_test: "good", rutf_dispensed: give, examiner_initials: "DM", client_id: crypto.randomUUID() }));
        if (severe) {
          const ref = await call("otp_refer_child", { child_code: s, reason: "Severe oedema (+++) at the visit: stabilisation care (G4) (DUMMY)",
            triggers: ["G4_oedema_severe"], destination_name: "General Hospital stabilisation centre (DUMMY)", referred_on: on, client_id: crypto.randomUUID() });
          referrals += 1;
          if (draw(s + "back") < 0.5) {
            await pg.query(`select otp_update_referral($1, 'returned', 'Seen at the stabilisation centre; continue OTP (DUMMY)')`, [ref.referral_id]);
          }
        }
      }
      // Photos of the RUTF given: most are sent, a few still waiting.
      for (const v of recorded) {
        if (v.record_status !== "awaiting_photo" || draw(v.visit_id + "photo") < 0.12) continue;
        const dest = `${v.photo_folder}demo.jpg`;
        const cp = await admin.storage.from(BUCKET).copy(samplePath, dest);
        if (cp.error && !/exists/i.test(cp.error.message)) throw new Error(`copy ${dest}: ${cp.error.message}`);
        await pg.query(`select otp_attach_visit_photo($1, $2, true)`, [v.visit_id, dest]);
        photos += 1;
      }
      await pg.query("reset role");
      await pg.query("commit");
      visits += recorded.length; children += 1;
    }
    console.log(`Seeded follow-up for ${children} DUMMY children: ${visits} visits, ${referrals} referrals, ${photos} RUTF photos (one SAMPLE IMAGE).`);
    console.log("Undo: node seed-demo-otp-followup.js --remove");
  } catch (e) {
    await pg.query("rollback").catch(() => {});
    throw e;
  } finally {
    await pg.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
