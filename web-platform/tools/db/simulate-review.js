// DEMO ONLY: walks the DUMMY Findings through a realistic review history so the Accountability
// Scorecard, Findings Follow-up and Finding activity histories show a working process (DECISIONS
// R57). Touches only Findings at facilities tagged DUMMY (facilities.dummy_fields is not null).
//
//  - Each Finding is dated to the period it concerns: a ledger check the night after the period
//    ends (period_end + 1–3 days), a visit Finding on the visit day. The "Finding reported" history
//    entry moves with it.
//  - Most are then approved by a State Coordinator, assigned to the facility's own user (DRI),
//    responded to, given a corrective action and verified by a supervisor covering that facility —
//    with realistic, priority-dependent delays, the same history entries and status changes the
//    review RPCs make, and nothing dated after now. A share stays at each stage, so some are open
//    and a few are past the target.
//  - Deterministic (seeded from each Finding's id) and rerunnable: every run first clears the
//    simulated workflow from these Findings (history other than "Finding reported", status back to
//    pending_review), then rebuilds it. Any real review done on DUMMY Findings is replaced.
//
// Usage: node simulate-review.js [--dry-run]     (one transaction; --dry-run rolls back)
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const crypto = require("crypto");

const DRY = process.argv.includes("--dry-run");
const DAY = 86_400_000;
const HOUR = 3_600_000;

// Seeded per Finding so reruns give the same history.
function rng(seed) {
  let a = crypto.createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r, lo, hi) => lo + (hi - lo) * r();

// Delays in days by stage and priority: [min, max].
const DELAY = {
  approve:    { critical: [0.1, 1], high: [0.5, 3], medium: [1, 6], low: [2, 8] },
  respond:    { critical: [0.3, 2], high: [1, 5], medium: [1, 8], low: [2, 10] },
  corrective: { critical: [1, 4], high: [2, 9], medium: [3, 12], low: [3, 15] },
  verify:     { critical: [2, 7], high: [3, 14], medium: [5, 20], low: [7, 25] },
};
// Chance a Finding stops before each stage (it is still waiting there).
const STALL = { approve: 0.05, respond: 0.06, corrective: 0.06, verify: 0.1 };

const NOTES = {
  stock_variance: ["Recounted with the storekeeper; the stock card had two issues not entered.", "Stock card brought up to date; difference explained and recorded as an adjustment."],
  transfer_mismatch: ["Checked the waybill with the sending store — cartons short on the truck.", "Shortfall confirmed with the sender; replacement sachets requested and logged."],
  receipt_not_confirmed: ["Delivery had arrived; receipt not entered in the app.", "Receipt recorded against the transfer with the waybill photo."],
  stockout: ["Requested an emergency issue from the LGA store.", "Emergency issue received; reorder level agreed with the LGA store."],
  expired_stock: ["Expired cartons separated from usable stock.", "Expired stock recorded as a loss and set aside for disposal."],
  short_dispensing: ["Reviewed the register with the OTP nurse — partial rations given during a stock shortage.", "Full rations resumed; dispensing checked against the protocol weekly."],
  late_reporting: ["The OTP focal person was on leave; a backup user was not set up.", "Missing days entered from the register; a backup user trained."],
  unexplained_adjustment: ["Adjustment was a correction of a mistyped count.", "Reason added and confirmed with the supervisor."],
  dispensing_gap: ["Some register days had not been entered in the app.", "Missing days entered; register and app reconciled for the period."],
  register_missing: ["The register was with the clinic in-charge on the day of the visit.", "Register kept at the OTP point; shown at the follow-up visit."],
  no_stock_card: ["No stock card had been opened for the new lot.", "Stock card opened and balanced against the count."],
  poor_storage: ["Cartons moved off the floor onto pallets.", "Store cleaned and pallets in place; checked at follow-up."],
  supervisor_variance: ["Recounted with the supervisor; two cartons had been issued without a voucher.", "Issue voucher completed and entered; balance agrees."],
};
const note = (type, i) => (NOTES[type] ?? ["Reviewed with the facility team.", "Corrective action taken and recorded."])[i];

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL, keepAlive: true });
  await pg.connect();
  const q = async (sql, params) => (await pg.query(sql, params)).rows;
  const now = Date.now() - HOUR; // nothing dated in the last hour

  try {
    await pg.query("begin");
    const findings = await q(`
      select i.id, i.priority::text priority, i.finding_type, i.period_end, i.facility_id, i.lga_id,
             f.facility_type::text facility_type, v.visit_date
      from issues i
      join facilities f on f.id = i.facility_id and f.dummy_fields is not null
      left join monitoring_visits v on v.id = i.visit_id
      order by i.id`);
    if (!findings.length) throw new Error("No DUMMY Findings found");
    const ids = findings.map((f) => f.id);

    // People: a State Coordinator reviews; the facility's own user responds; a supervisor of that
    // level covering the LGA verifies.
    const reviewer = (await q(`select id, name from profiles where role = 'state_coordinator' and status = 'active' order by email limit 1`))[0];
    if (!reviewer) throw new Error("No active State Coordinator to act as reviewer — run seed-demo-accounts.js");
    const dris = new Map((await q(`select distinct on (facility_id) facility_id, id, name from profiles
                                   where role = 'dri' and status = 'active' and facility_id is not null order by facility_id, email`))
      .map((d) => [d.facility_id, d]));
    const sups = await q(`select p.id, p.name, p.supervision_level, s.lga_id from profiles p
                          left join supervisor_lgas s on s.profile_id = p.id
                          where p.role = 'tpm_supervisor' and p.status = 'active'`);
    const anySup = sups[0];
    const supervisorFor = (f) => {
      const level = f.facility_type === "health_facility" ? "otp_sites" : "stores";
      return sups.find((s) => s.supervision_level === level && (f.facility_type === "state_store" || s.lga_id === f.lga_id))
        ?? sups.find((s) => s.supervision_level === level) ?? anySup;
    };

    // 1. Clear any earlier simulated (or demo) workflow on these Findings.
    await pg.query(`delete from issue_history where issue_id = any($1) and action <> 'Finding reported'`, [ids]);
    await pg.query(`update issues set status = 'pending_review', assigned_dri = null, dri_response = null, corrective_action = null,
                      verified_by = null, resolution_date = null where id = any($1)`, [ids]);

    const counts = {};
    const history = [];
    for (const f of findings) {
      const r = rng(f.id);
      const pr = DELAY.approve[f.priority] ? f.priority : "medium";
      // 2. Date the Finding to the period it concerns.
      let t = f.visit_date
        ? Date.parse(`${f.visit_date.toISOString().slice(0, 10)}T00:00:00Z`) + between(r, 9, 16) * HOUR
        : Date.parse(`${f.period_end.toISOString().slice(0, 10)}T00:00:00Z`) + between(r, 1, 3.2) * DAY;
      t = Math.min(t, now - between(r, 2, 20) * HOUR);
      const raised = new Date(t);
      await pg.query(`update issues set reported_at = $2 where id = $1`, [f.id, raised]);
      await pg.query(`update issue_history set occurred_at = $2 where issue_id = $1 and action = 'Finding reported'`, [f.id, raised]);

      // 3. Walk it forward until it stalls or reaches now.
      const dri = dris.get(f.facility_id);
      const sup = supervisorFor(f);
      const step = (stage) => {
        if (r() < STALL[stage]) return null;
        const [lo, hi] = DELAY[stage][pr];
        const next = t + between(r, lo, hi) * DAY;
        if (next > now) return null;
        t = next;
        return new Date(t);
      };
      let status = "pending_review";
      const set = { assigned_dri: null, dri_response: null, corrective_action: null, verified_by: null, resolution_date: null };
      const approved = dri ? step("approve") : null;
      if (approved) {
        status = "assigned";
        set.assigned_dri = dri.id;
        history.push([f.id, approved, reviewer.id, reviewer.name, "state_coordinator", "Approved by State Coordinator", "Reviewed and approved."]);
        history.push([f.id, new Date(approved.getTime() + 60_000), reviewer.id, reviewer.name, "state_coordinator", "Assigned to DRI", `Routed to ${dri.name} for action.`]);
        const responded = step("respond");
        if (responded) {
          status = "in_progress";
          set.dri_response = note(f.finding_type, 0);
          history.push([f.id, responded, dri.id, dri.name, "dri", "Response submitted", set.dri_response]);
          const fixed = step("corrective");
          if (fixed) {
            status = "resolved";
            set.corrective_action = note(f.finding_type, 1);
            set.resolution_date = fixed;
            history.push([f.id, fixed, dri.id, dri.name, "dri", "Corrective action recorded", set.corrective_action]);
            const verified = sup ? step("verify") : null;
            if (verified) {
              status = "verified_closed";
              set.verified_by = sup.id;
              history.push([f.id, verified, sup.id, sup.name, "tpm_supervisor", "Verified and closed", "Confirmed resolution during follow-up visit."]);
            }
          }
        }
      }
      counts[status] = (counts[status] ?? 0) + 1;
      await pg.query(
        `update issues set status = $2, assigned_dri = $3, dri_response = $4, corrective_action = $5, verified_by = $6, resolution_date = $7 where id = $1`,
        [f.id, status, set.assigned_dri, set.dri_response, set.corrective_action, set.verified_by, set.resolution_date],
      );
    }

    for (let i = 0; i < history.length; i += 300) {
      const chunk = history.slice(i, i + 300);
      const params = [];
      const values = chunk.map((h) => `(${h.map((v) => { params.push(v); return `$${params.length}`; }).join(",")})`);
      await pg.query(
        `insert into issue_history (issue_id, occurred_at, actor_id, actor_label, actor_role, action, note)
         select issue_id::uuid, occurred_at::timestamptz, actor_id::uuid, actor_label, actor_role::user_role, action, note
         from (values ${values.join(",")}) v(issue_id, occurred_at, actor_id, actor_label, actor_role, action, note)`,
        params,
      );
    }

    const pastTarget = (await q(`select count(*)::int n from issues where id = any($1) and status <> 'verified_closed'
                                   and reported_at < now() - interval '30 days'`, [ids]))[0].n;
    console.log(`${findings.length} DUMMY Findings:`, counts, `· ${history.length} history entries · ${pastTarget} open past 30 days`);
    if (DRY) { await pg.query("rollback"); console.log("Dry run — rolled back."); }
    else { await pg.query("commit"); console.log("✅ Committed."); }
  } catch (e) {
    await pg.query("rollback").catch(() => {});
    console.error("❌ Failed, rolled back:", e.message);
    process.exitCode = 1;
  } finally {
    await pg.end();
  }
})();
