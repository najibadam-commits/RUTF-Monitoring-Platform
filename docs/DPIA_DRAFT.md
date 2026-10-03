# Data Protection Impact Assessment — draft for the DPO

**System:** RUTF-DTAP Monitoring Platform (web + Android), Katsina RUTF pilot
**Law:** Nigeria Data Protection Act 2023 (NDPA) and the NDPC's implementing guidance [DPO: confirm the current directive]
**Status:** DRAFT prepared from the system as built (milestone M6, 3 Oct 2026). Items marked
**[DPO]** need the Data Protection Officer's decision; items marked **[PROG]** need the programme lead.
This draft describes what the system actually stores and who can see it, so the DPO can assess
it — it is not itself the assessment.

---

## 1. Purpose and lawful basis

The platform tracks RUTF (ready-to-use therapeutic food) from the State store to OTP sites:
receipts, issues, daily dispensing totals, stock counts, losses, supervision visits, and Findings
for review where the figures don't agree. Its purpose is to make sure RUTF reaches malnourished
children and to detect loss and diversion early.

- **Data subjects:** government and programme staff who use the system (facility users,
  supervisors, reviewers, administrators). **No child or caregiver is a data subject** — see §2.
- **Lawful basis [DPO]:** proposed — a task carried out in the public interest / in the exercise
  of official authority, for health-programme staff acting in their official role.
  Consent is not proposed as the basis for staff data.

## 2. Child-level data — designed out

| Control | How it is enforced |
| --- | --- |
| No child or caregiver names, phone numbers, IDs or per-child rows | There is no field for them anywhere. OTP data is one row per facility per day: new admissions, children seen, sachets prescribed, sachets dispensed (`otp_daily_dispensing`). Supervisors recount period **totals** from the register (`otp_verifications`). |
| Register-page photos | Optional. The app requires the user to confirm that every child and caregiver name is covered before the photo is accepted; training (docs/training) repeats it. **Residual risk:** a user could still photograph an uncovered page — see §7. |
| No photos of children | Instructed in the app and training; camera-only capture into private buckets. |
| Free-text notes (loss reason, adjustment note, visit notes, Finding descriptions) | Instructed not to contain names. **Residual risk** — see §7. |
| Small numbers | Daily tallies at one OTP can be small (1–4 children). These figures are shown only to signed-in staff with a role in the programme; there are **no public displays** of child counts. Any future public or partner-facing output must suppress cells < 5 (brief §10). |

## 3. Personal data the system processes

| Data | Where | About whom | Why |
| --- | --- | --- | --- |
| Name, email, phone (optional), role, facility / LGA assignment | `profiles`, Supabase Auth | All users | Sign-in, access control, notifications |
| Initials | `issue_id_counters`, Finding IDs | Users who register Findings | Finding reference numbers |
| GPS location of a supervision visit (lat/lng, accuracy, distance from facility) | `monitoring_visits` | Supervisors | Evidence the visit took place at the facility |
| **Selfie at the facility** | `visit-evidence` bucket | Supervisors | Evidence of presence (brief §8) — **[DPO]: facial image; assess whether a selfie is necessary or whether GPS + stock photos suffice** |
| ~~Attendance selfie, GPS, device id~~ — **removed from the app and the web** (DECISIONS R50, R51); earlier records stay in `field_monitor_attendance` / `attendance-evidence`, no longer shown anywhere, until the retention decision | `field_monitor_attendance`, `attendance-evidence` bucket | Supervisors | No new data |
| Device identifier (Android ID), device model, OS and app version | `stock_transactions`, `otp_daily_dispensing`, `monitoring_visits`, `device_sync_status` | All device users | Idempotent sync, sync-failure monitoring |
| Sync error messages (first line only, ≤ 300 characters, tokens stripped) | `sync_failures` | Device users | Support when records don't sync |
| Who did what, when (actor id, old/new values) | `audit_log`, `issue_history`, ledger `recorded_by` | All users | Accountability, audit trail (brief §10) |
| Photos of waybills, stock cards, stock | `ledger-evidence`, `visit-evidence` buckets | Incidental (signatures on waybills) | Evidence for receipts, counts and losses |

## 4. Who can see what (access control)

Enforced in the database by row-level security on every table, so it applies equally to the web,
the app and the API. Reviewed in M6 — see `docs/PERMISSIONS_REVIEW.md`.

| Role | Sees |
| --- | --- |
| Facility user | Their own facility only (stock, dispensing, its Findings) — offline too |
| Supervisor | Facilities in their LGAs and level; visits they recorded |
| State Coordinator (reviewer) | The project's data; Findings to review; Devices & Sync |
| Project Admin | The project's data, user management, DHIS2 upload, audit trail |
| Super Admin | Everything; reference data sign-off |
| Viewer | Read-only dashboards; no administration; exports only through approval |

- Photos are in **private** buckets, served only through short-lived signed links.
- Nothing is callable without signing in (verified by `tools/db/audit-permissions.js`).
- Exports go through the existing download-request approval. **Exception to review [DPO]:** the
  Supervision Planner CSV (facility names, risk scores, supervisor names) is downloaded directly
  by admins and supervisors.

## 5. Storage, security, backup

| Item | Current state | Action |
| --- | --- | --- |
| Hosting | Supabase (managed Postgres + storage), web on Vercel | **[DPO]** confirm hosting region and whether the NDPA cross-border transfer rules apply |
| Encryption | TLS in transit; provider encryption at rest | — |
| Phone storage | Records wait in the app's private storage until synced; photos in the app's private files | **[PROG]** require a screen lock on programme phones |
| Backups | Provider daily backups (plan-dependent) | **[PROG]** confirm the plan includes point-in-time recovery for the pilot |
| Keys | Service keys only on the server and admin workstations, never in the app or repository | — |
| Email | Notification emails via Resend; contain the notification text only (no link since migration 0110), no child data | Sender domain to be moved to the programme's own domain before go-live |

## 6. Retention [DPO]

Nothing is deleted automatically today. Proposed:

| Data | Proposed retention |
| --- | --- |
| Ledger, transfers, dispensing totals, visits, Findings, audit trail | Life of the programme + 5 years (financial / supply audit) |
| Evidence photos (waybills, stock cards, register pages, stock) | 2 years after the visit/record, then delete |
| Selfies (visit, and attendance records captured before removal) | 90 days, then delete |
| Sync error messages | 180 days after resolution |
| Accounts of people who leave | Deactivate on departure (they can no longer sign in); names stay on the records they made |

## 7. Risks and mitigations

| Risk | Likelihood / impact | Mitigation in place | Further action |
| --- | --- | --- | --- |
| Child names captured in a register photo | Medium / High | Names-covered confirmation; optional photo; private bucket; training | **[DPO]** consider removing register-page photos entirely; reviewers to report and delete any uncovered photo |
| Names typed into free-text notes | Low / High | Training; neutral prompts | Periodic review of notes by the Project Admin |
| A lost or stolen phone with unsynced records | Medium / Low | No child data on the phone; account can be deactivated centrally | Screen lock; sync daily |
| Over-broad access by misconfiguration | Low / Medium | RLS on every table; automated permissions audit; role-access test (202 checks) | Re-run both before go-live and after every migration |
| An account with no project assigned sees every project | Low / Medium | Only one project today | Audit flags any such account; assign every account to the pilot |
| Findings perceived as accusations | Medium / Medium | Neutral wording; Findings go to the reviewer first | Training |
| Supervisor location tracking beyond purpose | Low / Medium | GPS only at visit submission, not continuous | — |

## 8. Breach handling [DPO]

Proposed: anyone who suspects a breach reports it to the Project Admin the same day; the Project
Admin deactivates affected accounts and rotates keys if needed, records the incident, and informs
the DPO, who decides on notification to the NDPC within the statutory deadline (72 hours — [DPO] confirm) and to data
subjects where required. The audit trail and Supabase logs support the investigation.

## 9. Sign-off

| Role | Name | Decision | Date |
| --- | --- | --- | --- |
| Data Protection Officer | | | |
| Programme lead | | | |
