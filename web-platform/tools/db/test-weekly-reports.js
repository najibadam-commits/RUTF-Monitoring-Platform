// Tests for the Weekly OTP Site Report and approval workflow (migration 0126, DECISIONS R147).
// ONE transaction, always rolled back; existing DUMMY accounts only (an OTP Officer at an OTP site
// with DUMMY children, the State Coordinator, a supervisor). Nothing is left behind.
//
//   node test-weekly-reports.js
//   node test-weekly-reports.js --with-migration ../../supabase/migrations/0126_otp_weekly_reports.sql
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const arg = process.argv.indexOf("--with-migration");
const migration = arg > 0 ? process.argv[arg + 1] : null;
const results = [];
const check = (area, what, expected, actual) => {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ area, check: what, expected: String(expected).slice(0, 40), actual: String(actual).slice(0, 70), result: pass ? "PASS" : "FAIL" });
};

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const one = async (sql, params = []) => (await pg.query(sql, params)).rows[0];
  try {
    await pg.query("begin");
    if (migration) await pg.query(fs.readFileSync(path.resolve(migration), "utf8"));
    const officer = await one(`select p.id, p.facility_id from profiles p where p.email = 'abubakar.dauda@rutf-demo.example'`);
    const sc = await one(`select p.id from profiles p join facilities f on f.state_id = p.managed_state_id
      where p.role = 'state_coordinator' and p.status = 'active' and f.id = $1 order by p.name limit 1`, [officer.facility_id]);
    const supervisor = await one(`select id from profiles where role = 'tpm_supervisor' and status = 'active' and name like '%(DUMMY)%' limit 1`);
    // The LGA Nutrition Officer of the officer's LGA reviews the OTP reports (0136, R171).
    const lgan = await one(`select p.id from profiles p join facilities s on s.id = p.facility_id join facilities o on o.lga_id = s.lga_id
      where p.role = 'dri' and p.status = 'active' and s.facility_type = 'lga_store' and o.id = $1 order by p.name limit 1`, [officer.facility_id]);

    async function as(userId, fn) {
      await pg.query("savepoint ctx");
      await pg.query("set local role authenticated");
      await pg.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
        [JSON.stringify({ sub: userId, role: "authenticated" }), userId]);
      try { return await fn(); } finally { await pg.query("reset role"); await pg.query("release savepoint ctx"); }
    }
    async function call(sql, params = []) {
      await pg.query("savepoint a");
      try { const r = (await pg.query(sql, params)).rows[0]; await pg.query("release savepoint a"); return r ? Object.values(r)[0] : null; }
      catch (e) { await pg.query("rollback to savepoint a"); await pg.query("release savepoint a"); return "error: " + e.message; }
    }

    // This week (the DUMMY children were admitted this week) and last week (ledger data).
    const thisWeek = (await one(`select lower(otp_week_of(current_date))::text d`)).d;
    const lastWeek = (await one(`select lower(otp_week_of(current_date - 7))::text d`)).d;
    const iso = (d) => d; // dates kept as text (a JS Date would shift them by the UTC+1 offset)

    let lastReportId;
    // New cases admitted at the site this week, counted directly (the demo seeds move admission dates).
    const expectedNew = (await one(`select count(*)::int n from otp_admissions where facility_id = $1 and admission_type = 'new_case'
      and admitted_on between lower(otp_week_of(current_date)) and lower(otp_week_of(current_date)) + 6`, [officer.facility_id])).n;
    await as(officer.id, async () => {
      const cur = await call(`select otp_report_open($1::date)`, [iso(thisWeek)]);
      check("week", "the week starts on a Monday", 1, new Date(cur.week_start + "T00:00:00Z").getUTCDay());
      check("week", "the week ends 6 days later", true, (new Date(cur.week_end) - new Date(cur.week_start)) / 86400000 === 6);
      const B = cur.sections.B.SAM, C = cur.sections.C.SAM, F = cur.sections.F.SAM;
      check("caseload", `new cases this week = the site's new-case admissions (${expectedNew})`, expectedNew, C.total);
      check("caseload", "new cases by sex add up", C.total, C.M + C.F);
      check("caseload", "new cases by age group add up", C.total, C.M_6_23 + C.M_24_59 + C.F_6_23 + C.F_24_59 + C.outside_6_59);
      check("caseload", "calculated closing = actual closing", F.actual.total, F.calculated.total);
      check("caseload", "closing = opening + new (no exits)", B.total + C.total, F.actual.total);
      check("not applicable", "HR MAM is not applicable, not zero", "not_applicable", cur.sections.B.HR_MAM.status);
      check("missing", "MNP never recorded -> not recorded, not zero", "not_recorded", cur.sections.H.status);
      check("missing", "no IYCF sessions -> none recorded", "none_recorded", cur.sections.J.status);
      check("screening", "MUAC screening total matches the screenings", true, cur.sections.I.total.total >= 3);
      check("submit", "the current week cannot be submitted yet", true,
        String(await call(`select otp_report_submit($1, '{}'::jsonb, true)`, [cur.report_id])).includes("not over yet"));

      // MNP and IYCF forms.
      const d = iso(lastWeek);
      check("forms", "MNP receipt recorded", true, !String(await call(`select otp_record_mnp_stock($1::jsonb)`, [JSON.stringify({ movement_date: d, kind: "receipt", sachets: 300 })])).startsWith("error"));
      check("forms", "MNP distribution recorded", true, !String(await call(`select otp_record_mnp_stock($1::jsonb)`, [JSON.stringify({ movement_date: d, kind: "distributed", sachets: 120 })])).startsWith("error"));
      check("forms", "an MNP adjustment needs a reason", true, String(await call(`select otp_record_mnp_stock($1::jsonb)`, [JSON.stringify({ movement_date: d, kind: "adjustment", sachets: -5 })])).includes("reason"));
      check("forms", "MNP: 1 child started (3 boxes at once)", true, !String(await call(`select otp_record_mnp_doses($1::jsonb)`, [JSON.stringify({ given_on: d, event: "started", children: 1 })])).startsWith("error"));
      check("forms", "MNP: 2 children back for the 3-month follow-up", true, !String(await call(`select otp_record_mnp_doses($1::jsonb)`, [JSON.stringify({ given_on: d, event: "follow_up", children: 2 })])).startsWith("error"));
      check("forms", "IYCF: a total that is not the sum of the groups is refused (W8)", true, String(await call(`select otp_record_iycf_session($1::jsonb)`, [JSON.stringify({ held_on: d, kind: "iycf_support_group", pregnant_women: 6, breastfeeding_women: 9, total_participants: 14 })])).includes("must equal"));
      check("forms", "IYCF session recorded", true, !String(await call(`select otp_record_iycf_session($1::jsonb)`, [JSON.stringify({ held_on: d, kind: "iycf_support_group", pregnant_women: 6, breastfeeding_women: 9 })])).startsWith("error"));
      check("forms", "a future date is refused", true, String(await call(`select otp_record_mnp_doses($1::jsonb)`, [JSON.stringify({ given_on: "2099-01-01", dose_number: 1, children: 1 })])).includes("future"));

      const last = await call(`select otp_report_open($1::date)`, [iso(lastWeek)]);
      lastReportId = last.report_id;
      const H = last.sections.H;
      check("MNP", "the child started took 90 sachets out of stock: closing = 300 − 120 − 90", 90, H.expected_closing);
      check("MNP", "children started = 1, back for follow-up = 2", "1/2", `${H.children.started}/${H.children.follow_up}`);
      check("MNP", "pack: 150 a carton, 30 a box, 3 boxes a child (W6)", "150/30/3", `${H.pack.sachets_per_carton}/${H.pack.sachets_per_box}/${H.pack.boxes_per_child}`);
      check("MNP", "pack size configured -> no pack-size note", false, last.issues.some((i) => i.code === "mnp_pack_size"));
      check("IYCF", "total attendance = pregnant + breastfeeding + other (W8: 6 + 9)", 15, last.sections.J.total_participants);
      const G = last.sections.G;
      check("RUTF", "expected closing = opening + received − dispensed − issued − losses + adjustments", G.expected_closing,
        G.opening + G.received - G.dispensed - G.issued - G.losses + G.adjustments);
      const blocking = last.issues.filter((i) => i.severity === "blocking");
      // Make sure there is a blocking issue to explain: add a physical MNP count that does not match.
      await call(`select otp_record_mnp_stock($1::jsonb)`, [JSON.stringify({ movement_date: d, kind: "physical_count", sachets: 80 })]);
      const last2 = await call(`select otp_report_open($1::date)`, [iso(lastWeek)]);
      check("MNP", "count 80 vs expected 90 -> blocking discrepancy of −10", -10, last2.sections.H.discrepancy);
      const codes = last2.issues.filter((i) => i.severity === "blocking").map((i) => i.code);
      check("submit", "submission without explanations is refused", true,
        String(await call(`select otp_report_submit($1, '{}'::jsonb, true)`, [lastReportId])).includes("Explain each flagged issue"));
      check("submit", "submission without the review confirmation is refused", true,
        String(await call(`select otp_report_submit($1, '{}'::jsonb, false)`, [lastReportId])).includes("Confirm"));
      const comments = Object.fromEntries(codes.map((c) => [c, "Explained in the test (DUMMY)"]));
      const sub = await call(`select otp_report_submit($1, $2::jsonb, true)`, [lastReportId, JSON.stringify(comments)]);
      check("submit", "submitted as version 1", 1, sub.version);
      check("submit", "a submitted report is locked", true,
        String(await call(`select otp_report_save_comments($1, '{}'::jsonb)`, [lastReportId])).includes("cannot be changed"));
      check("approve", "the OTP Officer cannot approve", true,
        String(await call(`select otp_report_decide($1, 'approved', null)`, [lastReportId])).includes("Only the LGA Nutrition Officer"));
      void blocking;
    });

    const notified = await one(`select count(*)::int n from notifications where user_id = $1 and type = 'weekly_report'`, [lgan.id]);
    check("notify", "the LGA Nutrition Officer was notified", true, notified.n >= 1);

    await as(supervisor.id, async () => {
      check("access", "a supervisor cannot decide", true, String(await call(`select otp_report_decide($1, 'approved', null)`, [lastReportId])).includes("Only the LGA Nutrition Officer"));
      const sov = await call(`select otp_reports_overview(current_date - 7)`);
      const supLgas = (await pg.query(`select count(distinct f.lga_id)::int n from facilities f where f.is_otp_site and f.lga_id in (select lga_id from supervisor_lgas where profile_id = $1)`, [supervisor.id])).rows[0].n;
      check("access", "a supervisor sees only the OTP sites of their LGAs", true, new Set(sov.sites.map((x) => x.lga)).size <= supLgas);
    });

    await as(sc.id, async () => {
      const ov = await call(`select otp_reports_overview(current_date - 7)`);
      check("overview", "every OTP site in the state is expected", true, ov.expected > 100);
      check("overview", "the test site's report is waiting for review", "submitted", (ov.sites.find((x) => x.facility_id === officer.facility_id) || {}).status);
      check("overview", "no child data in the overview", false, JSON.stringify(ov).includes("(DUMMY)") && JSON.stringify(ov).includes("child_name"));
      check("return", "returning needs a note", true, String(await call(`select otp_report_decide($1, 'returned', '')`, [lastReportId])).includes("needs correcting"));
      const ret = await call(`select otp_report_decide($1, 'returned', 'Recount the MNP (DUMMY)')`, [lastReportId]);
      check("return", "returned", "returned", ret.status);
    });

    await as(officer.id, async () => {
      const again = await call(`select otp_report_open($1::date)`, [iso(lastWeek)]);
      check("return", "the officer sees the return note", "Recount the MNP (DUMMY)", again.last_decision && again.last_decision.note);
      const codes = again.issues.filter((i) => i.severity === "blocking").map((i) => i.code);
      const sub2 = await call(`select otp_report_submit($1, $2::jsonb, true)`, [lastReportId, JSON.stringify(Object.fromEntries(codes.map((c) => [c, "Recounted (DUMMY)"])))]);
      check("resubmit", "resubmitted as version 2", 2, sub2.version);
    });

    await as(sc.id, async () => {
      check("approve", "the State Coordinator cannot accept (technical oversight only)", true,
        String(await call(`select otp_report_decide($1, 'approved', null)`, [lastReportId])).includes("Only the LGA Nutrition Officer"));
    });

    await as(lgan.id, async () => {
      const ov = await call(`select otp_reports_overview(current_date - 7)`);
      check("overview", "the LGA Nutrition Officer sees only their LGA", 1, new Set(ov.sites.map((x) => x.lga)).size);
      const ok = await call(`select otp_report_decide($1, 'approved', 'Thank you (DUMMY)')`, [lastReportId]);
      check("approve", "the LGA Nutrition Officer accepts", "approved", ok.status);
      const full = await call(`select otp_report_get($1)`, [lastReportId]);
      check("history", "both versions are kept", 2, full.versions.length);
      check("history", "version 1 kept its return note", "Recount the MNP (DUMMY)", full.versions[1].decision_note);
      check("history", "acceptance is recorded against the LGA Nutrition Officer", true, !!full.versions[0].decided_by && !!full.versions[0].decided_at);
    });

    await as(officer.id, async () => {
      check("amend", "an approved report is locked", true,
        String(await call(`select otp_report_submit($1, '{}'::jsonb, true)`, [lastReportId])).includes("cannot be submitted again"));
      check("amend", "the officer can start an amendment", true, !String(await call(`select otp_report_start_amendment($1)`, [lastReportId])).startsWith("error"));
      const codes = (await call(`select otp_report_open($1::date)`, [iso(lastWeek)])).issues.filter((i) => i.severity === "blocking").map((i) => i.code);
      check("amend", "an amendment needs a reason", true,
        String(await call(`select otp_report_submit($1, $2::jsonb, true)`, [lastReportId, JSON.stringify(Object.fromEntries(codes.map((c) => [c, "x"])))])).includes("reason for amending"));
      const am = await call(`select otp_report_submit($1, $2::jsonb, true, 'Late MNP receipt found (DUMMY)')`, [lastReportId, JSON.stringify(Object.fromEntries(codes.map((c) => [c, "x"])))]);
      check("amend", "the amendment is version 3, for approval", 3, am.version);
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
