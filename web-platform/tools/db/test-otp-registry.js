// Tests for the Digital OTP Admission Card (migration 0124, DECISIONS R142): privacy, Child IDs,
// the screening engine, the ration table, visits, medication, discharge and aggregates.
//
// Runs in ONE transaction that is always rolled back: nothing is left behind. It uses existing
// DUMMY accounts (an OTP Officer at an OTP site, a supervisor) and creates no accounts.
//
//   node test-otp-registry.js                       # 0124 already applied
//   node test-otp-registry.js --with-migration ../../supabase/migrations/0124_otp_child_registry.sql
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const arg = process.argv.indexOf("--with-migration");
const migration = arg > 0 ? process.argv[arg + 1] : null;
const results = [];
const check = (area, what, expected, actual) => {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ area, check: what, expected: String(expected), actual: String(actual).slice(0, 70), result: pass ? "PASS" : "FAIL" });
};

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const one = async (sql, params = []) => (await pg.query(sql, params)).rows[0];
  try {
    await pg.query("begin");
    if (migration) await pg.query(fs.readFileSync(path.resolve(migration), "utf8"));

    const officer = await one(`select p.id, f.id facility, f.lga_id, f.name from profiles p join facilities f on f.id = p.facility_id
      where p.role = 'dri' and p.status = 'active' and f.facility_type = 'health_facility' and f.is_otp_site and f.is_active and p.name like '%(DUMMY)%'
      order by p.name limit 1`);
    // A supervisor of the officer's LGA: supervisors see the aggregates of their own LGAs (0134, R169).
    const supervisor = await one(`select p.id from profiles p join supervisor_lgas s on s.profile_id = p.id
      where p.role = 'tpm_supervisor' and p.status = 'active' and p.name like '%(DUMMY)%' and s.lga_id = $1 order by p.name limit 1`, [officer.lga_id]);
    const store = await one(`select p.id from profiles p join facilities f on f.id = p.facility_id where p.role = 'dri' and f.facility_type = 'lga_store' and p.status = 'active' limit 1`);
    const otherSite = await one(`select id from facilities where facility_type = 'health_facility' and is_otp_site and is_active and id <> $1 limit 1`, [officer.facility]);

    async function as(userId, fn) {
      await pg.query("savepoint ctx");
      await pg.query("set local role authenticated");
      await pg.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
        [JSON.stringify({ sub: userId, role: "authenticated" }), userId]);
      try { return await fn(); } finally { await pg.query("reset role"); await pg.query("release savepoint ctx"); }
    }
    // One call that may fail: returns the result or "error: …", and leaves the transaction usable.
    async function call(sql, params = []) {
      await pg.query("savepoint a");
      try { const r = (await pg.query(sql, params)).rows[0]; await pg.query("release savepoint a"); return r ? Object.values(r)[0] : null; }
      catch (e) { await pg.query("rollback to savepoint a"); await pg.query("release savepoint a"); return "error: " + e.message; }
    }
    const screen = (p) => call(`select otp_screen($1::jsonb)`, [JSON.stringify(p)]);
    const base = { sex: "F", age_months: 18, weight_kg: 7.2, height_cm: 72, muac_cm: 11.0, oedema: "absent", medical_complications: false, appetite_test: "pass" };

    // 1. Access: only an OTP Officer at an OTP site.
    await as(supervisor.id, async () => {
      check("access", "supervisor cannot screen", true, String(await screen(base)).includes("Only an OTP Officer"));
      check("access", "supervisor cannot read the identity table", true, String(await call(`select count(*) from otp_child_identity`)).includes("permission denied"));
      check("access", "supervisor cannot read the children table", true, String(await call(`select count(*) from otp_children`)).includes("permission denied"));
    });
    await as(store.id, async () => {
      check("access", "LGA Nutrition Officer (store) cannot screen", true, String(await screen(base)).includes("Only an OTP Officer"));
    });
    await as(officer.id, async () => {
      check("access", "OTP Officer cannot read the identity table directly", true, String(await call(`select count(*) from otp_child_identity`)).includes("permission denied"));
    });

    // 2. The engine, as the OTP Officer.
    let code, code2;
    await as(officer.id, async () => {
      const r = async (p) => (await screen(p));
      check("engine", "incomplete inputs -> incomplete", "incomplete", (await r({ sex: "F", age_months: 18, oedema: "absent" })).pathway);
      check("engine", "implausible MUAC -> correct_inputs", "correct_inputs", (await r({ ...base, muac_cm: 40 })).pathway);
      check("engine", "under 6 months -> stabilisation", "stabilisation", (await r({ ...base, age_months: 4 })).pathway);
      check("engine", "over 59 months -> clinical review", "clinical_review", (await r({ ...base, age_months: 64 })).pathway);
      check("engine", "oedema +++ -> stabilisation", "stabilisation", (await r({ ...base, muac_cm: 12.0, oedema: "+++" })).pathway);
      check("engine", "wasting + oedema (marasmic kwashiorkor) -> stabilisation", "stabilisation", (await r({ ...base, oedema: "+" })).pathway);
      check("engine", "oedema + alone, MUAC normal -> OTP", "otp", (await r({ ...base, muac_cm: 13.0, oedema: "+" })).pathway);
      check("engine", "complications -> stabilisation", "stabilisation", (await r({ ...base, medical_complications: true })).pathway);
      check("engine", "failed appetite test -> stabilisation", "stabilisation", (await r({ ...base, appetite_test: "fail" })).pathway);
      check("engine", "appetite test not recorded -> incomplete", "incomplete", (await r({ ...base, appetite_test: null })).pathway);
      check("engine", "weight 3.2 kg -> stabilisation", "stabilisation", (await r({ ...base, weight_kg: 3.2 })).pathway);
      check("engine", "weight 3.7 kg -> clinical review (Q2)", "clinical_review", (await r({ ...base, weight_kg: 3.7 })).pathway);
      check("engine", "MUAC exactly 11.5 -> clinical review (Q1)", "clinical_review", (await r({ ...base, muac_cm: 11.5 })).pathway);
      check("engine", "MUAC 12.0 -> MAM, nutrition advice", "nutrition_advice", (await r({ ...base, muac_cm: 12.0 })).pathway);
      check("engine", "MAM with complications -> inpatient paediatric", "inpatient_paediatric", (await r({ ...base, muac_cm: 12.0, medical_complications: true })).pathway);
      check("engine", "MUAC 13.0 -> normal, praise and advise", "praise_advice", (await r({ ...base, muac_cm: 13.0 })).pathway);
      const ok = await r(base);
      check("engine", "SAM, no complications, passed appetite -> OTP", "otp", ok.pathway);
      check("engine", "result names the rule set and its status", "2026-10-draft/draft", `${ok.rule_set}/${ok.rule_status}`);

      // 3. Registration and the Child ID.
      check("register", "a non-OTP screening cannot register", true,
        String(await call(`select otp_register_child($1::jsonb)`, [JSON.stringify({ screening_id: (await r({ ...base, muac_cm: 12.0 })).screening_id, child_name: "Test Child (DUMMY)", sex: "F" })])).includes("not eligible"));
      const reg = await call(`select otp_register_child($1::jsonb)`, [JSON.stringify({ screening_id: ok.screening_id, child_name: "Amina Test (DUMMY)", caregiver_name: "Hauwa Test (DUMMY)", sex: "F", admission_source: "community" })]);
      code = reg.child_code;
      check("register", "Child ID in the Beneficiary Card format (DTAP-KTS-MTZ-0001245)", true, /^DTAP-[A-Z]{2,3}-[A-Z0-9]{3}-\d{7}$/.test(code));
      check("register", "ration at 7.2 kg = 21 packets a week (G6 X3)", 21, reg.ration.packets_per_week);
      check("register", "amoxicillin is due at admission", true, reg.due_medications.some((m) => m.medication === "amoxicillin"));
      check("register", "vitamin A shown as awaiting sign-off", true, reg.due_medications.some((m) => m.medication === "vitamin_a" && m.pending_rule));
      const ok2 = await r(base);
      const dup = await call(`select otp_register_child($1::jsonb)`, [JSON.stringify({ screening_id: ok2.screening_id, child_name: "Amina Test (DUMMY)", caregiver_name: "Hauwa Test (DUMMY)", sex: "F" })]);
      check("register", "same name, caregiver, sex and age -> possible duplicate", true, dup.possible_duplicate === true);
      const reg2 = await call(`select otp_register_child($1::jsonb)`, [JSON.stringify({ screening_id: ok2.screening_id, child_name: "Amina Test (DUMMY)", caregiver_name: "Hauwa Test (DUMMY)", sex: "F", confirm_not_duplicate: true })]);
      code2 = reg2.child_code;
      check("register", "a second child gets a different Child ID", true, !!code2 && code2 !== code);
      check("register", "the same screening cannot register twice", true,
        String(await call(`select otp_register_child($1::jsonb)`, [JSON.stringify({ screening_id: ok.screening_id, child_name: "X (DUMMY)", sex: "F" })])).includes("already been used"));
      const again = await call(`select otp_register_child($1::jsonb)`, [JSON.stringify({ screening_id: (await r(base)).screening_id, child_name: "Sync Test (DUMMY)", sex: "M", confirm_not_duplicate: true, client_id: "11111111-1111-4111-8111-111111111111" })]);
      const resent = await call(`select otp_register_child($1::jsonb)`, [JSON.stringify({ screening_id: ok.screening_id, child_name: "Sync Test (DUMMY)", sex: "M", client_id: "11111111-1111-4111-8111-111111111111" })]);
      check("register", "a re-sent registration (same client id) returns the same Child ID", again.child_code, resent.child_code);

      // 4. Lookup by Child ID.
      const prof = await call(`select otp_child_lookup($1)`, [code]);
      check("lookup", "the OTP Officer sees the child's name after entering the ID", "Amina Test (DUMMY)", prof.identity && prof.identity.child_name);
      check("lookup", "an unknown Child ID is refused", true, String(await call(`select otp_child_lookup('KT-XXX-26-99999')`)).includes("No child"));

      // 5. Visits.
      const v = (p) => call(`select otp_record_visit($1::jsonb)`, [JSON.stringify({ child_code: code, ...p })]);
      check("visit", "a visit without weight is refused", true, String(await v({ muac_cm: 11.2 })).includes("valid weight"));
      check("visit", "dispensed differs from ration without a reason -> refused", true, String(await v({ weight_kg: 7.0, muac_cm: 11.2, oedema: "absent", rutf_dispensed: 18 })).includes("record the reason"));
      const visit = await v({ weight_kg: 7.0, muac_cm: 11.2, oedema: "absent", rutf_dispensed: 21 });
      check("visit", "visit 2 recorded", 2, visit.visit_number);
      check("visit", "weight below admission weight -> alert", true, visit.alerts.some((a) => a.startsWith("Weight below admission weight")));
      check("visit", "ration recalculated at 7.0 kg = 21", 21, visit.ration.packets_per_week);
      check("visit", "deworming due at visit 2", true, visit.due_medications.some((m) => m.medication === "deworming" && m.visit === 2));

      // 6. Medication and discharge.
      const med = (p) => call(`select otp_record_medication($1::jsonb)`, [JSON.stringify({ child_code: code, ...p })]);
      check("medication", "anti-malarial before a positive test -> refused", true, String(await med({ medication: "antimalarial", status: "given", dose_text: "x" })).includes("positive malaria test"));
      check("medication", "vitamin A -> refused (awaiting sign-off)", true, String(await med({ medication: "vitamin_a", status: "given", dose_text: "x" })).includes("sign-off"));
      check("medication", "amoxicillin needs a dose", true, String(await med({ medication: "amoxicillin", status: "given" })).includes("dose"));
      check("medication", "amoxicillin recorded with its dose", true, !String(await med({ medication: "amoxicillin", status: "given", dose_text: "as prescribed (DUMMY)" })).startsWith("error"));
      check("discharge", "cured after 1 week -> refused", true,
        String(await call(`select otp_record_outcome($1::jsonb)`, [JSON.stringify({ child_code: code, outcome: "cured", confirm_clinically_well: true, confirm_weight_gain: true })])).includes("not every criterion"));
      check("discharge", "another outcome needs a reason", true,
        String(await call(`select otp_record_outcome($1::jsonb)`, [JSON.stringify({ child_code: code2, outcome: "defaulted" })])).includes("reason"));
    });

    // 7. Another OTP site's officer cannot open the child; aggregates for everyone.
    const otherOfficer = await one(`select id from profiles where role = 'dri' and status = 'active' and facility_id = $1 limit 1`, [otherSite.id]);
    if (otherOfficer) await as(otherOfficer.id, async () => {
      check("access", "an OTP Officer at another site cannot open the child", true, String(await call(`select otp_child_lookup($1)`, [code])).includes("another OTP site"));
    });
    await as(supervisor.id, async () => {
      check("access", "a supervisor cannot open a child by ID", true, String(await call(`select otp_child_lookup($1)`, [code])).includes("Only an OTP Officer"));
      const agg = await call(`select otp_aggregates(current_date - 30, current_date, $1, null)`, [officer.lga_id]);
      check("aggregates", "a supervisor sees the admissions count", true, Number(agg.cohort.admissions) >= 3);
      check("aggregates", "small counts by sex and age are hidden", true, agg.suppressed === true && Object.values(agg.admissions_by_sex_age).every((n) => n === null || n >= 5));
      check("aggregates", "no names or Child IDs in the aggregates", false, JSON.stringify(agg).includes("DUMMY") || JSON.stringify(agg).includes(code));
    });
    const audit = await one(`select count(*)::int n, bool_and(changes ->> 'values' = 'not recorded (child-level data)') clean from audit_log where table_name like 'otp_%' and table_name not in ('otp_rule_sets','otp_ration_bands','otp_child_id_config') and at > now() - interval '1 minute'`);
    check("audit", "child-table audit entries hold no values", true, audit.n === 0 || audit.clean === true);
    const log = await one(`select count(*)::int n from otp_access_log where child_id = (select id from otp_children where child_code = $1)`, [code]);
    check("audit", "registration and lookup are in the access log", true, log.n >= 2);
    check("ration", "3.9 kg -> no rule (struck-out row, Q2)", false, (await one(`select otp_ration(3.9) r`)).r.ok);
    check("ration", "12.3 kg -> 35 a week (G6 X7)", 35, (await one(`select otp_ration(12.3) r`)).r.packets_per_week);
    check("ration", "5.5 kg -> 18 a week (G6 X2)", 18, (await one(`select otp_ration(5.5) r`)).r.packets_per_week);

    // ── Correcting a child's or caregiver's details (0140, R176; DPIA §9) ──
    const fix = (p) => call(`select otp_correct_child($1::jsonb)`, [JSON.stringify({ child_code: code, ...p })]);
    await as(officer.id, async () => {
      check("correct", "a reason is required", true, String(await fix({ child_name: "Amina Corrected (DUMMY)", source: "caregiver_request" })).includes("reason"));
      check("correct", "who asked is required", true, String(await fix({ child_name: "Amina Corrected (DUMMY)", reason: "x" })).includes("who asked"));
      check("correct", "the name cannot be emptied", true, String(await fix({ child_name: " ", reason: "x", source: "officer_error" })).includes("cannot be empty"));
      check("correct", "a bad mobile number is refused", true, String(await fix({ mobile_number: "12ab", reason: "x", source: "officer_error" })).includes("7 to 15 digits"));
      const add = await fix({ mobile_number: "0803 123 4567", reason: "Caregiver gave a number (DUMMY)", source: "caregiver_request" });
      check("correct", "a mobile number can be added", '["mobile number"]', JSON.stringify(add.fields_changed));
      const ok = await fix({ child_name: "Amina Corrected (DUMMY)", mobile_number: "", reason: "Spelling on the card; caregiver asked not to be phoned (DUMMY)", source: "caregiver_request" });
      check("correct", "name corrected and mobile removed", '["child name","mobile number removed"]', JSON.stringify(ok.fields_changed));
      const card = await call(`select otp_child_lookup($1)`, [code]);
      check("correct", "the card shows the new name", "Amina Corrected (DUMMY)", card.identity.child_name);
      check("correct", "and no mobile number", null, card.identity.mobile_number ?? null);
      check("correct", "the history lists fields, reason and who — no values", true,
        ok.corrections.length === 2 && !JSON.stringify(ok.corrections).includes("Amina Corrected") && !JSON.stringify(ok.corrections).includes("0803") && !!ok.corrections[0].by);
      check("correct", "nothing changed is refused", true, String(await fix({ child_name: "Amina Corrected (DUMMY)", reason: "x", source: "other" })).includes("Nothing was changed"));
      const dob = await fix({ date_of_birth: "2024-10-01", reason: "Birth certificate seen (DUMMY)", source: "caregiver_request" });
      check("correct", "a date of birth recalculates the age at registration", true, dob.fields_changed.includes("date of birth"));
      check("correct", "a date of birth after registration is refused", true, String(await fix({ date_of_birth: "2099-01-01", reason: "x", source: "other" })).includes("after the registration"));
    });
    // Every audit row for this child's identity (one transaction: they share a timestamp).
    const fixAudit = JSON.stringify((await pg.query(`select changes from audit_log where table_name = 'otp_child_identity' and row_id = (select id::text from otp_children where child_code = $1)`, [code])).rows);
    check("correct", "the audit trail records fields but not values", true,
      fixAudit.includes("child_name") && fixAudit.includes("mobile_number") && !fixAudit.includes("Amina Corrected") && !fixAudit.includes("0803"));
    await as(supervisor.id, async () => {
      check("correct", "a supervisor cannot correct", true, String(await fix({ child_name: "X", reason: "x", source: "other" })).includes("Only an OTP Officer"));
    });
    if (otherOfficer) await as(otherOfficer.id, async () => {
      check("correct", "another site's officer cannot correct", true, String(await fix({ child_name: "X", reason: "x", source: "other" })).includes("another OTP site"));
    });
  } catch (e) {
    console.error("ERROR", e.message);
    process.exitCode = 1;
  } finally {
    await pg.query("rollback").catch(() => {});
    await pg.end();
  }
  console.table(results);
  const failed = results.filter((r) => r.result !== "PASS").length;
  console.log(`\n${results.length - failed}/${results.length} passed, ${failed} failed. Rolled back: nothing was changed.`);
  if (failed) process.exitCode = 1;
})();
