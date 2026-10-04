// DUMMY data access requests for the demo (DECISIONS R100): six requests from the DUMMY Viewer
// (Zainab Mohammed), decided by the DUMMY Project Admin (Haruna Usman), covering every state of the
// approval flow — two waiting, one approved and not yet downloaded, two downloaded, one rejected —
// so Data Access Requests shows how the control works. Every one is marked "(DUMMY)" at the end of
// its reason; re-running replaces them, and --remove deletes them (nothing else is touched).
//
//   node seed-demo-download-requests.js            # add (or refresh) the six DUMMY requests
//   node seed-demo-download-requests.js --remove   # delete them
require("dotenv").config({ quiet: true });
const { Client } = require("pg");

const MARKER = "(DUMMY)";
const VIEWER_EMAIL = "zainab.mohammed@rutf-demo.example";
const REVIEWER_EMAIL = "haruna.usman@rutf-demo.example";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();

/** The latest complete month and the one before it, as YYYY-MM. */
function months() {
  const d = new Date();
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 1)).toISOString().slice(0, 7);
  return { last, prev };
}

(async () => {
  const remove = process.argv.includes("--remove");
  const pg = new Client({ connectionString: process.env.DATABASE_URL, keepAlive: true });
  await pg.connect();
  try {
    await pg.query("begin");
    const removed = await pg.query("delete from download_requests where reason like $1", [`%${MARKER}`]);
    if (remove) {
      await pg.query("commit");
      console.log(`Removed ${removed.rowCount} DUMMY data access requests.`);
      return;
    }

    const people = await pg.query("select id, email, project_id from profiles where email = any($1)", [[VIEWER_EMAIL, REVIEWER_EMAIL]]);
    const viewer = people.rows.find((p) => p.email === VIEWER_EMAIL);
    const reviewer = people.rows.find((p) => p.email === REVIEWER_EMAIL);
    if (!viewer || !reviewer) throw new Error("The DUMMY Viewer or Project Admin account is missing.");

    const { last, prev } = months();
    const requests = [
      {
        resource: "rutf_kpis", format: "csv", filters: { month: last }, status: "pending", created: at(2 * HOUR),
        reason: "Quarterly update to the UNICEF Nigeria nutrition section",
      },
      {
        resource: "issues_export", format: "csv", filters: { view: "overdue" }, status: "pending", created: at(26 * HOUR),
        reason: "Follow-up meeting with LGA nutrition focal persons on overdue Findings",
      },
      {
        resource: "rutf_facility_metrics", format: "csv", filters: { month: last }, status: "approved", created: at(2 * DAY),
        reviewed: at(2 * DAY - 3 * HOUR), token: true,
        reason: "Supply planning for the next RUTF distribution round",
      },
      {
        resource: "rutf_transfers", format: "csv", filters: { month: prev }, status: "fulfilled", created: at(20 * DAY),
        reviewed: at(20 * DAY - 5 * HOUR), fulfilled: at(20 * DAY - 6 * HOUR),
        reason: "Logistics partner review of State-to-LGA deliveries",
      },
      {
        resource: "issues_export", format: "csv", filters: { source: "auto", status: "verified_closed" }, status: "fulfilled", created: at(35 * DAY),
        reviewed: at(34 * DAY), fulfilled: at(34 * DAY - 2 * HOUR),
        reason: "Evidence for the programme's mid-term review",
      },
      {
        resource: "rutf_ledger", format: "csv", filters: { month: prev }, status: "rejected", created: at(12 * DAY),
        reviewed: at(11 * DAY), note: "Please narrow it to the LGAs you work in and say how the data will be used.",
        reason: "Need all the data",
      },
    ];

    for (const r of requests) {
      await pg.query(
        `insert into download_requests
           (requester_id, project_id, resource_type, format, filters, reason, status, reviewed_by, reviewed_at, review_note, download_token, fulfilled_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, case when $11 then gen_random_uuid() end, $12, $13)`,
        [
          viewer.id, viewer.project_id, r.resource, r.format, JSON.stringify(r.filters), `${r.reason} ${MARKER}`, r.status,
          r.reviewed ? reviewer.id : null, r.reviewed ?? null, r.note ?? null, !!r.token, r.fulfilled ?? null, r.created,
        ],
      );
    }
    await pg.query("commit");
    console.log(`Added ${requests.length} DUMMY data access requests (replaced ${removed.rowCount}).`);
  } catch (e) {
    await pg.query("rollback").catch(() => {});
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await pg.end();
  }
})();
