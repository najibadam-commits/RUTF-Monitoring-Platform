// Creates sign-in-ready demo accounts for every person in data/dummy/people.csv (DECISIONS R2):
// facility users tied to their facility, supervisors, Findings reviewers, the programme manager
// and a viewer — all in the Katsina RUTF Pilot project. No email is sent (admin.createUser,
// pre-confirmed, like add-user-no-email.js); the addresses are @rutf-demo.example, a reserved
// domain no real mailbox can receive.
//
// Every demo account shares one password, generated on the first run and kept in the untracked
// tools/db/.env.demo (DEMO_PASSWORD) — never printed, never committed. Re-running is safe:
// existing demo accounts are updated, not duplicated.
//
// Usage: node seed-demo-accounts.js            create / update all demo accounts
//        node seed-demo-accounts.js --delete   remove every @rutf-demo.example account
require("dotenv").config({ quiet: true });
require("dotenv").config({ path: require("path").join(__dirname, "../../web/.env.local"), quiet: true });
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const PEOPLE_CSV = path.join(__dirname, "..", "..", "..", "data", "dummy", "people.csv");
const PASSWORD_FILE = path.join(__dirname, ".env.demo");
const DEMO_DOMAIN = "@rutf-demo.example";
const PROJECT_NAME = "Katsina RUTF Pilot";
const CONCURRENCY = 5;

function demoPassword() {
  if (fs.existsSync(PASSWORD_FILE)) {
    const match = fs.readFileSync(PASSWORD_FILE, "utf8").match(/^DEMO_PASSWORD=(.+)$/m);
    if (match) return match[1].trim();
  }
  const pw = `Rutf-${crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "x")}-9`;
  fs.writeFileSync(
    PASSWORD_FILE,
    `# Shared password for the @rutf-demo.example demo accounts (seed-demo-accounts.js). Untracked.\nDEMO_PASSWORD=${pw}\n`,
  );
  return pw;
}

async function allDemoUsers(admin) {
  const found = new Map();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    for (const u of data.users) if (u.email?.toLowerCase().endsWith(DEMO_DOMAIN)) found.set(u.email.toLowerCase(), u.id);
    if (data.users.length < 1000) break;
  }
  return found;
}

async function inBatches(items, fn) {
  for (let i = 0; i < items.length; i += CONCURRENCY) await Promise.all(items.slice(i, i + CONCURRENCY).map(fn));
}

(async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const existing = await allDemoUsers(admin);

  if (process.argv.includes("--delete")) {
    let deleted = 0;
    await inBatches([...existing.values()], async (id) => {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.error(`  could not delete ${id}: ${error.message}`);
      else deleted++;
    });
    console.log(`Deleted ${deleted} of ${existing.size} demo accounts.`);
    return;
  }

  const people = parse(fs.readFileSync(PEOPLE_CSV), { columns: true, skip_empty_lines: true });
  const password = demoPassword();
  const failures = [];
  const ids = new Map(); // email -> auth id

  await inBatches(people, async (p) => {
    const email = p.email.trim().toLowerCase();
    if (!email.endsWith(DEMO_DOMAIN)) return failures.push(`${email}: not a ${DEMO_DOMAIN} address — skipped`);
    let id = existing.get(email);
    if (id) {
      const { error } = await admin.auth.admin.updateUserById(id, { password, email_confirm: true });
      if (error) return failures.push(`${email}: ${error.message}`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: p.full_name } });
      if (error || !data.user) return failures.push(`${email}: ${error?.message ?? "no user returned"}`);
      id = data.user.id;
    }
    ids.set(email, id);
  });

  // Profiles in one transaction, through the direct connection (trusted path: the profile
  // triggers still derive initials and the facility level).
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  try {
    await pg.query("begin");
    const project = await pg.query("select id from projects where name = $1", [PROJECT_NAME]);
    if (!project.rowCount) throw new Error(`Project "${PROJECT_NAME}" not found — apply migration 0100 first`);
    const projectId = project.rows[0].id;
    const katsina = (await pg.query("select id from states where code = 'KT'")).rows[0]?.id ?? null;

    for (const p of people) {
      const id = ids.get(p.email.trim().toLowerCase());
      if (!id) continue;
      await pg.query(
        `update profiles set name = $2, role = $3, project_id = $4, status = 'active',
                managed_state_id = $5, facility_id = $6,
                assigned_category_id = case when $6::uuid is null then null else assigned_category_id end
          where id = $1`,
        [id, p.full_name, p.role, projectId, p.role === "state_coordinator" ? katsina : null, p.role === "dri" ? p.facility_id || null : null],
      );
    }
    await pg.query("commit");

    const summary = await pg.query(
      `select p.role, c.abbr level, count(*)::int n, count(*) filter (where p.role = 'dri' and p.facility_id is null)::int no_facility
         from profiles p left join categories c on c.id = p.assigned_category_id
        where p.email like $1 group by 1, 2 order by 1, 2`,
      [`%${DEMO_DOMAIN}`],
    );
    console.table(summary.rows);
  } catch (e) {
    await pg.query("rollback").catch(() => {});
    console.error("Profile update failed, rolled back:", e.message);
    process.exitCode = 1;
  } finally {
    await pg.end();
  }

  console.log(`\n${ids.size} of ${people.length} demo accounts ready (${ids.size - [...ids.keys()].filter((e) => existing.has(e)).length} new).`);
  console.log(`Shared password: see ${path.relative(process.cwd(), PASSWORD_FILE)} (DEMO_PASSWORD).`);
  if (failures.length) {
    console.log(`\n${failures.length} problem(s):`);
    for (const f of failures) console.log(`  ${f}`);
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
