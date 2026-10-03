// Creates demo accounts (one per role) via the Supabase Admin API, plus ~70
// sample issues spread across every workflow stage, using real states/LGAs
// from the imported boundary data. Safe to run once against a fresh schema;
// re-running skips users that already exist but will add duplicate issues.
//
// Usage: node seed-demo.js
require("dotenv").config({ quiet: true });
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const DEMO_PASSWORD = "Demo!2026Pass";

const USERS = [
  { name: "Fatima Yusuf", email: "f.yusuf@tpmops.org", role: "super_admin", phone: "+234 803 111 2201" },
  { name: "Aisha Bello", email: "a.bello@tpmops.org", role: "project_admin", phone: "+234 804 111 3301", project: "Northern Corridor Program" },
  { name: "Emeka Okafor", email: "e.okafor@tpmops.org", role: "tpm_supervisor", phone: "+234 805 222 3302" },
  { name: "Blessing Adeyemi", email: "b.adeyemi@tpmops.org", role: "tpm_supervisor", phone: "+234 802 333 4403" },
  { name: "Suleiman Abdullahi", email: "s.abdullahi@tpmops.org", role: "tpm_supervisor", phone: "+234 807 444 5504", project: "Northern Corridor Program" },
  { name: "Amaka Obi", email: "a.obi@tpmops.org", role: "dri", phone: "+234 809 555 6605" },
  { name: "Grace Effiong", email: "g.effiong@tpmops.org", role: "dri", phone: "+234 806 666 7706" },
  { name: "Ibrahim Suleiman", email: "i.suleiman@tpmops.org", role: "dri", phone: "+234 808 777 8807" },
  { name: "Joy Okonkwo", email: "j.okonkwo@tpmops.org", role: "viewer", phone: "+234 810 777 8807" },
];

const DESCRIPTIONS = {
  "Water & Sanitation Failure": "Borehole pump reported non-functional; community relying on unsafe surface water source.",
  "Supply Chain / Stockout": "Facility stock of essential commodities depleted; last restock delayed beyond schedule.",
  "Infrastructure Damage": "Access road to facility washed out following heavy rains, restricting supply deliveries.",
  "Safety Incident": "Field team reported an unsafe storage condition posing risk to staff and visitors.",
  "Service Quality Complaint": "Community members reported long wait times and inconsistent service delivery.",
  "Data Discrepancy": "Reported figures do not reconcile with field-verified counts for the monitoring period.",
  "Staff Absenteeism": "Assigned facility staff absent during two consecutive scheduled monitoring visits.",
  "Equipment Malfunction": "Cold-chain refrigeration unit recorded temperature excursions outside safe range.",
  "Environmental Hazard": "Improper disposal of waste observed near facility perimeter, risk to surrounding area.",
  "Community Grievance": "Community leadership raised formal concern regarding facility accessibility.",
};

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

(async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  console.log("Creating demo accounts...");
  const projectIds = new Map();
  const profileIds = new Map(); // email -> id

  for (const u of USERS) {
    let projectId = null;
    if (u.project) {
      if (!projectIds.has(u.project)) {
        const { rows } = await pg.query("insert into projects (name) values ($1) on conflict (name) do update set name = excluded.name returning id", [u.project]);
        projectIds.set(u.project, rows[0].id);
      }
      projectId = projectIds.get(u.project);
    }

    const { data: existing } = await admin.auth.admin.listUsers();
    let userId = existing.users.find((x) => x.email === u.email)?.id;

    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email: u.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { name: u.name },
      });
      if (error) {
        console.error(`  ✗ ${u.email}: ${error.message}`);
        continue;
      }
      userId = data.user.id;
      console.log(`  + created ${u.email}`);
    } else {
      console.log(`  = ${u.email} already exists`);
    }

    await pg.query(
      `update profiles set name=$2, phone=$3, role=$4, project_id=$5, status='active' where id=$1`,
      [userId, u.name, u.phone, u.role, projectId],
    );
    profileIds.set(u.email, userId);
  }

  console.log("\nLoading real states/LGAs for sample issues...");
  const { rows: stateLgaRows } = await pg.query(`
    select s.id as state_id, s.name as state_name, l.id as lga_id, l.name as lga_name,
           ST_Y(ST_Centroid(l.geom)) as lat, ST_X(ST_Centroid(l.geom)) as lng
    from lgas l join states s on s.id = l.state_id
    where l.geom is not null
    order by random()
    limit 60;
  `);
  const { rows: categoryRows } = await pg.query("select id, name from categories order by sort_order");

  const dris = ["a.obi@tpmops.org", "g.effiong@tpmops.org", "i.suleiman@tpmops.org"].map((e) => profileIds.get(e)).filter(Boolean);
  const tpms = ["e.okafor@tpmops.org", "b.adeyemi@tpmops.org", "s.abdullahi@tpmops.org"].map((e) => profileIds.get(e)).filter(Boolean);
  const superAdminId = profileIds.get("f.yusuf@tpmops.org");

  if (dris.length === 0 || tpms.length === 0 || !superAdminId || stateLgaRows.length === 0) {
    console.error("Missing required demo accounts or boundary data — aborting issue seeding.");
    await pg.end();
    return;
  }

  console.log("Seeding sample issues across every workflow stage...");
  const rand = seededRandom(42);
  const now = new Date("2026-08-05T09:00:00Z");
  const priorities = ["critical", "high", "medium", "low"];
  const wards = ["Central Ward", "North Ward", "South Ward", "Riverside Ward", "Market Ward"];

  let created = 0;
  for (let i = 0; i < 70; i++) {
    const loc = pick(rand, stateLgaRows);
    const category = pick(rand, categoryRows);
    const priority = pick(rand, priorities);
    const tpmId = pick(rand, tpms);
    const daysAgo = Math.floor(rand() * 45);
    const reportedAt = new Date(now.getTime() - daysAgo * 86400000 - Math.floor(rand() * 20) * 3600000);

    const roll = rand();
    let statusIdx;
    if (roll < 0.16) statusIdx = 0;
    else if (roll < 0.34) statusIdx = 1;
    else if (roll < 0.58) statusIdx = 2;
    else if (roll < 0.8) statusIdx = 3;
    else statusIdx = 4;
    const statuses = ["new", "assigned", "in_progress", "resolved", "verified_closed"];
    const status = statuses[statusIdx];
    const driId = statusIdx >= 1 ? pick(rand, dris) : null;

    const jitter = () => (rand() - 0.5) * 0.05;
    const lat = Number(loc.lat) + jitter();
    const lng = Number(loc.lng) + jitter();

    const { rows: issueRows } = await pg.query(
      `insert into issues (category_id, description, state_id, lga_id, ward, lat, lng, reported_at, reported_by, priority, status, assigned_dri)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id, code`,
      [
        category.id,
        DESCRIPTIONS[category.name],
        loc.state_id,
        loc.lga_id,
        pick(rand, wards),
        lat,
        lng,
        reportedAt.toISOString(),
        tpmId,
        priority,
        status,
        driId,
      ],
    );
    const issue = issueRows[0];
    let cursor = new Date(reportedAt.getTime() + (4 + Math.floor(rand() * 20)) * 3600000);

    if (statusIdx >= 1) {
      await pg.query(`insert into issue_history (issue_id, actor_id, actor_label, action, note) values ($1,$2,'Findings Follow-up','Assigned to DRI',$3)`, [
        issue.id,
        tpmId,
        "Routed to the assigned DRI for action.",
      ]);
      cursor = new Date(cursor.getTime() + (12 + Math.floor(rand() * 48)) * 3600000);
    }
    let driResponse = null;
    if (statusIdx >= 2) {
      driResponse = "Acknowledged the finding; corrective steps initiated within 48 hours per SOP.";
      await pg.query(`insert into issue_history (issue_id, actor_id, actor_label, action, occurred_at, note) values ($1,$2,'DRI','Response submitted',$3,$4)`, [
        issue.id,
        driId,
        cursor.toISOString(),
        driResponse,
      ]);
      cursor = new Date(cursor.getTime() + (24 + Math.floor(rand() * 72)) * 3600000);
    }
    let correctiveAction = null;
    if (statusIdx >= 3) {
      correctiveAction = "Replacement part sourced and installed; facility staff briefed on interim mitigation.";
      await pg.query(`insert into issue_history (issue_id, actor_id, actor_label, action, occurred_at, note) values ($1,$2,'DRI','Corrective action recorded',$3,$4)`, [
        issue.id,
        driId,
        cursor.toISOString(),
        correctiveAction,
      ]);
      cursor = new Date(cursor.getTime() + (12 + Math.floor(rand() * 48)) * 3600000);
    }
    let resolutionDate = null;
    if (statusIdx >= 4) {
      resolutionDate = cursor;
      await pg.query(`insert into issue_history (issue_id, actor_id, actor_label, action, occurred_at, note) values ($1,$2,'TPM','Verified and closed',$3,'TPM confirmed resolution during follow-up visit.')`, [
        issue.id,
        tpmId,
        cursor.toISOString(),
      ]);
    }

    await pg.query(`update issues set dri_response=$2, corrective_action=$3, verified_by=$4, resolution_date=$5 where id=$1`, [
      issue.id,
      driResponse,
      correctiveAction,
      statusIdx >= 4 ? superAdminId : null,
      resolutionDate ? resolutionDate.toISOString() : null,
    ]);
    created++;
  }

  console.log(`\n✅ Seeded ${created} issues.`);
  console.log(`\nDemo login — all accounts share the password: ${DEMO_PASSWORD}`);
  USERS.forEach((u) => console.log(`  ${u.role.padEnd(15)} ${u.email}`));

  await pg.end();
})().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
