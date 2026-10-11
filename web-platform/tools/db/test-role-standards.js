// Tests for the role standardisation (migrations 0134–0137, DECISIONS R169–R171):
//   A. jurisdictions — who sees which facilities' stock
//   B. supply requests OTP site -> LGA store: submit, query, answer, approve (no stock moves),
//      dispatch through the ordinary stock issue, receipt; who may and may not act
//   C. supply requests LGA store -> State store
//   D. the OTP weekly report: query and answer, the LGA Nutrition Officer accepts, the State
//      Coordinator may query or return but not accept
//   E. the LGA weekly report combined from the accepted OTP reports, submitted by the LGA
//      Nutritionist, queried and accepted by the State Nutrition Officer; the statewide report
//
// Runs in ONE transaction that is always rolled back: nothing is left behind. It uses existing
// DUMMY accounts and creates no accounts.
//
//   node test-role-standards.js
require("dotenv").config({ quiet: true });
const { Client } = require("pg");

const results = [];
const check = (area, what, expected, actual) => {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ area, what, expected: JSON.stringify(expected), actual: JSON.stringify(actual), result: pass ? "PASS" : "FAIL" });
};
const has = (v, s) => JSON.stringify(v).includes(s);

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const one = async (sql, params = []) => (await pg.query(sql, params)).rows[0];
  try {
    await pg.query("begin");

    // ── The cast (DUMMY accounts) ──
    // An OTP Officer whose site has a submitted DUMMY weekly report (used in D and E).
    const officer = await one(`select p.id, f.id facility, f.lga_id, f.state_id, f.supplied_by_facility_id supplier from profiles p join facilities f on f.id = p.facility_id
      where p.role = 'dri' and p.status = 'active' and f.is_otp_site and f.facility_type = 'health_facility' and p.name like '%(DUMMY)%'
        and exists (select 1 from otp_weekly_reports r where r.facility_id = f.id and r.current_version > 0)
      order by (p.email = 'abubakar.dauda@rutf-demo.example') desc, p.name limit 1`);
    const lgan = await one(`select p.id, f.id facility, f.lga_id from profiles p join facilities f on f.id = p.facility_id
      where p.role = 'dri' and p.status = 'active' and f.facility_type = 'lga_store' and f.lga_id = $1 order by p.name limit 1`, [officer.lga_id]);
    const otherLgan = await one(`select p.id, f.id facility, f.lga_id from profiles p join facilities f on f.id = p.facility_id
      where p.role = 'dri' and p.status = 'active' and f.facility_type = 'lga_store' and f.lga_id <> $1 order by p.name limit 1`, [officer.lga_id]);
    const sn = await one(`select p.id, f.id facility from profiles p join facilities f on f.id = p.facility_id
      where p.role = 'dri' and p.status = 'active' and f.facility_type = 'state_store' and f.state_id = $1 limit 1`, [officer.state_id]);
    const sc = await one(`select id from profiles where role = 'state_coordinator' and status = 'active' and managed_state_id = $1 order by name limit 1`, [officer.state_id]);
    const sup = await one(`select p.id from profiles p join supervisor_lgas s on s.profile_id = p.id where p.role = 'tpm_supervisor' and p.status = 'active' and s.lga_id = $1 limit 1`, [officer.lga_id]);
    const otherSup = await one(`select p.id from profiles p where p.role = 'tpm_supervisor' and p.status = 'active'
      and not exists (select 1 from supervisor_lgas s where s.profile_id = p.id and s.lga_id = $1) limit 1`, [officer.lga_id]);
    check("setup", "the OTP site is supplied by its LGA store", lgan.facility, officer.supplier);

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
    const balance = async (f) => Number((await one(`select ledger_balance($1, null, current_date) b`, [f])).b);

    // ── A. Jurisdictions ──
    const lgaCount = async (u) => as(u, async () => Number(await call(`select count(distinct lga_id) from facilities where facility_type = 'health_facility'`)));
    const ledgerOf = async (u, f) => as(u, async () => Number(await call(`select count(*) from stock_transactions where facility_id = $1`, [f])));
    check("A. jurisdiction", "OTP Officer: own site only", 1, await as(officer.id, async () => Number(await call(`select count(*) from facilities where facility_type = 'health_facility'`))));
    check("A. jurisdiction", "LGA Nutrition Officer: the OTP sites of one LGA", 1, await lgaCount(lgan.id));
    check("A. jurisdiction", "State Nutrition Officer: every LGA", true, (await lgaCount(sn.id)) > 30);
    check("A. jurisdiction", "State Coordinator: every LGA of the state", true, (await lgaCount(sc.id)) > 30);
    const supLgas = Number((await one(`select count(*) n from supervisor_lgas where profile_id = $1`, [sup.id])).n);
    check("A. jurisdiction", "Supervisor: only their LGAs", true, (await lgaCount(sup.id)) <= supLgas);
    check("A. jurisdiction", "LGA Nutrition Officer reads an OTP site's ledger in their LGA", true, (await ledgerOf(lgan.id, officer.facility)) > 0);
    check("A. jurisdiction", "another LGA's Nutritionist cannot", 0, await ledgerOf(otherLgan.id, officer.facility));
    check("A. jurisdiction", "OTP Officer cannot read the LGA store's ledger", 0, await ledgerOf(officer.id, lgan.facility));
    check("A. jurisdiction", "a Supervisor of another LGA cannot read the site's ledger", 0, await ledgerOf(otherSup.id, officer.facility));
    check("A. jurisdiction", "officer levels", "otp/lga/state", [
      await as(officer.id, () => call(`select rutf_officer_level()`)), await as(lgan.id, () => call(`select rutf_officer_level()`)),
      await as(sn.id, () => call(`select rutf_officer_level()`))].join("/"));
    check("A. jurisdiction", "aggregates: another LGA's Nutritionist sees no admissions at this site", 0,
      Number((await as(otherLgan.id, () => call(`select otp_aggregates(current_date - 365, current_date, null, $1)`, [officer.facility]))).cohort.admissions || 0));

    // ── B. OTP site -> LGA store ──
    const product = (await one(`select id from products order by name limit 1`)).id;
    let req;
    await as(officer.id, async () => {
      const form = await call(`select supply_request_form()`);
      check("B. OTP request", "the form names the LGA store as supplier", lgan.facility, form.supplier.id);
      check("B. OTP request", "level otp_to_lga", "otp_to_lga", form.level);
      check("B. OTP request", "a quantity is required", true, has(await call(`select supply_request_create($1::jsonb)`, [JSON.stringify({ lines: [{ product_id: product, requested_qty: 0 }] })]), "above zero"));
      req = await call(`select supply_request_create($1::jsonb)`, [JSON.stringify({ lines: [{ product_id: product, requested_qty: 600, stockout_days: 0 }],
        justification: "Caseload up after screening (DUMMY)", local_id: "TEST-SR-1" })]);
      check("B. OTP request", "submitted with an SR code", true, req.status === "submitted" && /^SR-[A-Z]+-\d{2}-\d{6}$/.test(req.code));
      const again = await call(`select supply_request_create($1::jsonb)`, [JSON.stringify({ lines: [{ product_id: product, requested_qty: 600 }], local_id: "TEST-SR-1" })]);
      check("B. OTP request", "a retried sync returns the same request", req.id, again.id);
      check("B. OTP request", "the requester cannot approve", true, has(await call(`select supply_request_act($1, 'approve')`, [req.id]), "Only the officer at the supplying store"));
    });
    check("B. OTP request", "the LGA Nutrition Officer is notified", true,
      Number((await one(`select count(*) n from notifications where user_id = $1 and type = 'supply_request' and link = $2`, [lgan.id, "/supply-requests/" + req.id])).n) === 1);
    await as(otherLgan.id, async () => {
      check("B. OTP request", "another LGA's Nutritionist cannot see it", true, has(await call(`select supply_request_get($1)`, [req.id]), "not found"));
      check("B. OTP request", "nor list it", 0, (await call(`select supply_request_list()`)).filter((x) => x.id === req.id).length);
    });
    await as(sn.id, async () => {
      const g = await call(`select supply_request_get($1)`, [req.id]);
      check("B. OTP request", "the State Nutrition Officer sees it (statewide) but cannot review it", false, g.can.review);
      check("B. OTP request", "and is refused", true, has(await call(`select supply_request_act($1, 'approve')`, [req.id]), "Only the officer at the supplying store"));
    });
    await as(sc.id, async () => {
      check("B. OTP request", "the State Coordinator cannot approve", true, has(await call(`select supply_request_act($1, 'approve')`, [req.id]), "Only the officer"));
      check("B. OTP request", "the State Coordinator comments (technical advice)", "submitted", (await call(`select supply_request_act($1, 'comment', 'Check the screening numbers (DUMMY)')`, [req.id])).status);
    });
    await as(sup.id, async () => {
      check("B. OTP request", "the LGA Supervisor comments", "submitted", (await call(`select supply_request_act($1, 'comment', 'Seen on the site visit (DUMMY)')`, [req.id])).status);
    });
    const lgaBefore = await balance(lgan.facility), otpBefore = await balance(officer.facility);
    await as(lgan.id, async () => {
      const list = await call(`select supply_request_list('incoming')`);
      check("B. OTP request", "in the LGA Nutrition Officer's incoming list", 1, list.filter((x) => x.id === req.id).length);
      check("B. OTP request", "opening for review", "under_review", (await call(`select supply_request_act($1, 'start_review')`, [req.id])).status);
      check("B. OTP request", "a query needs the question", true, has(await call(`select supply_request_act($1, 'query', '')`, [req.id]), "Say what needs"));
      check("B. OTP request", "queried", "queried", (await call(`select supply_request_act($1, 'query', 'How many children are on treatment? (DUMMY)')`, [req.id])).status);
    });
    await as(officer.id, async () => {
      check("B. OTP request", "the officer answers and changes the quantity", "submitted",
        (await call(`select supply_request_act($1, 'respond', '42 children (DUMMY)', $2::jsonb)`, [req.id, JSON.stringify([{ product_id: product, requested_qty: 450 }])])).status);
    });
    await as(lgan.id, async () => {
      check("B. OTP request", "approving less needs a reason", true,
        has(await call(`select supply_request_act($1, 'approve', null, $2::jsonb)`, [req.id, JSON.stringify([{ product_id: product, approved_qty: 300 }])]), "reason for approving a different quantity"));
      check("B. OTP request", "approved 300 of 450", "approved",
        (await call(`select supply_request_act($1, 'approve', 'Stock is limited this week (DUMMY)', $2::jsonb)`, [req.id, JSON.stringify([{ product_id: product, approved_qty: 300 }])])).status);
    });
    check("B. OTP request", "approval moves no stock (LGA store)", lgaBefore, await balance(lgan.facility));
    check("B. OTP request", "approval moves no stock (OTP site)", otpBefore, await balance(officer.facility));
    // Dispatch: the ordinary stock issue (as the LGA Nutrition Officer) — 150 first, then 150.
    const lot = (await one(`select id from product_lots order by expiry_date desc limit 1`)).id;
    const issue = async (n, q) => as(lgan.id, () => call(`select record_issue($1, $2, $3, current_date, $4::jsonb)`, [`TEST-SR-ISSUE-${n}`, lgan.facility, officer.facility, JSON.stringify([{ lot_id: lot, quantity: q }])]));
    const t1 = await issue(1, 150);
    let st = (await one(`select status from supply_requests where id = $1`, [req.id])).status;
    check("B. dispatch", "a part sent -> partially fulfilled", "partially_fulfilled", st);
    check("B. dispatch", "the transfer is linked to the request", req.id, (await one(`select supply_request_id from transfers where id = $1`, [t1.transfer_id])).supply_request_id);
    const t2 = await issue(2, 150);
    st = (await one(`select status from supply_requests where id = $1`, [req.id])).status;
    check("B. dispatch", "all sent -> dispatched", "dispatched", st);
    check("B. dispatch", "the issue moved the stock", lgaBefore - 300, await balance(lgan.facility));
    await as(officer.id, async () => {
      for (const [n, t] of [[1, t1], [2, t2]]) {
        await call(`select record_receipt($1, $2, current_date, $3::jsonb, $4)`, [`TEST-SR-REC-${n}`, officer.facility, JSON.stringify([{ lot_id: lot, quantity: 150 }]), t.transfer_id]);
      }
      const g = await call(`select supply_request_get($1)`, [req.id]);
      check("B. receipt", "both receipts recorded -> received", "received", g.request.status);
      check("B. receipt", "the history has every step", true,
        ["submitted", "comment", "review_started", "queried", "responded", "approved", "dispatched", "received"].every((a) => g.events.some((e) => e.action === a)));
      check("B. receipt", "the approval keeps requested and approved quantities", true,
        g.events.some((e) => e.action === "approved" && has(e.detail, "450") && has(e.detail, "300")));
      check("B. receipt", "a decided request cannot be cancelled", true, has(await call(`select supply_request_act($1, 'cancel')`, [req.id]), "cannot be cancelled"));
    });
    check("B. receipt", "the officer was told of the dispatch", true,
      Number((await one(`select count(*) n from notifications where user_id = $1 and type = 'supply_request' and text like '%dispatched%'`, [officer.id])).n) >= 2);

    // ── C. LGA store -> State store ──
    let req2;
    await as(lgan.id, async () => {
      const form = await call(`select supply_request_form()`);
      check("C. LGA request", "the LGA store asks the State store", "lga_to_state/" + sn.facility, form.level + "/" + form.supplier.id);
      req2 = await call(`select supply_request_create($1::jsonb)`, [JSON.stringify({ lines: [{ product_id: product, requested_qty: 3000, stockout_days: 2 }], justification: "Resupply for the month (DUMMY)" })]);
      check("C. LGA request", "the LGA Nutrition Officer cannot approve their own request", true, has(await call(`select supply_request_act($1, 'approve')`, [req2.id]), "State Nutrition Officer"));
    });
    await as(otherLgan.id, async () => {
      check("C. LGA request", "another LGA cannot see it", true, has(await call(`select supply_request_get($1)`, [req2.id]), "not found"));
    });
    await as(sn.id, async () => {
      const g = await call(`select supply_request_get($1)`, [req2.id]);
      check("C. LGA request", "the State Nutrition Officer reviews it", true, g.can.review);
      check("C. LGA request", "with the State store's balance shown", true, typeof g.supplier_balance === "number");
      check("C. LGA request", "rejecting needs a reason", true, has(await call(`select supply_request_act($1, 'reject', '')`, [req2.id]), "reason for rejecting"));
      check("C. LGA request", "approved in full", "approved", (await call(`select supply_request_act($1, 'approve')`, [req2.id])).status);
    });
    await as(officer.id, async () => {
      check("C. LGA request", "an OTP Officer cannot see an LGA's request to the State", true, has(await call(`select supply_request_get($1)`, [req2.id]), "not found"));
    });

    // ── D. OTP weekly report: query, answer, accept ──
    // A DUMMY report from this LGA waiting for review (made ready inside the transaction).
    let rep = await one(`select r.id, r.week_start::text ws from otp_weekly_reports r where r.facility_id = $1 and r.current_version > 0 order by r.week_start desc limit 1`, [officer.facility]);
    if (!rep) throw new Error("No submitted DUMMY weekly report in the officer's LGA — run seed-demo-weekly-reports.js");
    await pg.query(`update otp_weekly_reports set status = 'submitted' where id = $1`, [rep.id]);
    await pg.query(`update otp_weekly_report_versions v set decision = null, decided_by = null, decided_at = null
                    from otp_weekly_reports r where r.id = $1 and v.report_id = r.id and v.version = r.current_version`, [rep.id]);
    // Clear any unexplained blocking issue on this version so acceptance is possible.
    await pg.query(`update otp_weekly_report_versions v set issues = '[]'::jsonb from otp_weekly_reports r where r.id = $1 and v.report_id = r.id and v.version = r.current_version`, [rep.id]);
    const siteOfficer = await one(`select p.id from profiles p join otp_weekly_reports r on r.facility_id = p.facility_id where r.id = $1 and p.role = 'dri' and p.status = 'active' limit 1`, [rep.id]);
    await as(sup.id, async () => {
      check("D. OTP report", "a Supervisor sees the report of their LGA", rep.id, (await call(`select otp_report_get($1)`, [rep.id])).report_id);
      check("D. OTP report", "but cannot query it", true, has(await call(`select otp_report_act($1, 'query', 'x')`, [rep.id]), "Only the LGA Nutrition Officer or the State Coordinator"));
    });
    await as(otherLgan.id, async () => {
      check("D. OTP report", "another LGA's Nutritionist cannot open it", true, has(await call(`select otp_report_get($1)`, [rep.id]), "do not have access"));
    });
    await as(sc.id, async () => {
      check("D. OTP report", "the State Coordinator queries (technical oversight)", "queried", (await call(`select otp_report_act($1, 'query', 'Why so few MUAC screenings? (DUMMY)')`, [rep.id])).status);
    });
    await as(siteOfficer.id, async () => {
      const open = await call(`select otp_report_open($1::date)`, [rep.ws]);
      check("D. OTP report", "the officer sees the open query in the app", "Why so few MUAC screenings? (DUMMY)", open.open_query && open.open_query.note);
      check("D. OTP report", "a queried report is not editable", false, open.editable);
      check("D. OTP report", "the answer resubmits the report", "submitted", (await call(`select otp_report_act($1, 'answer', 'The scale was broken for two days (DUMMY)')`, [rep.id])).status);
    });
    check("D. OTP report", "the State Coordinator is told the query was answered", true,
      Number((await one(`select count(*) n from notifications where user_id = $1 and text like 'The query on the weekly OTP report%'`, [sc.id])).n) >= 1);
    await as(sc.id, async () => {
      check("D. OTP report", "the State Coordinator cannot accept", true, has(await call(`select otp_report_decide($1, 'approved', null)`, [rep.id]), "Only the LGA Nutrition Officer"));
    });
    await as(lgan.id, async () => {
      const g = await call(`select otp_report_get($1)`, [rep.id]);
      check("D. OTP report", "the LGA Nutrition Officer may decide", true, g.can_decide);
      check("D. OTP report", "the history shows the query and the answer", true, g.events.some((e) => e.action === "queried") && g.events.some((e) => e.action === "answered"));
      check("D. OTP report", "the LGA Nutrition Officer accepts", "approved", (await call(`select otp_report_decide($1, 'approved', 'Accepted (DUMMY)')`, [rep.id])).status);
    });

    // ── E. LGA weekly report ──
    // Every other OTP report of that LGA and week: accepted, or none, so the outcome is known.
    await pg.query(`update otp_weekly_reports set status = 'approved' where lga_id = $1 and week_start = $2 and id <> $3 and current_version > 0`, [officer.lga_id, rep.ws, rep.id]);
    await pg.query(`update otp_weekly_report_versions v set decision = 'approved' from otp_weekly_reports r
                    where r.lga_id = $1 and r.week_start = $2 and v.report_id = r.id and v.version = r.current_version`, [officer.lga_id, rep.ws]);
    await pg.query(`delete from otp_weekly_reports r where r.lga_id = $1 and r.week_start = $2 and r.current_version = 0`, [officer.lga_id, rep.ws]);
    let lr;
    await as(sn.id, async () => {
      check("E. LGA report", "only an LGA Nutrition Officer prepares it", true, has(await call(`select lga_report_open($1::date)`, [rep.ws]), "Only an LGA Nutrition Officer"));
    });
    await as(lgan.id, async () => {
      lr = await call(`select lga_report_open($1::date)`, [rep.ws]);
      check("E. LGA report", "opened as a draft the LGA Nutrition Officer can submit", "draft/true", `${lr.status}/${lr.can_submit}`);
      const sites = lr.live.sites, incl = sites.filter((x) => x.included);
      const sumNew = incl.reduce((a, x) => a + Number(x.new_cases || 0), 0);
      check("E. LGA report", "the combined new cases equal the sum of the included OTP reports", sumNew, Number(lr.live.sections.C?.SAM?.total || 0));
      check("E. LGA report", "every OTP site of the LGA is listed", true, sites.length >= incl.length && sites.length > 0);
      check("E. LGA report", "sachets per carton is not summed", true, !lr.live.sections.G || Number(lr.live.sections.G.sachets_per_carton) === 150);
      check("E. LGA report", "the LGA store's stock is in it", true, !!lr.live.store && typeof lr.live.store.closing === "number");
      check("E. LGA report", "this week's supply requests are counted", true, lr.live.supply_requests.from_otp_sites.count >= 0);
      const missing = sites.filter((x) => !x.included).length;
      if (missing > 0) check("E. LGA report", "sites without an accepted report must be explained", true,
        has(await call(`select lga_report_submit($1, null, true)`, [lr.id]), "explain in the comments"));
      check("E. LGA report", "submit needs the comparison confirmed", true, has(await call(`select lga_report_submit($1, 'x', false)`, [lr.id]), "Confirm"));
      check("E. LGA report", "submitted as version 1", 1, (await call(`select lga_report_submit($1, 'Two sites had no network (DUMMY)', true)`, [lr.id])).version);
    });
    check("E. LGA report", "the State Nutrition Officer is notified", true,
      Number((await one(`select count(*) n from notifications where user_id = $1 and link = $2`, [sn.id, "/lga-reports/" + lr.id])).n) >= 1);
    await as(sc.id, async () => {
      check("E. LGA report", "the State Coordinator cannot accept", true, has(await call(`select lga_report_act($1, 'accept')`, [lr.id]), "Only the State Nutrition Officer"));
    });
    await as(sn.id, async () => {
      check("E. LGA report", "the State Nutrition Officer queries it", "queried", (await call(`select lga_report_act($1, 'query', 'Confirm the closing balance (DUMMY)')`, [lr.id])).status);
    });
    await as(lgan.id, async () => {
      check("E. LGA report", "the LGA Nutrition Officer answers", "submitted", (await call(`select lga_report_act($1, 'answer', 'Recounted: correct (DUMMY)')`, [lr.id])).status);
    });
    await as(sn.id, async () => {
      check("E. LGA report", "the State Nutrition Officer accepts", "accepted", (await call(`select lga_report_act($1, 'accept')`, [lr.id])).status);
      const ov = await call(`select lga_reports_overview($1::date)`, [rep.ws]);
      check("E. statewide", "the overview counts it as accepted", true, ov.accepted >= 1);
      const row = ov.lgas.find((x) => x.lga_id === officer.lga_id);
      check("E. statewide", "the statewide new cases include this LGA", true, Number(ov.statewide.sections.C?.SAM?.total || 0) >= Number(row.new_cases || 0));
    });
    await as(lgan.id, async () => {
      const ov = await call(`select lga_reports_overview($1::date)`, [rep.ws]);
      check("E. statewide", "the LGA Nutrition Officer sees only their LGA, no statewide figures", "1/null", `${ov.lgas.length}/${ov.statewide}`);
      check("E. LGA report", "an accepted report can be reopened for amendment", "draft", (await call(`select lga_report_act($1, 'reopen')`, [lr.id])).status);
    });
    await as(officer.id, async () => {
      check("E. LGA report", "an OTP Officer cannot see the LGA reports", true, has(await call(`select lga_reports_overview($1::date)`, [rep.ws]), "does not see"));
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
