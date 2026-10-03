# Permissions review — M6 pilot hardening (3 Oct 2026)

How access is controlled, what the review checked, what it found and what was changed. Re-run the
two tools below before go-live and after every migration.

```bash
cd web-platform/tools/db
node audit-permissions.js          # catalogue audit: RLS, signed-out access, definer functions, views, buckets, accounts
node test-mobile-role-access.js    # every role tried against every rule (rolled back; nothing left behind)
```

## 1. How access works

- **The database decides.** Every table in `public` has row-level security; the web, the app and
  the API all go through the same policies. Screens hide what a role can't use, but hiding is
  only convenience.
- **Ledger and visits are written only through functions** (`record_receipt`, `record_issue`,
  `record_dispensing`, `record_stock_count`, `record_loss`, `record_visit`,
  `confirm_adjustment`). Each checks the caller's role, facility or supervision scope, and is
  idempotent on the phone's `local_id`. No role can insert, edit or void a ledger row directly.
- **Scope:** a facility user sees their own facility; a supervisor the facilities of their level
  in their LGAs; reviewers and admins their project; Super Admin everything (DECISIONS R16, R34).

## 2. What was checked

| Check | Tool | Result |
| --- | --- | --- |
| Every `public` table has RLS on | audit-permissions | ✅ all (PostGIS `spatial_ref_sys` exempt — a public catalogue) |
| No policy open to signed-out users | audit-permissions | ✅ none |
| Every SECURITY DEFINER function pins `search_path` | audit-permissions | ✅ all |
| No function callable signed out | audit-permissions | ❌ → ✅ fixed in 0108 (was 27) |
| Views keep RLS (`security_invoker`) | audit-permissions | ✅ |
| Storage buckets private | audit-permissions | ✅ 4 of 4 private |
| Every active account (except Super Admin) has a project | audit-permissions | ✅ all |
| Per-role reads and writes on Findings, reference data, ledger, visits, DHIS2, audit trail, sync | test-mobile-role-access | ✅ 202/202 |

## 3. Findings and fixes (migration 0108)

| # | Finding | Risk | Fix |
| --- | --- | --- | --- |
| P1 | Supabase grants EXECUTE on new functions to `anon`. 27 SECURITY DEFINER functions (which bypass RLS) were callable with only the public key, signed out — including `ledger_balance` (any facility's stock) and `create_notification`. | High | EXECUTE revoked from `anon`/`PUBLIC` on every function, and by default for future ones. Trigger and internal functions not executable at all. |
| P2 | `create_notification` writes a notification **and sends an email** to any user, with caller-supplied text and link. Any signed-in user could have sent phishing-style emails from the platform's sender. The email also inserted the text as raw HTML. | High | It now refuses any API call that doesn't come from one of the seven review functions that legitimately use it; email text is HTML-escaped and the link must be a relative path. |
| P3 | `ledger_balance()` ran with owner rights, so a facility user could read any facility's balance through it. | Medium | Runs with the caller's rights; inside the record/evaluate functions it still sees the whole ledger. |
| P4 | DECISIONS R27: a facility user's ledger read policy included the supplier's issue lines (to pre-fill Receive Stock), so an unfiltered balance query showed partial supplier rows. | Low | Policy narrowed to own facility; the app reads the pre-fill through `incoming_transfer_lines()`. **Phones on the M5 build lose the Receive Stock pre-fill until updated** — install the M6 build before the pilot. |
| P5 | No audit trail for changes to reference data, user access or ledger status (brief §10). | Medium | `audit_log` with triggers on facilities, lots, dosing rules, thresholds, profiles, supervisor LGAs, DHIS2 reports, and status changes on ledger rows and transfers. Readable by Super Admin and Project Admin (web: Administration → Audit Trail). |
| P6 | `in_scope()` treats a non-Super-Admin with no project as unscoped (inherited TPM rule). | Medium | Not changed (the TPM Project Admin flow relies on it). Audit check 6 lists any such account; every pilot account must be assigned to *Katsina RUTF Pilot*. |
| P7 | Devices page was sample data; no visibility of phones that stop syncing. | Medium | Devices & Sync (real data, see §5). |

## 4. Accounts

`audit-permissions.js` check 6 lists active accounts other than Super Admin with no project.
All current accounts pass; real pilot accounts must be created in the pilot project too.

## 5. Not changed — for the programme to decide

- **Voiding a ledger entry** — added in migration 0109: Super Admin or the project's Project
  Admin, with a reason, from the Stock Ledger. Facility users and supervisors still correct with
  an Adjustment.
- **Risk-Based Planner CSV** is downloaded directly (admins and supervisors), not through the
  download-request approval. It holds facility names, risk scores and supervisor names, no child data.
- **Daily Attendance** — removed from the supervisor app (R50) and the web (R51). The server table and bucket still hold records captured earlier, readable only through the API by the roles RLS allows, until the DPO decides on retention.
- **Email links** — removed (migration 0110): notification emails carry the text and ask the reader to sign in; no link to the TPM deployment. The sender is a setting (Settings → Notifications, migration 0111), still empty = Resend's test address — set it once the programme's domain is verified in Resend.
