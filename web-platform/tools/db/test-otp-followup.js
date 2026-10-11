// Tests for OTP follow-up (migration 0128, DECISIONS R150–R154): the admission visit, the
// recovery comparison, withholding RUTF, photos, scheduling, referrals, the officer's visits list,
// weekly report section L, corrections, review and rejection, and who may not see any of it.
//
// Runs in ONE transaction that is always rolled back: nothing is left behind. It uses existing
// DUMMY accounts (an OTP Officer at an OTP site, the State Coordinator for that state, another
// site's officer, a supervisor) and creates no accounts.
//
//   node test-otp-followup.js                       # 0128 already applied
//   node test-otp-followup.js --with-migration ../../supabase/migrations/0128_otp_followup_referrals_photos.sql
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
const has = (v, text) => String(typeof v === "string" ? v : JSON.stringify(v)).includes(text);

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const one = async (sql, params = []) => (await pg.query(sql, params)).rows[0];
  try {
    await pg.query("begin");
    if (migration) await pg.query(fs.readFileSync(path.resolve(migration), "utf8"));

    const officer = await one(`select p.id, f.id facility, f.state_id, f.name from profiles p join facilities f on f.id = p.facility_id
      where p.role = 'dri' and p.status = 'active' and f.facility_type = 'health_facility' and f.is_otp_site and f.is_active and p.name like '%(DUMMY)%'
      order by p.name limit 1`);
    const coordinator = await one(`select id from profiles where role = 'state_coordinator' and status = 'active' and managed_state_id = $1 order by (name like '%(DUMMY)%') desc, name limit 1`, [officer.state_id]);
    const supervisor = await one(`select id from profiles where role = 'tpm_supervisor' and status = 'active' and name like '%(DUMMY)%' order by name limit 1`);
    // The LGA Nutrition Officer of the officer's LGA reviews the OTP reports (0136, R171).
    const lgan = await one(`select p.id from profiles p join facilities s on s.id = p.facility_id join facilities o on o.lga_id = s.lga_id
      where p.role = 'dri' and p.status = 'active' and s.facility_type = 'lga_store' and o.id = $1 order by p.name limit 1`, [officer.facility]);
    const other = await one(`select p.id from profiles p join facilities f on f.id = p.facility_id where p.role = 'dri' and p.status = 'active'
      and f.is_otp_site and f.facility_type = 'health_facility' and f.id <> $1 limit 1`, [officer.facility]);

    async function as(userId, fn) {
      await pg.query("savepoint ctx");
      await pg.query("set local role authenticated");
      await pg.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
        [JSON.stringify({ sub: userId, role: "authenticated" }), userId]);
      try { return await fn(); } catch (e) { console.error("inside as():", e.message); throw e; } finally { await pg.query("reset role"); await pg.query("release savepoint ctx"); }
    }
    async function call(sql, params = []) {
      await pg.query("savepoint a");
      try { const r = (await pg.query(sql, params)).rows[0]; await pg.query("release savepoint a"); return r ? Object.values(r)[0] : null; }
      catch (e) { await pg.query("rollback to savepoint a"); await pg.query("release savepoint a"); return "error: " + e.message; }
    }
    // A read as the database owner from inside an as() block (the test's own check, not the user's access).
    const sys = async (sql, params = []) => { await pg.query("reset role"); try { return await one(sql, params); } finally { await pg.query("set local role authenticated"); } };
    const today = (await one(`select (now() at time zone 'Africa/Lagos')::date::text d`)).d;
    const day = async (n) => (await one(`select ((now() at time zone 'Africa/Lagos')::date + $1::int)::text d`, [n])).d;

    // ── First visit: screen, register, then (dated three weeks ago) the admission visit ──
    let code, admId, v1;
    await as(officer.id, async () => {
      const scr = await call(`select otp_screen($1::jsonb)`, [JSON.stringify({ sex: "F", age_months: 18, weight_kg: 7.2, height_cm: 72, muac_cm: 11.0, oedema: "absent", medical_complications: false, appetite_test: "pass" })]);
      const reg = await call(`select otp_register_child($1::jsonb)`, [JSON.stringify({ screening_id: scr.screening_id, child_name: "Zainab Follow (DUMMY)", caregiver_name: "Hadiza Follow (DUMMY)", sex: "F", confirm_not_duplicate: true })]);
      code = reg.child_code;
      const look = await call(`select otp_child_lookup($1)`, [code]);
      check("first visit", "after registration the next step is the admission visit", "admission_visit", look.next_step.step);
    });
    admId = (await one(`select a.id from otp_admissions a join otp_children c on c.id = a.child_id where c.child_code = $1`, [code])).id;
    await pg.query(`update otp_admissions set admitted_on = (now() at time zone 'Africa/Lagos')::date - 21 where id = $1`, [admId]);

    const visit = (p) => call(`select otp_record_visit($1::jsonb)`, [JSON.stringify({ child_code: code, ...p })]);
    await as(officer.id, async () => {
      check("first visit", "RUTF given is required", true, has(await visit({ admission_visit: true }), "Record the RUTF packets given"));
      v1 = await visit({ admission_visit: true, rutf_dispensed: 21, appetite_test: "good" });
      check("first visit", "admission visit is visit 1", "1/admission", `${v1.visit_number}/${v1.visit_kind}`);
      check("first visit", "dated on the admission day", await day(-21), (await sys(`select visit_on::text d from otp_visits where id = $1`, [v1.visit_id])).d);
      check("first visit", "recommended 21 = given 21, from the 92 g table", "recommended/21", `${v1.ration_status}/${v1.rutf_given}`);
      check("first visit", "baseline comparison", "baseline", v1.recovery.vs_previous);
      check("first visit", "waiting for the RUTF photo", "awaiting_photo", v1.record_status);
      check("first visit", "photo folder is {site}/{visit}/", `${officer.facility}/${v1.visit_id}/`, v1.photo_folder);
      check("schedule", "next visit due a week later", await day(-14), v1.next_visit_due);
      check("first visit", "a second admission visit is refused", true, has(await visit({ admission_visit: true, rutf_dispensed: 21 }), "already recorded"));
      check("duplicates", "a second visit on the same day is refused", true, has(await visit({ visit_on: await day(-21), weight_kg: 7.3, rutf_dispensed: 21 }), "already recorded for this child"));

      const list = await call(`select otp_my_visits()`);
      const due = list.due.find((d) => d.child_code === code);
      check("visits list", "the child is listed by Child ID as overdue", "overdue", due && due.state);
      check("visits list", "the visit waiting for its photo is listed", true, list.awaiting_photo.some((x) => x.visit_id === v1.visit_id));
      check("visits list", "no names, caregivers, addresses or phones", false, has(list, "Zainab") || has(list, "Hadiza") || has(list, "mobile"));
    });
    check("visits list", "the list view is logged", true,
      (await one(`select count(*)::int n from otp_access_log where actor = $1 and action = 'visits_list' and child_id is null`, [officer.id])).n > 0);

    // ── Photo of the RUTF given ──
    const photoPath = `${officer.facility}/${v1.visit_id}/test.jpg`;
    await as(officer.id, async () => {
      check("photo", "officer may upload to their own visit's folder", true, await call(`select otp_rutf_photo_can_upload($1)`, [photoPath]));
      check("photo", "not into another site's folder", false, await call(`select otp_rutf_photo_can_upload($1)`, [`${await day(0)}/${v1.visit_id}/x.jpg`]));
      check("photo", "attach before upload is refused", true, has(await call(`select otp_attach_visit_photo($1, $2, true)`, [v1.visit_id, photoPath]), "not finished uploading"));
    });
    await pg.query(`insert into storage.objects (bucket_id, name) values ('otp-rutf-evidence', $1)`, [photoPath]);
    await as(officer.id, async () => {
      check("photo", "attach without the no-people confirmation is refused", true, has(await call(`select otp_attach_visit_photo($1, $2, false)`, [v1.visit_id, photoPath]), "no child or caregiver"));
      const att = await call(`select otp_attach_visit_photo($1, $2, true)`, [v1.visit_id, photoPath]);
      check("photo", "attaching completes the visit", "complete", att.record_status);
      check("photo", "the officer can view the photo", true, await call(`select otp_rutf_photo_can_view($1)`, [photoPath]));
      check("photo", "the officer can list the visit's photos", 1, (await call(`select otp_visit_photo_paths($1)`, [v1.visit_id])).length);
    });

    // ── Follow-up visits: improved, then deteriorated, then a referral rule ──
    await as(officer.id, async () => {
      check("follow-up", "differs from the ration without a reason -> refused", true, has(await visit({ visit_on: await day(-14), weight_kg: 7.4, muac_cm: 11.3, oedema: "absent", rutf_dispensed: 18 }), "record the reason"));
      check("follow-up", "implausible MUAC -> refused", true, has(await visit({ visit_on: await day(-14), weight_kg: 7.4, muac_cm: 40, oedema: "absent", rutf_dispensed: 21 }), "plausible range"));
      check("follow-up", "a future date is refused", true, has(await visit({ visit_on: await day(2), weight_kg: 7.4, rutf_dispensed: 21 }), "future"));
      const v2 = await visit({ visit_on: await day(-14), weight_kg: 7.4, muac_cm: 11.3, oedema: "absent", appetite_test: "good", rutf_dispensed: 21 });
      check("follow-up", "visit 2 recorded", 2, v2.visit_number);
      check("recovery", "weight and MUAC up -> improved since the previous visit", "improved", v2.recovery.vs_previous);
      const wt = v2.recovery.measures.find((m) => m.key === "weight_kg");
      check("recovery", "weight change from the previous visit = +0.2 kg", 0.2, wt.change_from_previous);
      check("recovery", "trajectory includes the admission and visit 1", true, v2.recovery.trajectory.length >= 3);
      check("schedule", "visit 2 schedules visit 3 a week later", await day(-7), v2.next_visit_due);

      const v3 = await visit({ visit_on: await day(-7), weight_kg: 7.1, muac_cm: 11.3, oedema: "absent", appetite_test: "good", rutf_dispensed: 21 });
      check("recovery", "weight below the previous visit -> deteriorated", "deteriorated", v3.recovery.vs_previous);
      check("recovery", "weight below admission -> card footnote flag", true, v3.recovery.flags.some((f) => f.code === "C2_weight_below_admission"));
      check("recovery", "the footnote does not withhold RUTF", "recommended", v3.ration_status);
      check("next step", "home visit or refer, and the visit is still scheduled", "home_visit_or_refer", v3.next_step.step);
      check("next step", "no automatic recovery after three visits", false, v3.discharge_check.can_discharge_as_cured);

      // Visit 4 (exceptional): severe oedema -> stabilisation (G4): no RUTF recommended, no routine visit.
      check("withhold", "RUTF when none is recommended, without a reason -> refused", true,
        has(await visit({ visit_on: today, weight_kg: 7.2, muac_cm: 11.2, oedema: "+++", appetite_test: "good", rutf_dispensed: 21 }), "reason recorded"));
      const v4 = await visit({ visit_on: today, weight_kg: 7.2, muac_cm: 11.2, oedema: "+++", appetite_test: "good", rutf_dispensed: 0 });
      check("withhold", "severe oedema at visit 4 -> RUTF withheld", "withheld", v4.ration_status);
      check("withhold", "nothing recommended is stored", null, (await sys(`select rutf_prescribed from otp_visits where id = $1`, [v4.visit_id])).rutf_prescribed);
      check("withhold", "0 given needs no photo", "complete", v4.record_status);
      check("next step", "the next step is referral", "refer", v4.next_step.step);
      check("schedule", "no routine visit is scheduled", null, v4.next_visit_due);
      const list = await call(`select otp_my_visits()`);
      check("visits list", "the child appears under needs a decision", "refer", (list.needs_decision.find((x) => x.child_code === code) || {}).step);
    });

    // The programme's rule (10 Oct, migration 0132): weekly follow-up up to 12 weeks until recovery;
    // beyond 12 weeks a referral to a doctor is suggested (RUTF still recommended).
    const rs = (await one(`select params from otp_rule_sets where version = '2026-10-draft'`)).params;
    check("12 weeks", "rule set: weekly, up to 12 weeks; the visit-count rule off", "7/12/null", `${rs.visit_interval_days}/${rs.max_weeks}/${rs.max_visits}`);
    const wk11 = await one(`select otp_recovery_assessment($1, 5, jsonb_build_object('weight_kg', 7.4, 'visit_on', (now() at time zone 'Africa/Lagos')::date + 56)) r`, [admId]);
    check("12 weeks", "week 11: no referral flag", false, wk11.r.flags.some((f) => f.code === "beyond_max_weeks"));
    const wk13 = await one(`select otp_recovery_assessment($1, 5, jsonb_build_object('weight_kg', 7.4, 'visit_on', (now() at time zone 'Africa/Lagos')::date + 70)) r`, [admId]);
    const f13 = wk13.r.flags.find((f) => f.code === "beyond_max_weeks");
    check("12 weeks", "beyond 12 weeks: refer to a doctor", "refer", f13 && f13.action);
    check("12 weeks", "beyond 12 weeks: RUTF still recommended (a suggestion)", false, f13 && f13.withhold_ration);

    // ── Referral ──
    let refId;
    await as(officer.id, async () => {
      check("referral", "a destination is required", true, has(await call(`select otp_refer_child($1::jsonb)`, [JSON.stringify({ child_code: code, reason: "Severe oedema" })]), "referred to"));
      const ref = await call(`select otp_refer_child($1::jsonb)`, [JSON.stringify({ child_code: code, reason: "Severe oedema (+++) at visit 4", triggers: ["G4_oedema_severe"], destination_name: "General Hospital (DUMMY)" })]);
      refId = ref.referral_id;
      check("referral", "referral recorded", "awaiting_referral", ref.next_step.step);
      check("referral", "a second open referral is refused", true, has(await call(`select otp_refer_child($1::jsonb)`, [JSON.stringify({ child_code: code, reason: "x", destination_name: "y" })]), "open referral"));
      check("referral", "rescheduling while referred is refused", true, has(await call(`select otp_reschedule_visit($1::jsonb)`, [JSON.stringify({ child_code: code, due_on: today, reason: "x" })]), "referral first"));
      check("referral", "returned without a note is refused", true, has(await call(`select otp_update_referral($1, 'returned', '')`, [refId]), "Record what happened"));
      const back = await call(`select otp_update_referral($1, 'returned', 'Seen by the clinician; continue OTP (DUMMY)')`, [refId]);
      check("referral", "returned -> treatment continues (with the card's 4th-visit no-weight-change note)", "home_visit_or_refer", back.next_step.step);
      const look = await call(`select otp_child_lookup($1)`, [code]);
      check("referral", "the next visit is due today", today, look.next_visit && look.next_visit.due_on);
      check("lookup", "trajectory = admission + 4 visits", 5, look.trajectory.length);
      check("lookup", "the referral is in the history", "returned", look.referrals[0].status);
      check("lookup", "photos are counted per visit", 1, look.visits[0].photos);
      check("schedule", "a date in the past is refused", true, has(await call(`select otp_reschedule_visit($1::jsonb)`, [JSON.stringify({ child_code: code, due_on: await day(-1), reason: "x" })]), "from today"));
      const re = await call(`select otp_reschedule_visit($1::jsonb)`, [JSON.stringify({ child_code: code, due_on: await day(3), reason: "Caregiver travelling (DUMMY)" })]);
      check("schedule", "rescheduled with a reason", await day(3), re.due_on);
    });

    // ── Who may not see it ──
    for (const [who, id] of [["State Coordinator", coordinator && coordinator.id], ["supervisor", supervisor && supervisor.id]]) {
      if (!id) continue;
      await as(id, async () => {
        check("access", `${who} cannot open a child`, true, has(await call(`select otp_child_lookup($1)`, [code]), "Only an OTP Officer"));
        check("access", `${who} cannot list visits`, true, has(await call(`select otp_my_visits()`), "Only an OTP Officer"));
        check("access", `${who} cannot refer`, true, has(await call(`select otp_refer_child($1::jsonb)`, [JSON.stringify({ child_code: code, reason: "x", destination_name: "y" })]), "Only an OTP Officer"));
        check("access", `${who} cannot list photos`, true, has(await call(`select otp_visit_photo_paths($1)`, [v1.visit_id]), "Only an OTP Officer"));
        check("access", `${who} cannot view the RUTF photo`, false, await call(`select otp_rutf_photo_can_view($1)`, [photoPath]));
        check("access", `${who} cannot read the storage object`, 0, Number(await call(`select count(*) from storage.objects where name = $1`, [photoPath])));
        check("access", `${who} cannot read referrals directly`, true, has(await call(`select count(*) from otp_referrals`), "permission denied"));
        check("access", `${who} cannot read appointments directly`, true, has(await call(`select count(*) from otp_appointments`), "permission denied"));
        check("access", `${who} cannot call the comparison`, true, has(await call(`select otp_recovery_assessment($1, 2, '{}')`, [admId]), "permission denied"));
      });
    }
    if (other) await as(other.id, async () => {
      check("access", "another site's officer cannot open the child", true, has(await call(`select otp_child_lookup($1)`, [code]), "another OTP site"));
      check("access", "another site's officer cannot attach a photo", true, has(await call(`select otp_attach_visit_photo($1, $2, true)`, [v1.visit_id, photoPath]), "not found at your OTP site"));
      check("access", "another site's officer cannot view the photo", false, await call(`select otp_rutf_photo_can_view($1)`, [photoPath]));
    });
    if (coordinator) await as(coordinator.id, async () => {
      const agg = await call(`select otp_followup_aggregates((now() at time zone 'Africa/Lagos')::date - 30, (now() at time zone 'Africa/Lagos')::date)`);
      check("aggregates", "follow-up figures for the coordinator", true, !!agg && !!agg.counts);
      check("aggregates", "no child-level data in them", false, has(agg, code) || has(agg, "Zainab"));
    });

    // ── Weekly report: section L, a correction, under review, rejected ──
    const week = (await one(`select lower(otp_week_of((now() at time zone 'Africa/Lagos')::date - 14))::text w`)).w;
    await pg.query(`delete from otp_weekly_report_adjustments where report_id in (select id from otp_weekly_reports where facility_id = $1 and week_start = $2)`, [officer.facility, week]);
    await pg.query(`delete from otp_weekly_report_versions where report_id in (select id from otp_weekly_reports where facility_id = $1 and week_start = $2)`, [officer.facility, week]);
    await pg.query(`delete from otp_weekly_reports where facility_id = $1 and week_start = $2`, [officer.facility, week]);
    let repId;
    await as(officer.id, async () => {
      const rep = await call(`select otp_report_open($1::date)`, [week]);
      repId = rep.report_id;
      check("report L", "section L counts the second visit", 1, rep.sections.L.visits.second);
      check("report L", "recommended vs given", "21/21", `${rep.sections.L.rutf.recommended}/${rep.sections.L.rutf.given}`);
      check("report L", "improved since the previous visit", 1, rep.sections.L.recovery.improved);
      const cats = rep.sections.C.SAM.categories || {};
      check("report W3", "admission categories present (new case, relapse, readmission, returned defaulter, from stabilisation, others)", 6, Object.keys(cats).length);
      const admitted = (await sys(`select count(*)::int n from otp_admissions where facility_id = $1 and admitted_on between $2::date and $2::date + 6 and admission_type <> 'transfer_from_otp'`, [officer.facility, week])).n;
      check("report W3", "the categories add up to the week's admissions", admitted, Object.values(cats).reduce((t, c) => t + c.total, 0));
      check("report W3", "referrals to stabilisation and others present", "others,to_stabilisation", Object.keys(rep.sections.E.SAM.referred || {}).sort().join(","));
      check("correction", "a reason is required", true, has(await call(`select otp_report_adjust($1, 'L.visits.second', 2, '')`, [repId]), "reason"));
      check("correction", "section A cannot be corrected", true, has(await call(`select otp_report_adjust($1, 'A.facility', 1, 'x')`, [repId]), "cannot be corrected"));
      check("correction", "a count cannot be negative", true, has(await call(`select otp_report_adjust($1, 'L.visits.second', -1, 'x')`, [repId]), "negative"));
      const adj = await call(`select otp_report_adjust($1, 'L.visits.second', 2, 'A visit was recorded on paper only (DUMMY)')`, [repId]);
      check("correction", "kept with the calculated value", "1->2", `${adj[0].original}->${adj[0].adjusted}`);
      const comments = Object.fromEntries((rep.issues || []).filter((i) => i.severity === "blocking").map((i) => [i.code, "Explained (DUMMY)"]));
      const sub = await call(`select otp_report_submit($1, $2::jsonb, true)`, [repId, JSON.stringify(comments)]);
      check("correction", "submitted with one correction", 1, sub.adjustments);
    });
    const ver = await one(`select data, adjustments from otp_weekly_report_versions where report_id = $1 and version = 1`, [repId]);
    check("correction", "the version's data carries the corrected figure", 2, ver.data.L.visits.second);
    check("correction", "and the calculated figure is kept", 1, ver.adjustments[0].calculated);
    await as(officer.id, async () => {
      check("review", "the officer cannot decide", true, has(await call(`select otp_report_decide($1, 'approved', null)`, [repId]), "Only the LGA Nutrition Officer"));
    });
    if (coordinator) await as(coordinator.id, async () => {
      check("review", "the coordinator cannot correct figures", true, has(await call(`select otp_report_adjust($1, 'L.visits.second', 3, 'x')`, [repId]), "Only an OTP Officer"));
      check("review", "the coordinator cannot reject (the LGA Nutrition Officer decides)", true, has(await call(`select otp_report_decide($1, 'rejected', 'x')`, [repId]), "Only the LGA Nutrition Officer"));
    });
    await as(lgan.id, async () => {
      check("review", "the LGA Nutrition Officer cannot correct figures", true, has(await call(`select otp_report_adjust($1, 'L.visits.second', 3, 'x')`, [repId]), "Only an OTP Officer"));
      check("review", "opening for review -> under review", "under_review", (await call(`select otp_report_start_review($1)`, [repId])).status);
      const got = await call(`select otp_report_get($1)`, [repId]);
      check("review", "can decide while under review", true, got.can_decide);
      check("review", "rejecting needs a reason", true, has(await call(`select otp_report_decide($1, 'rejected', '')`, [repId]), "reason for rejecting"));
      check("review", "rejected", "rejected", (await call(`select otp_report_decide($1, 'rejected', 'Figures do not match the register (DUMMY)')`, [repId])).status);
    });
    await as(officer.id, async () => {
      check("review", "a rejected report can be amended", true, !has(await call(`select otp_report_start_amendment($1)`, [repId]), "error"));
      const reopened = await call(`select otp_report_open($1::date)`, [week]);
      check("review", "the amendment keeps the correction", 1, reopened.adjustments.length);
    });

    // The programme's pathway (Q23): a child recovering steadily but not yet meeting the discharge
    // criteria gets an exceptional 4th visit after visit 3, then a referral to a doctor is suggested.
    let code3;
    await as(officer.id, async () => {
      const scr = await call(`select otp_screen($1::jsonb)`, [JSON.stringify({ sex: "F", age_months: 30, weight_kg: 9.0, height_cm: 82, muac_cm: 11.2, oedema: "absent", medical_complications: false, appetite_test: "pass" })]);
      code3 = (await call(`select otp_register_child($1::jsonb)`, [JSON.stringify({ screening_id: scr.screening_id, child_name: "Hafsat Pathway (DUMMY)", sex: "F", confirm_not_duplicate: true })])).child_code;
    });
    await pg.query(`update otp_admissions set admitted_on = (now() at time zone 'Africa/Lagos')::date - 21 where child_id = (select id from otp_children where child_code = $1)`, [code3]);
    await as(officer.id, async () => {
      const v = (p) => call(`select otp_record_visit($1::jsonb)`, [JSON.stringify({ child_code: code3, appetite_test: "good", oedema: "absent", ...p })]);
      await v({ admission_visit: true, rutf_dispensed: 25 });
      await v({ visit_on: await day(-14), weight_kg: 9.2, muac_cm: 11.3, rutf_dispensed: 25 });
      const third = await v({ visit_on: await day(-7), weight_kg: 9.4, muac_cm: 11.4, rutf_dispensed: 25 });
      check("pathway", "not recovered by week 2 -> treatment continues weekly", true, third.next_step.step === "continue" && third.next_step.message.includes("of up to 12"));
      check("pathway", "the next visit is due a week later", today, third.next_visit_due);
      const fourth = await v({ visit_on: today, weight_kg: 9.5, muac_cm: 11.4, rutf_dispensed: 28 });
      check("pathway", "visit 4 is no longer the last (no 3/4-visit rule)", "continue", fourth.next_step.step);
      check("pathway", "a 5th visit is scheduled", true, !!fourth.next_visit_due);
    });
    // 12 weeks without recovery: admitted 12 weeks ago, the latest visit today -> refer to a doctor.
    await pg.query(`update otp_admissions set admitted_on = (now() at time zone 'Africa/Lagos')::date - 84 where child_id = (select id from otp_children where child_code = $1)`, [code3]);
    await as(officer.id, async () => {
      const look = await call(`select otp_child_lookup($1)`, [code3]);
      check("pathway", "12 weeks without recovery -> refer to see a doctor", true, look.next_step.step === "refer" && look.next_step.message.includes("12 weeks"));
    });

    // MNP (W6, 10 Oct): MUAC yellow -> 3 boxes (90 sachets) at once, back after 3 months.
    await as(officer.id, async () => {
      const mam = await call(`select otp_screen($1::jsonb)`, [JSON.stringify({ sex: "M", age_months: 20, weight_kg: 8.5, height_cm: 76, muac_cm: 12.0, oedema: "absent", medical_complications: false, appetite_test: "pass" })]);
      check("MNP", "MUAC yellow -> MNP: 3 boxes, 90 sachets, 3 months", "3/90/3", mam.mnp && `${mam.mnp.boxes}/${mam.mnp.sachets}/${mam.mnp.months}`);
      check("MNP", "the advice names MNP and the 3-month follow-up", true, has(mam.next_action, "MNP") && has(mam.next_action, "after 3 months"));
      const green = await call(`select otp_screen($1::jsonb)`, [JSON.stringify({ sex: "M", age_months: 20, weight_kg: 9.5, height_cm: 80, muac_cm: 13.2, oedema: "absent", medical_complications: false, appetite_test: "pass" })]);
      check("MNP", "MUAC green -> no MNP", undefined, green.mnp);
    });

    // The clinical rules are approved only by a State Nutrition Officer (Q22, 10 Oct).
    const sno = await one(`select p.id from profiles p join facilities f on f.id = p.facility_id where p.role = 'dri' and p.status = 'active' and f.facility_type = 'state_store' order by (p.name like '%(DUMMY)%') desc limit 1`);
    await as(officer.id, async () => {
      check("rules", "everyone signed in can read the rules", "2026-10-draft", (await call(`select otp_rules_view()`)).version);
      check("rules", "an OTP Officer cannot approve them", true, has(await call(`select otp_rule_set_approve('2026-10-draft', true, null)`), "Only the State Nutrition Officer"));
    });
    if (coordinator) await as(coordinator.id, async () => {
      check("rules", "a State Coordinator cannot approve them", true, has(await call(`select otp_rule_set_approve('2026-10-draft', true, null)`), "Only the State Nutrition Officer"));
    });
    if (sno) await as(sno.id, async () => {
      check("rules", "the State Nutrition Officer may approve", true, (await call(`select otp_rules_view()`)).can_approve);
      check("rules", "approval needs the review confirmed", true, has(await call(`select otp_rule_set_approve('2026-10-draft', false, null)`), "Confirm"));
      const ok = await call(`select otp_rule_set_approve('2026-10-draft', true, 'Reviewed (DUMMY)')`);
      check("rules", "approved, in force from today (rolled back)", "approved", ok.status);
    });

    // Regression: the existing visit test path (first follow-up = visit 2 without an admission visit) still works.
    await as(officer.id, async () => {
      const scr = await call(`select otp_screen($1::jsonb)`, [JSON.stringify({ sex: "M", age_months: 20, weight_kg: 8.0, height_cm: 75, muac_cm: 11.1, oedema: "absent", medical_complications: false, appetite_test: "pass" })]);
      const reg = await call(`select otp_register_child($1::jsonb)`, [JSON.stringify({ screening_id: scr.screening_id, child_name: "Musa Regress (DUMMY)", sex: "M", confirm_not_duplicate: true })]);
      const r = await call(`select otp_record_visit($1::jsonb)`, [JSON.stringify({ child_code: reg.child_code, weight_kg: 8.1, muac_cm: 11.2, oedema: "+++", rutf_dispensed: 21, dispense_note: "Caregiver travels to the hospital tomorrow (DUMMY)" })]);
      check("regression", "a follow-up without an admission visit is visit 2", 2, r.visit_number);
      check("authorise", "the OTP Officer may give RUTF when none is recommended, with the reason (Q22)", "withheld/21", `${r.ration_status}/${r.rutf_given}`);
      const auth = await sys(`select dispense_authorised_by a from otp_visits where id = $1`, [r.visit_id]);
      check("authorise", "the officer is recorded as the authoriser", true, String(auth.a).endsWith("(OTP Officer)"));
    });

    // ── The clinical answers of 11 Oct (0139, R175): discharge at MUAC 13.5 cm (Q15), on MUAC not
    // weight (Q14); recovered = 13.5+ and no clinical concern, a falling MUAC is referred (Q17). ──
    let code4, adm4;
    await as(officer.id, async () => {
      const scr = await call(`select otp_screen($1::jsonb)`, [JSON.stringify({ sex: "M", age_months: 24, weight_kg: 8.6, height_cm: 80, muac_cm: 11.0, oedema: "absent", medical_complications: false, appetite_test: "pass" })]);
      code4 = (await call(`select otp_register_child($1::jsonb)`, [JSON.stringify({ screening_id: scr.screening_id, child_name: "Sani Answers (DUMMY)", sex: "M", confirm_not_duplicate: true })])).child_code;
    });
    adm4 = (await one(`select a.id from otp_admissions a join otp_children c on c.id = a.child_id where c.child_code = $1`, [code4])).id;
    await pg.query(`update otp_admissions set admitted_on = (now() at time zone 'Africa/Lagos')::date - 70 where id = $1`, [adm4]);
    await as(officer.id, async () => {
      const v = (p) => call(`select otp_record_visit($1::jsonb)`, [JSON.stringify({ child_code: code4, appetite_test: "good", oedema: "absent", ...p })]);
      await v({ admission_visit: true, rutf_dispensed: 25 });
      await v({ visit_on: await day(-21), weight_kg: 9.0, muac_cm: 11.7, rutf_dispensed: 25 });
      const fall = await v({ visit_on: await day(-14), weight_kg: 9.2, muac_cm: 11.5, rutf_dispensed: 25 });
      check("Q17", "MUAC 11.7 then 11.5 is flagged", true, JSON.stringify(fall.recovery.flags).includes("Q17_muac_declining"));
      check("Q17", "and the next step is a referral to the clinic", "refer", fall.next_step.step);
      // Referred to the clinic and back (the referral step then clears).
      const ref = await call(`select otp_refer_child($1::jsonb)`, [JSON.stringify({ child_code: code4, reason: "MUAC falling (DUMMY)", destination_name: "Clinic (DUMMY)" })]);
      await call(`select otp_update_referral($1, 'returned', 'Treated for malaria (DUMMY)')`, [ref.referral_id]);
      const v128 = await v({ visit_on: await day(-7), weight_kg: 9.6, muac_cm: 12.8, rutf_dispensed: 28 });
      const crit128 = v128.next_step && (await call(`select otp_child_lookup($1)`, [code4])).discharge_check;
      check("Q15", "MUAC 12.8 cm does not meet discharge (13.5 needed)", "not_met",
        (crit128.criteria.find((c) => c.criterion.startsWith("MUAC")) || {}).state);
      check("Q14", "no weight-gain criterion any more", false, JSON.stringify(crit128.criteria).toLowerCase().includes("weight gain"));
      await v({ visit_on: today, weight_kg: 9.9, muac_cm: 13.6, rutf_dispensed: 28 });
      const chk = (await call(`select otp_child_lookup($1)`, [code4])).discharge_check;
      check("Q15", "MUAC 13.6 cm meets the discharge MUAC", "met", (chk.criteria.find((c) => c.criterion.startsWith("MUAC")) || {}).state);
      check("Q17", "no clinical concern is for the officer to confirm", "officer_confirms", (chk.criteria.find((c) => c.criterion.startsWith("No clinical concern")) || {}).state);
      check("Q17", "discharge as recovered is possible", true, chk.can_discharge_as_cured);
      check("Q17", "without the confirmation it is refused", true,
        has(await call(`select otp_record_outcome($1::jsonb)`, [JSON.stringify({ child_code: code4, outcome: "cured" })]), "no clinical concern"));
      const out = await call(`select otp_record_outcome($1::jsonb)`, [JSON.stringify({ child_code: code4, outcome: "cured", confirm_clinically_well: true })]);
      check("Q14", "recovered with no weight-gain confirmation", "cured", out.outcome);
    });
  } finally {
    await pg.query("rollback");
    await pg.end();
  }
  console.table(results);
  const failed = results.filter((r) => r.result === "FAIL").length;
  console.log(`${results.length - failed}/${results.length} passed (rolled back: nothing was saved)`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
