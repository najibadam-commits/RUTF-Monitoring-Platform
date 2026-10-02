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
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
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
      for (const table of ["issues", "notifications", "states", "categories", "field_monitor_attendance"]) {
        const { error: tErr } = await client.from(table).select("id").limit(1);
        check("A. auth", role, `can query ${table} (RLS-scoped, no error)`, "ok", tErr ? `error: ${tErr.message}` : "ok");
      }
    }

    // ── B. Permission matrix inside a rolled-back transaction ───────────────────────────────────
    const one = async (sql, params) => (await pg.query(sql, params)).rows[0];
    const [S1, S2] = (await pg.query(`select id from states order by name limit 2`)).rows.map((r) => r.id);
    const [C1, C2] = (await pg.query(`select id from categories where is_active order by sort_order limit 2`)).rows.map((r) => r.id);
    const lgaOf = async (stateId) => (await one(`select id from lgas where state_id = $1 limit 1`, [stateId])).id;
    const [L1, L2] = [await lgaOf(S1), await lgaOf(S2)];

    await pg.query("begin");
    if (migrationFile) await pg.query(require("fs").readFileSync(require("path").resolve(migrationFile), "utf8"));
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
      deleteFinding:     { super_admin: "allowed", project_admin: "denied", state_coordinator: "denied", tpm_supervisor: "denied", dri: "denied" },
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
        check("B. admin", role, "delete a Finding (admin-only)", EXPECT.deleteFinding[role],
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
