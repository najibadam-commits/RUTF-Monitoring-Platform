// End-to-end check of the mobile-app role model (DECISIONS.md #31) against the real backend.
//
// Two parts, both leaving NOTHING behind:
//   A. Real Supabase Auth: creates one throwaway account per role, signs in exactly as the mobile
//      app does (anon key + password), reads its own profile and the tables the app pulls, then
//      deletes the accounts again (in `finally`, even if a check fails).
//   B. Permission matrix: seeds fake projects/findings and runs every write/read a role could
//      attempt under that role's identity (SET LOCAL ROLE authenticated + JWT claims, so the real
//      RLS policies and RPC guards decide) inside ONE transaction that is always rolled back.
//
// Usage: node test-mobile-role-access.js [--with-migration <file.sql>]
//   (needs tools/db/.env and ../../web/.env.local)
//   --with-migration applies that migration INSIDE the rolled-back transaction before part B, to
//   prove a fix works without changing the live database; known-gap exemptions are switched off.
require("dotenv").config({ quiet: true });
require("dotenv").config({ path: require("path").join(__dirname, "../../web/.env.local"), quiet: true });
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");
const crypto = require("crypto");

const ROLES = ["super_admin", "project_admin", "state_coordinator", "tpm_supervisor", "dri"];
const SHORT = { super_admin: "SA", project_admin: "PA", state_coordinator: "SC", tpm_supervisor: "FM", dri: "DRI" };
const stamp = Date.now();
const migIdx = process.argv.indexOf("--with-migration");
const migrationFile = migIdx > -1 ? process.argv[migIdx + 1] : null;
const results = [];
let lastDenial = "";
// Known backend gaps that are being tolerated (check name -> why). Empty on purpose: the gaps this
// test originally found were fixed by migrations 0041/0042-era work (DECISIONS.md #32), so any
// mismatch is now a real FAIL. To tolerate a new one temporarily, add "ROLE|check name": "reason".
const KNOWN_GAPS = {};
function check(area, role, what, expected, actual) {
  const pass = expected === actual;
  const known = !pass && !migrationFile && KNOWN_GAPS[`${SHORT[role]}|${what}`];
  results.push({ area, role: SHORT[role] ?? role, check: what, expected, actual, result: pass ? "PASS" : known ? "KNOWN GAP" : "FAIL" });
  if (!pass && actual === "denied") console.log(`  [${SHORT[role]}] ${what} -> denied because: ${lastDenial}`);
}

(async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const pg = new Client({ connectionString: process.env.DATABASE_URL, keepAlive: true });
  await pg.connect();
  if (process.env.RBAC_DEBUG) {
    const q = pg.query.bind(pg);
    pg.query = (sql, ...rest) => { console.error(`[sql] ${String(sql).replace(/\s+/g, " ").slice(0, 110)}`); return q(sql, ...rest); };
  }
  const users = {}; // role -> { id, email, password }

  try {
    // A previous run that died before its cleanup would leave stale accounts (and skew counts).
    const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const stale of existing.users.filter((x) => /^tpm\.rbactest\..+@example\.com$/.test(x.email ?? ""))) {
      await admin.auth.admin.deleteUser(stale.id);
    }

    // ── Provision throwaway accounts ────────────────────────────────────────────────────────────
    for (const role of ROLES) {
      const email = `tpm.rbactest.${SHORT[role].toLowerCase()}.${stamp}@example.com`;
      const password = crypto.randomBytes(12).toString("base64").replace(/[+/=]/g, "x") + "!9";
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: `RBAC TEST ${SHORT[role]}` } });
      if (error) throw new Error(`createUser(${role}): ${error.message}`);
      users[role] = { id: data.user.id, email, password };
      await pg.query(`update profiles set name = $2, role = $3, project_id = null, status = 'active' where id = $1`, [data.user.id, `RBAC TEST ${SHORT[role]}`, role]);
    }

    // ── A. Real sign-in through the API, as the mobile app does it ─────────────────────────────
    for (const role of ROLES) {
      const client = createClient(process.env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: auth, error } = await client.auth.signInWithPassword({ email: users[role].email, password: users[role].password });
      check("A. auth", role, "signs in with email + password", "ok", error || !auth.session ? `error: ${error?.message}` : "ok");
      const { data: profile, error: pErr } = await client.from("profiles").select("id,name,email,role,project_id,status").eq("id", users[role].id).single();
      check("A. auth", role, "reads own profile (role = db role, active)", `${role}/active`, pErr ? `error: ${pErr.message}` : `${profile.role}/${profile.status}`);
      for (const table of ["issues", "notifications", "states", "categories", "field_monitor_attendance", "facilities", "product_lots", "protocol_rules"]) {
        const { error: tErr } = await client.from(table).select("id").limit(1);
        check("A. auth", role, `can query ${table} (RLS-scoped, no error)`, "ok", tErr ? `error: ${tErr.message}` : "ok");
      }
    }

    // ── B. Permission matrix inside a rolled-back transaction ───────────────────────────────────
    const one = async (sql, params) => (await pg.query(sql, params)).rows[0];
    await pg.query("begin");
    if (migrationFile) await pg.query(require("fs").readFileSync(require("path").resolve(migrationFile), "utf8"));
    // The RUTF database holds only Katsina's boundaries (DECISIONS R13); the state-scoping checks
    // need a second state, so one is created here — inside the transaction, rolled back with it.
    if (Number((await one(`select count(*)::int n from states`)).n) < 2) {
      const sx = (await one(`insert into states (code, name) values ('ZZ', 'RBAC TEST STATE') returning id`)).id;
      await pg.query(`insert into lgas (state_id, code, name) values ($1, 'ZZ01', 'RBAC TEST LGA')`, [sx]);
    }
    const [S1, S2] = (await pg.query(`select id from states order by name limit 2`)).rows.map((r) => r.id);
    const [C1, C2] = (await pg.query(`select id from categories where is_active order by sort_order limit 2`)).rows.map((r) => r.id);
    const lgaOf = async (stateId) => (await one(`select id from lgas where state_id = $1 limit 1`, [stateId])).id;
    const [L1, L2] = [await lgaOf(S1), await lgaOf(S2)];
    const P = (await one(`insert into projects (name) values ('RBAC TEST P') returning id`)).id;
    const Q = (await one(`insert into projects (name) values ('RBAC TEST Q') returning id`)).id;
    const u = (role) => users[role].id;
    await pg.query(`update profiles set project_id = $2 where id = any($1)`, [[u("project_admin"), u("state_coordinator"), u("tpm_supervisor"), u("dri")], P]);
    await pg.query(`update profiles set managed_state_id = $2 where id = $1`, [u("state_coordinator"), S1]);
    await pg.query(`update profiles set assigned_category_id = $2 where id = $1`, [u("dri"), C1]);

    const mk = async (project, state, lga, cat, status, driId) =>
      (await one(
        `insert into issues (project_id, state_id, lga_id, category_id, status, assigned_dri, reported_by, description)
         values ($1,$2,$3,$4,$5,$6,$7,'RBAC TEST') returning id`,
        [project, state, lga, cat, status, driId, u("tpm_supervisor")],
      )).id;
    const I1 = await mk(P, S1, L1, C1, "pending_review", null);          // awaiting review, coordinator's state
    const I2 = await mk(P, S2, L2, C1, "resolved", u("dri"));             // awaiting verification, DRI's sector
    const I3 = await mk(P, S1, L1, C2, "assigned", u("dri"));             // assigned to DRI but a different sector
    const I4 = await mk(Q, S1, L1, C1, "pending_review", null);           // a different project

    async function asRole(role, fn) {
      await pg.query("savepoint role_ctx");
      await pg.query("set local role authenticated");
      await pg.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', 'authenticated', true)`,
        [JSON.stringify({ sub: u(role), role: "authenticated" }), u(role)]);
      try { return await fn(); } finally { await pg.query("reset role"); await pg.query("rollback to savepoint role_ctx"); await pg.query("release savepoint role_ctx"); }
    }
    // Runs one statement that may be rejected; reports "allowed"/"denied" and always undoes it.
    async function attempt(sql, params = [], { rowsMustChange = false } = {}) {
      await pg.query("savepoint attempt");
      try {
        const r = await pg.query(sql, params);
        // RLS silently filters UPDATE/DELETE to zero rows instead of raising — that is a denial too.
        if (rowsMustChange && r.rowCount === 0) { lastDenial = "0 rows affected (RLS filtered)"; return "denied"; }
        return "allowed";
      } catch (e) { lastDenial = e.message; return "denied"; }
      finally { await pg.query("rollback to savepoint attempt"); await pg.query("release savepoint attempt"); }
    }

    // Expected server behaviour per role (mirrors web rbac.ts; see DECISIONS.md #31).
    const EXPECT = {
      visibleFindings:   { super_admin: 4, project_admin: 3, state_coordinator: 3, tpm_supervisor: 3, dri: 1 },
      registerFinding:   { super_admin: "allowed", project_admin: "allowed", state_coordinator: "denied", tpm_supervisor: "allowed", dri: "denied" },
      verifyAndClose:    { super_admin: "allowed", project_admin: "allowed", state_coordinator: "denied", tpm_supervisor: "allowed", dri: "denied" },
      rejectAndReopen:   { super_admin: "allowed", project_admin: "allowed", state_coordinator: "denied", tpm_supervisor: "allowed", dri: "denied" },
      driRespond:        { super_admin: "allowed", project_admin: "denied", state_coordinator: "denied", tpm_supervisor: "denied", dri: "allowed" },
      approveAssign:     { super_admin: "allowed", project_admin: "allowed", state_coordinator: "allowed", tpm_supervisor: "denied", dri: "denied" },
      attendanceInsert:  { super_admin: "denied", project_admin: "denied", state_coordinator: "denied", tpm_supervisor: "allowed", dri: "denied" },
      deleteFinding:     { super_admin: "denied",  project_admin: "denied", state_coordinator: "denied", tpm_supervisor: "denied", dri: "denied" },
    };

    for (const role of ROLES) {
      await asRole(role, async () => {
        const vis = Number((await one(`select count(*)::int n from issues where description = 'RBAC TEST'`)).n);
        check("B. read", role, "findings visible (RLS scope)", EXPECT.visibleFindings[role], vis);

        if (role === "state_coordinator" || role === "tpm_supervisor" || role === "dri") {
          // Count only the test's own DRI (not "all DRIs"): the live database can hold other DRIs —
          // sample-data demo accounts today, real ones later — and those must not skew this check.
          const others = (await one(
            `select count(*) filter (where role <> 'dri')::int nondri,
                    count(*) filter (where role = 'dri' and id = $2)::int test_dri,
                    count(*) filter (where role = 'dri' and id <> $1)::int any_dri
               from profiles where id <> $1`, [u(role), u("dri")]));
          check("B. read", role, "other users' profiles visible (non-DRI)", 0, Number(others.nondri));
          if (role === "state_coordinator") {
            check("B. read", role, "can see a DRI to assign (reviewer picker)", 1, Number(others.test_dri));
          } else {
            check("B. read", role, "sees no other DRI's profile", 0, Number(others.any_dri));
          }
        }
        check("B. write", role, "register a Finding (insert)", EXPECT.registerFinding[role],
          await attempt(`insert into issues (project_id, state_id, lga_id, category_id, description, reported_by) values ($1,$2,$3,$4,'RBAC TEST NEW',$5)`, [P, S1, L1, C1, u(role)]));

        check("B. write", role, "verify_and_close_issue on a resolved Finding", EXPECT.verifyAndClose[role],
          await attempt(`select verify_and_close_issue($1, 'ok')`, [I2]));
        check("B. write", role, "reject_and_reopen_issue on a resolved Finding", EXPECT.rejectAndReopen[role],
          await attempt(`select reject_and_reopen_issue($1, 'not fixed')`, [I2]));
        check("B. write", role, "submit_dri_response on own-sector assigned Finding", EXPECT.driRespond[role],
          await attempt(`select submit_dri_response($1, 'responding')`, [I2]));
        check("B. write", role, "approve_and_assign_finding (review action)", EXPECT.approveAssign[role],
          await attempt(`select approve_and_assign_finding($1, $2, 'ok')`, [I1, u("dri")]));
        check("B. write", role, "insert Field Monitor attendance", EXPECT.attendanceInsert[role],
          await attempt(`insert into field_monitor_attendance (field_monitor_id, attendance_date, captured_at, lat, lng, selfie_storage_path, assignment_location_storage_path, device_id) values ($1, current_date, now(), 10, 10, 'x', 'y', 'rbac-test')`, [u(role)]));
        check("B. admin", role, "delete a Finding (never: migration 0123)", EXPECT.deleteFinding[role],
          await attempt(`delete from issues where id = $1`, [I4], { rowsMustChange: true }));

        // Privilege escalation via the profile row must never work for anyone.
        if (role !== "super_admin") {
          await pg.query("savepoint esc");
          try {
            await pg.query(`update profiles set role = 'super_admin' where id = $1`, [u(role)]);
          } catch {
            await pg.query("rollback to savepoint esc"); // rejected outright — clear the aborted state before reading
          }
          const roleAfter = (await one(`select role from profiles where id = $1`, [u(role)])).role;
          await pg.query("rollback to savepoint esc"); await pg.query("release savepoint esc");
          check("B. admin", role, "cannot escalate own role to super_admin", role, roleAfter);
        }
      });
    }
    // Real Project Admins have no project_id (in_scope() treats that as "sees everything"). Repeat
    // the review action for that configuration — the seeded PA above had a project, which hides it.
    await pg.query(`update profiles set project_id = null where id = any($1)`, [[u("project_admin"), u("dri")]]);
    await asRole("project_admin", async () => {
      check("B. write", "project_admin", "approve_and_assign_finding (PA with no project_id)", "allowed",
        await attempt(`select approve_and_assign_finding($1, $2, 'ok')`, [I1, u("dri")]));
    });

    // ── C. RUTF reference data (migration 0100, brief M1) ───────────────────────────────────────
    // Test supply chain in project P: SST -> LST1 -> {OTP1, OTP2}, and SST -> LST2 -> OTP3.
    // The DRI records for OTP1, so it should see OTP1 and its supplier LST1 — nothing else.
    await pg.query(`update profiles set project_id = $2 where id = any($1)`, [[u("project_admin"), u("dri")], P]);
    const kt = await one(`select l.id lga, w.id ward, st_y(st_pointonsurface(w.geom))::numeric(9,6) lat,
                                 st_x(st_pointonsurface(w.geom))::numeric(9,6) lng
                            from lgas l join wards w on w.lga_id = l.id where w.geom is not null limit 1`);
    const fac = async (type, name, supplier) =>
      (await one(`insert into facilities (project_id, facility_type, name, lga_id, ward_id, supplied_by_facility_id, is_otp_site)
                  values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [P, type, `RBAC TEST ${name}`, kt.lga, kt.ward, supplier, type === "health_facility"])).id;
    const SST = await fac("state_store", "SST", null);
    const LST1 = await fac("lga_store", "LST1", SST);
    const LST2 = await fac("lga_store", "LST2", SST);
    const OTP1 = await fac("health_facility", "OTP1", LST1);
    const OTP2 = await fac("health_facility", "OTP2", LST1);
    await fac("health_facility", "OTP3", LST2);
    await pg.query(`update profiles set facility_id = $2 where id = $1`, [u("dri"), OTP1]);

    const otpLevel = (await one(`select id from categories where abbr = 'OTP'`)).id;
    check("C. reference", "dri", "facility assignment sets level to OTP", otpLevel,
      (await one(`select assigned_category_id from profiles where id = $1`, [u("dri")])).assigned_category_id);
    await pg.query("savepoint geo");
    const geo = await one(`insert into facilities (project_id, facility_type, name, lga_id, lat, lng)
                           values ($1, 'health_facility', 'RBAC TEST GEO', $2, $3, $4) returning ward_id`, [P, kt.lga, kt.lat, kt.lng]);
    await pg.query("rollback to savepoint geo"); await pg.query("release savepoint geo");
    check("C. reference", "super_admin", "ward resolved from coordinates when blank", kt.ward, geo.ward_id);
    check("C. reference", "super_admin", "supply chain enforced (health facility supplied by State store)", "denied",
      await attempt(`update facilities set supplied_by_facility_id = $2 where id = $1`, [OTP2, SST]));

    const EXPECT_C = {
      visibleFacilities: { super_admin: 6, project_admin: 6, state_coordinator: 6, tpm_supervisor: 6, dri: 2 },
      insertFacility:    { super_admin: "allowed", project_admin: "allowed", state_coordinator: "denied", tpm_supervisor: "denied", dri: "denied" },
      approveFacility:   { super_admin: "allowed", project_admin: "denied", state_coordinator: "denied", tpm_supervisor: "denied", dri: "denied" },
      insertLot:         { super_admin: "allowed", project_admin: "allowed", state_coordinator: "denied", tpm_supervisor: "denied", dri: "denied" },
      editProtocol:      { super_admin: "allowed", project_admin: "denied", state_coordinator: "denied", tpm_supervisor: "denied", dri: "denied" },
      editThreshold:     { super_admin: "allowed", project_admin: "denied", state_coordinator: "denied", tpm_supervisor: "denied", dri: "denied" },
    };
    const PENDING = (await one(`insert into facilities (project_id, facility_type, name, lga_id, status, pending_data)
                                values ($1, 'health_facility', 'RBAC TEST PENDING', $2, 'pending_update', '{"name":"RBAC TEST PENDING 2"}') returning id`, [P, kt.lga])).id;
    const KP_FACILITY = (await one(`select f.id from facilities f join projects p on p.id = f.project_id where p.name = 'Katsina RUTF Pilot' limit 1`)).id;
    await pg.query(`insert into rutf_thresholds (project_id, key, value) values ($1, 'rbac_test', 1)`, [P]);

    for (const role of ROLES) {
      await asRole(role, async () => {
        check("C. reference", role, "test facilities visible (RLS scope)", EXPECT_C.visibleFacilities[role],
          Number((await one(`select count(*)::int n from facilities where name like 'RBAC TEST%' and status = 'approved'`)).n));
        check("C. reference", role, "add a facility", EXPECT_C.insertFacility[role],
          await attempt(`insert into facilities (facility_type, name, lga_id) values ('health_facility', 'RBAC TEST NEW', $1)`, [kt.lga]));
        check("C. reference", role, "approve_facility on a pending change", EXPECT_C.approveFacility[role],
          await attempt(`select approve_facility($1, 'ok')`, [PENDING]));
        check("C. reference", role, "add a product lot", EXPECT_C.insertLot[role],
          await attempt(`insert into product_lots (product_id, lot_no, expiry_date) select id, 'RBAC-TEST', current_date + 365 from products limit 1`));
        check("C. reference", role, "edit a protocol rule", EXPECT_C.editProtocol[role],
          await attempt(`update protocol_rules set sachets_per_week = sachets_per_week where weight_min_kg = 5.0`, [], { rowsMustChange: true }));
        check("C. reference", role, "edit a threshold", EXPECT_C.editThreshold[role],
          await attempt(`update rutf_thresholds set value = 2 where project_id = $1 and key = 'rbac_test'`, [P], { rowsMustChange: true }));

        if (role === "project_admin") {
          // An edit to a live facility becomes a proposal; the live row is unchanged until approved.
          await pg.query("savepoint pa_edit");
          await pg.query(`update facilities set name = 'RBAC TEST RENAMED' where id = $1`, [OTP2]);
          const r = await one(`select name, status from facilities where id = $1`, [OTP2]);
          await pg.query("rollback to savepoint pa_edit"); await pg.query("release savepoint pa_edit");
          check("C. reference", role, "edit to a live facility becomes pending_update", "RBAC TEST OTP2/pending_update", `${r.name}/${r.status}`);
          check("C. reference", role, "assign a user to a facility outside own project", "denied",
            await attempt(`update profiles set facility_id = $2 where id = $1`, [u("dri"), KP_FACILITY], { rowsMustChange: true }));
        }
        if (role === "dri") {
          await pg.query("savepoint fac_esc");
          await pg.query(`update profiles set facility_id = $2 where id = $1`, [u("dri"), OTP2]);
          const after = (await one(`select facility_id from profiles where id = $1`, [u("dri")])).facility_id;
          await pg.query("rollback to savepoint fac_esc"); await pg.query("release savepoint fac_esc");
          check("C. reference", role, "cannot move self to another facility", OTP1, after);
        }
      });
    }

    // ── D. Pilot hardening (migration 0108, brief M6) ───────────────────────────────────────────
    // LST1 holds stock and has a transfer in transit to OTP1 (the DRI's facility).
    const today = new Date().toISOString().slice(0, 10);
    const LOT = (await one(`select id from product_lots limit 1`)).id;
    const TR = (await one(`insert into transfers (project_id, from_facility_id, to_facility_id, issued_date, sachets_issued)
                           values ($1, $2, $3, $4, 150) returning id`, [P, LST1, OTP1, today])).id;
    await pg.query(`insert into stock_transactions (project_id, facility_id, txn_type, txn_date, lot_id, quantity_sachets, recorded_by, document_no)
                    values ($1, $2, 'receipt', $3, $4, 1000, $5, 'RBAC TEST')`, [P, LST1, today, LOT, u("super_admin")]);
    await pg.query(`insert into stock_transactions (project_id, facility_id, txn_type, txn_date, lot_id, quantity_sachets, recorded_by,
                                                    counterparty_facility_id, transfer_id, local_id)
                    values ($1, $2, 'issue', $3, $4, 150, $5, $6, $7, 'rbac-test-issue:1')`, [P, LST1, today, LOT, u("super_admin"), OTP1, TR]);
    await pg.query(`update facilities set name = name || ' (audited)' where id = $1`, [OTP2]); // owner, so actor null

    const EXPECT_D = {
      supplierLedgerRows: { super_admin: 2, project_admin: 2, state_coordinator: 2, tpm_supervisor: 2, dri: 0 },
      supplierBalance:    { super_admin: 850, project_admin: 850, state_coordinator: 850, tpm_supervisor: 850, dri: 0 },
      incomingLines:      { super_admin: 1, project_admin: 1, state_coordinator: 1, tpm_supervisor: 1, dri: 1 },
      writeDhis2:         { super_admin: "allowed", project_admin: "allowed", state_coordinator: "denied", tpm_supervisor: "denied", dri: "denied" },
      auditVisible:       { super_admin: true, project_admin: true, state_coordinator: false, tpm_supervisor: false, dri: false },
      syncHealthVisible:  { super_admin: true, project_admin: true, state_coordinator: true, tpm_supervisor: false, dri: false },
    };
    for (const role of ROLES) {
      await asRole(role, async () => {
        check("D. hardening", role, "supplier's ledger rows readable", EXPECT_D.supplierLedgerRows[role],
          Number((await one(`select count(*)::int n from stock_transactions where facility_id = $1`, [LST1])).n));
        check("D. hardening", role, "ledger_balance of the supplier", EXPECT_D.supplierBalance[role],
          Number((await one(`select ledger_balance($1, null, $2) b`, [LST1, today])).b));
        check("D. hardening", role, "incoming_transfer_lines(own/scoped facility)", EXPECT_D.incomingLines[role],
          Number((await one(`select count(*)::int n from incoming_transfer_lines($1)`, [OTP1])).n));
        if (role === "dri") check("D. hardening", role, "incoming_transfer_lines(another facility)", 0,
          Number((await one(`select count(*)::int n from incoming_transfer_lines($1)`, [OTP2])).n));
        check("D. hardening", role, "write a ledger row directly (not via record_*)", "denied",
          await attempt(`insert into stock_transactions (facility_id, txn_type, txn_date, quantity_sachets, recorded_by)
                         values ($1, 'receipt', $2, 5, $3)`, [OTP1, today, u(role)]));
        check("D. hardening", role, "void a ledger row directly", "denied",
          await attempt(`update stock_transactions set status = 'voided' where facility_id = $1`, [LST1], { rowsMustChange: true }));
        check("D. hardening", role, "write a visit directly (not via record_visit)", "denied",
          await attempt(`insert into monitoring_visits (visit_type, facility_id, supervisor_id, visit_date, lat, lng, device_id)
                         values ('store_check', $1, $2, $3, 12, 7, 'x')`, [LST1, u(role), today]));
        check("D. hardening", role, "upload a DHIS2 report row", EXPECT_D.writeDhis2[role],
          await attempt(`insert into dhis2_reports (project_id, facility_id, period, sachets_distributed) values ($1, $2, date_trunc('month', now())::date, 1)`, [P, OTP1]));
        check("D. hardening", role, "send a notification/email via create_notification", "denied",
          await attempt(`select create_notification($1, 'x', 'x', null, null)`, [u("super_admin")]));
        check("D. hardening", role, "sees the audit trail", EXPECT_D.auditVisible[role],
          Number((await one(`select count(*)::int n from audit_log where table_name = 'facilities' and row_id = $1::text`, [OTP2])).n) > 0);
        check("D. hardening", role, "report_sync_status from own device", "allowed",
          await attempt(`select report_sync_status('rbac-dev-' || $1, '1.0', 'Test', '14', 2, 1, now() - interval '2 days',
                         '[{"local_id":"rbac-l1","type":"Dispensing","error":"timeout","attempts":3}]'::jsonb)`, [role]));
        const seen = await attempt(`select 1 from sync_health() limit 1`);
        const rows = seen === "allowed" ? Number((await one(`select count(*)::int n from sync_health()`)).n) : 0;
        check("D. hardening", role, "sees sync health", EXPECT_D.syncHealthVisible[role], rows > 0);
      });
    }
    // A failing device shows as failing, and only its own user and the reviewers see the report.
    await asRole("dri", async () => {
      await pg.query(`select report_sync_status('rbac-dev', '1.0', 'Test', '14', 2, 1, now() - interval '2 days',
                      '[{"local_id":"rbac-l1","type":"Dispensing","error":"timeout","attempts":3}]'::jsonb)`);
      check("D. hardening", "dri", "own sync report visible", 1, Number((await one(`select count(*)::int n from device_sync_status where device_id = 'rbac-dev'`)).n));
    });
    await pg.query("set local role authenticated");
    await pg.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: u("dri"), role: "authenticated" }), u("dri")]);
    await pg.query(`select report_sync_status('rbac-dev', '1.0', 'Test', '14', 2, 1, now() - interval '2 days',
                    '[{"local_id":"rbac-l1","type":"Dispensing","error":"timeout","attempts":3}]'::jsonb)`);
    await pg.query("reset role");
    await pg.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`);
    check("D. hardening", "dri", "failing device reported as failing", "failing",
      (await one(`select status from sync_health_internal($1) where profile_id = $2`, [P, u("dri")])).status);
    for (const role of ["tpm_supervisor", "state_coordinator"]) {
      await asRole(role, async () => {
        check("D. hardening", role, "another user's sync report visible", role === "state_coordinator" ? 1 : 0,
          Number((await one(`select count(*)::int n from device_sync_status where device_id = 'rbac-dev'`)).n));
      });
    }
    // Clearing the queue resolves the failure.
    await pg.query("set local role authenticated");
    await pg.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: u("dri"), role: "authenticated" }), u("dri")]);
    await pg.query(`select report_sync_status('rbac-dev', '1.0', 'Test', '14', 0, 0, null, '[]'::jsonb)`);
    await pg.query("reset role");
    await pg.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`);
    check("D. hardening", "dri", "failure resolved once synced", "0/ok",
      `${(await one(`select count(*) filter (where resolved_at is null)::int n from sync_failures where profile_id = $1 and device_id = 'rbac-dev'`, [u("dri")])).n}/` +
      (await one(`select status from sync_health_internal($1) where profile_id = $2`, [P, u("dri")])).status);

    // Signed out (anon key, no session): no data, no functions.
    await pg.query("savepoint anon_ctx");
    await pg.query("set local role anon");
    check("D. hardening", "anon", "signed out: facilities readable", 0, Number((await one(`select count(*)::int n from facilities`)).n));
    check("D. hardening", "anon", "signed out: call rutf_kpis", "denied", await attempt(`select rutf_kpis('2026-09-01', '2026-09-30')`));
    check("D. hardening", "anon", "signed out: call ledger_balance", "denied", await attempt(`select ledger_balance($1, null, current_date)`, [LST1]));
    check("D. hardening", "anon", "signed out: call create_notification", "denied", await attempt(`select create_notification($1, 'x', 'x', null, null)`, [u("super_admin")]));
    await pg.query("reset role");
    await pg.query("rollback to savepoint anon_ctx"); await pg.query("release savepoint anon_ctx");
  } finally {
    try { await pg.query("rollback"); } catch { /* no open transaction */ }
    for (const role of Object.keys(users)) {
      const { error } = await admin.auth.admin.deleteUser(users[role].id);
      if (error) console.error(`!! could not delete throwaway user ${users[role].email}: ${error.message}`);
    }
    await pg.end();
  }

  console.table(results);
  const failed = results.filter((r) => r.result === "FAIL");
  const gaps = results.filter((r) => r.result === "KNOWN GAP");
  const passed = results.filter((r) => r.result === "PASS").length;
  console.log(`\n${passed}/${results.length} passed, ${gaps.length} known pre-existing gap(s), ${failed.length} failed.`);
  for (const g of gaps) console.log(`  KNOWN GAP [${g.role}] ${g.check}\n    ${KNOWN_GAPS[`${g.role}|${g.check}`]}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
