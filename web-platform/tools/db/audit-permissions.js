// Permissions review (brief M6): a catalogue audit of the live database's access rules. It checks
// what a hand review would, but every time:
//   1. every table in `public` has row-level security on;
//   2. no policy is granted to `anon` / `public` (the platform has no signed-out data);
//   3. every SECURITY DEFINER function pins its search_path, and none is callable signed out
//      unless it is on the ANON_OK list (sign-in helpers);
//   4. every view in `public` is security_invoker, so RLS still applies through it;
//   5. no storage bucket is public;
//   6. every active account other than Super Admin belongs to a project.
// Prints a table and exits 1 on any failure. Read-only.
//
// Usage: node audit-permissions.js [--verbose]
require("dotenv").config({ quiet: true });
const { Client } = require("pg");

// Signed-out callers legitimately need these (login, invite and password-reset flows).
const ANON_OK = new Set([]);
// Tables deliberately readable without a policy check (none today).
const NO_RLS_OK = new Set(["spatial_ref_sys"]); // PostGIS catalogue, owned by the extension

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const results = [];
  const add = (check, object, result, note = "") => results.push({ check, object, result, note });
  try {
    const noRls = (await pg.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`)).rows;
    for (const r of noRls) add("1. RLS on", r.relname, NO_RLS_OK.has(r.relname) ? "OK (exempt)" : "FAIL", "row-level security is off");
    const nTables = (await pg.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')`)).rows[0].n;
    add("1. RLS on", `${nTables} tables`, noRls.every((r) => NO_RLS_OK.has(r.relname)) ? "PASS" : "FAIL");

    const openPolicies = (await pg.query(`
      select schemaname || '.' || tablename || ' / ' || policyname as obj, roles::text from pg_policies
      where schemaname in ('public', 'storage') and (roles && array['anon', 'public']::name[]) order by 1`)).rows;
    for (const p of openPolicies) add("2. no signed-out policies", p.obj, "FAIL", `roles ${p.roles}`);
    if (!openPolicies.length) add("2. no signed-out policies", "public + storage policies", "PASS");

    const definer = (await pg.query(`
      select p.oid::regprocedure::text as fn, p.proconfig,
             has_function_privilege('anon', p.oid, 'execute') as anon_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
      where n.nspname = 'public' and p.prosecdef and d.objid is null order by 1`)).rows;
    const noPath = definer.filter((f) => !(f.proconfig ?? []).some((c) => c.startsWith("search_path=")));
    for (const f of noPath) add("3a. definer pins search_path", f.fn, "FAIL", "SECURITY DEFINER without search_path");
    add("3a. definer pins search_path", `${definer.length} SECURITY DEFINER functions`, noPath.length ? "FAIL" : "PASS");
    const anon = definer.filter((f) => f.anon_exec && !ANON_OK.has(f.fn.split("(")[0]));
    for (const f of anon) add("3b. definer not callable signed out", f.fn, "FAIL", "anon has EXECUTE");
    add("3b. definer not callable signed out", `${definer.length} SECURITY DEFINER functions`, anon.length ? "FAIL" : "PASS");

    const views = (await pg.query(`
      select c.relname, coalesce(c.reloptions::text, '') as opts from pg_class c join pg_namespace n on n.oid = c.relnamespace
      left join pg_depend d on d.objid = c.oid and d.deptype = 'e'
      where n.nspname = 'public' and c.relkind in ('v', 'm') and d.objid is null order by 1`)).rows;
    const definerViews = views.filter((v) => !/security_invoker=(true|on)/.test(v.opts) && !["geography_columns", "geometry_columns"].includes(v.relname));
    for (const v of definerViews) add("4. views keep RLS", v.relname, "FAIL", "not security_invoker — runs with the owner's rights");
    add("4. views keep RLS", `${views.length} views`, definerViews.length ? "FAIL" : "PASS");

    const buckets = (await pg.query(`select id, public from storage.buckets order by id`)).rows;
    for (const b of buckets) add("5. private buckets", b.id, b.public ? "FAIL" : "PASS", b.public ? "bucket is public" : "");

    // in_scope() treats a non-Super-Admin with no project as unscoped (TPM-era rule for a Project
    // Admin not yet assigned), so every active account except Super Admin needs the project.
    const unscoped = (await pg.query(`
      select email, role from profiles where status = 'active' and role <> 'super_admin' and project_id is null order by 1`)).rows;
    for (const p of unscoped) add("6. accounts have a project", p.email, "FAIL", `${p.role} with no project sees every project`);
    if (!unscoped.length) add("6. accounts have a project", "active non-Super-Admin accounts", "PASS");

    if (process.argv.includes("--verbose")) {
      const pol = (await pg.query(`select tablename, policyname, cmd, roles::text from pg_policies where schemaname = 'public' order by 1, 2`)).rows;
      console.table(pol);
    }
  } finally {
    await pg.end();
  }
  console.table(results);
  const failed = results.filter((r) => r.result === "FAIL");
  console.log(`\n${failed.length ? `${failed.length} problem(s) found.` : "No problems found."}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
