# TPM Monitoring Platform — Test Matrix

Covers the "Consolidated Updates, Workflow Changes, Rebranding & Attendance Module" master prompt
(Items 1-20). Status reflects what has actually been exercised, not what "should" work.

Legend: ✅ verified (says how) · ⏳ needs manual click-through · 🔧 needs Android rebuild first

---

## Item 1 — Dynamic landing page stats

| Test case | Expected result | Status |
|---|---|---|
| Load `/login` with no auth | States/LGAs/Settlements/Health Facilities counts come from `getPlatformStats()` (live DB counts), not the old baked-in image numbers | ✅ verified via local dev server + browser preview |
| DB has 0 approved settlements | Stat shows `0`, not a crash or `NaN` | ✅ `getPlatformStats()` wraps in `.catch(() => null)`; falls back gracefully |

## Items 2-4 — State Coordinator review workflow, DRI sector scoping, Category→Sector

| Test case | Expected result | Status |
|---|---|---|
| Field Monitor submits a new Finding | Status = `Pending Review` (not `New`) | ✅ DB default confirmed (migration 0032); Android `submitNewIssue` sets `PendingReview` locally |
| State Coordinator opens a `Pending Review` Finding in their managed state | Sees Approve & Assign / Return for Correction buttons | ⏳ needs a real State Coordinator login click-through |
| State Coordinator opens a Finding **outside** their managed state | RLS denies — Finding doesn't appear in their list at all | ✅ verified via `issues_select` policy text (state_id = managed_state_id) |
| State Coordinator clicks Approve & Assign, picks a DRI | Finding status → `Assigned`, DRI notified, DRI-picker only shows DRIs in the Finding's sector | ⏳ needs click-through (DRI-picker sector filter is `getDris(supabase, categoryId)`) |
| State Coordinator clicks Return for Correction with a comment | Status → `Returned for Correction`, Field Monitor notified, comment visible in history | ⏳ needs click-through |
| DRI logs in, views their Findings list | Only sees Findings where `assigned_dri = self` AND `category_id = their assigned sector` | ✅ verified live: `naisresources@gmail.com` DRI login + Response wizard tested this session; RLS text double-checked in security audit (§25) |
| DRI account's `assigned_category_id` is `null` (unassigned) | Sees 0 Findings, not an error | ✅ RLS clause requires exact match; null never matches |
| A `dri` account attempts to `PATCH` its own `assigned_category_id` via raw REST | Rejected — pinned back to old value by `enforce_profile_update_rules()` | ✅ fixed & verified live this session (migration 0038, §25) — **this was a real bug before the fix** |
| Sector picker in New Finding wizard (mobile) | Shows the 7 new sectors (Protection & AAP, Nutrition (OTP), Health Services, WASH, MHPSS Services, Food Assistance, Fraud) | 🔧 needs Android rebuild + manual check |
| Historical Finding with a legacy (now-inactive) category | Still displays its original category name everywhere (detail page, CSV export, filters) | ✅ `getAllCategories()` (unfiltered) used for filter dropdowns/exports; `is_active=false` only hides from *new*-submission pickers |

## Item 5 — Roles: add State Coordinator, rename TPM Supervisor → TPM Field Monitor

| Test case | Expected result | Status |
|---|---|---|
| Users page → Add User → role dropdown | Shows "State Coordinator" as a selectable role, with a Managed State field appearing when selected | ⏳ needs click-through |
| Existing `tpm_supervisor` accounts | Still log in and work identically — only the *label* changed, not the DB enum value or route | ✅ confirmed: `ROLE_LABELS.tpm_supervisor` renamed in place, no new role/duplicate created, no DB enum change needed |
| Mobile field monitor role pill on Home screen | Reads "TPM Field Monitor", not "Field Monitor" or "TPM Supervisor" | 🔧 needs Android rebuild |

## Item 6 — "Issues" → "Findings" terminology sweep

| Test case | Expected result | Status |
|---|---|---|
| Web: nav label, page titles, table headers, CSV export header, empty-states | All read "Finding(s)", not "Issue(s)" | ✅ verified via `tsc`/lint clean + manual grep of changed files |
| Old `issue_history` rows (pre-rename) | Still display correctly; reporter-name extraction still works | ✅ Android's dual-match (`"Finding reported" || "Issue reported"`) confirmed; web renders `h.action` raw, no matching needed |
| Mobile: every wizard step label, toast, status name | Reads "Finding", not "Issue" | 🔧 needs Android rebuild — full terminology sweep done in source, unverified on-device |
| Route `/issues`, DB table `issues`, API/JSON field names | Unchanged — only user-facing text changed | ✅ deliberate, confirmed via review |

## Item 7 — Download approval: add Project Admin

| Test case | Expected result | Status |
|---|---|---|
| Project Admin opens Download Requests page | Sees the review table (not just "my requests"), scoped to their own project's requests only | ⏳ needs click-through with a Project Admin account |
| Project Admin approves a request from a different project | Rejected — `in_scope(project_id)` denies | ✅ verified via RLS policy text (`download_requests_update_project_admin`) |
| Super Admin still approves any request | Unaffected — original `is_super_admin()` policy untouched (additive change) | ✅ confirmed additive-only migration |
| Requester gets notified when a Project Admin (not just Super Admin) decides | Notification created | ⏳ needs a live end-to-end request→decide cycle |

## Item 8 — DRI terminology (full term on first reference)

| Test case | Expected result | Status |
|---|---|---|
| Role-selection dropdown (Add/Edit User) | Shows "Direct Responsible Individual (DRI)" | ✅ `roleOptionLabel()` verified in source |
| Role badge in Users table, header role pill | Shows compact "DRI" | ✅ deliberate — `ROLE_LABELS.dri` left as "DRI" for space-limited contexts |
| GIS map DRI label | Shows full term once | ✅ verified in `GisMapInner.tsx` |

## Items 9-15 — Field Monitor Daily Attendance

| Test case | Expected result | Status |
|---|---|---|
| `field_monitor_attendance` table, RLS, storage bucket, trigger exist | All confirmed live via direct Postgres queries | ✅ done last checkpoint |
| `resolve_administrative_location()` on a real Abuja coordinate | Returns correct state/LGA | ✅ tested live this session (Fct / Municipal Area Council / Gwarinpa) |
| Web `/attendance` page, non-admin role | Redirects to `/dashboard` | ✅ `canAccessAttendance()` gate confirmed in code; `tsc`/lint clean |
| Web `/attendance` page, Super Admin/Project Admin/State Coordinator | Sees table with signed photo thumbnails, device-reuse banner when applicable | ⏳ needs click-through (no records exist yet — needs a real mobile submission first) |
| Mobile: Field Monitor taps "Daily Attendance" from Home | Selfie step (front camera only, no gallery) → Location photo (back camera, no gallery) → GPS → Review → Submit | 🔧 needs Android rebuild — **not yet exercised on-device at all** |
| Mobile: attempt a 2nd attendance same day | "Already recorded for today" screen, no capture wizard shown | 🔧 needs Android rebuild |
| Mobile: submit while offline | Queues in Sync Queue as "Daily Attendance", pushes once connectivity returns | 🔧 needs Android rebuild |
| Mobile: retry a push that partially succeeded (photos uploaded, insert response lost) | Treated as success on retry (23505 unique-violation path), not stuck retrying forever | 🔧 needs Android rebuild — logic reviewed but not exercised |
| Two different Field Monitor accounts submit from the same physical device | Web admin table flags the shared `device_id` with a warning banner, does **not** block either submission | ⏳ needs two real mobile submissions to observe |

## Item 16 — Role & data security (backend/DB-enforced)

| Test case | Expected result | Status |
|---|---|---|
| Full RLS/SECURITY DEFINER/storage-policy audit | See DECISIONS.md §25 for the complete findings list | ✅ done this session |
| `dri`/`state_coordinator` self-PATCH of `assigned_category_id`/`managed_state_id` | Blocked (was previously exploitable — see §25) | ✅ fixed & verified live (migration 0038) |
| Every RLS policy scoped to `authenticated`, none to `anon`/`public` | Confirmed — `anon`'s default Supabase grants are inert | ✅ verified via `pg_policies` |
| Every `SECURITY DEFINER` function sets `search_path = public` | Confirmed — no search-path injection surface | ✅ verified via `pg_proc.proconfig` |
| Base `issues_update`/`issues_insert` policies allow direct-REST bypass of RPC business logic for `project_admin`/`tpm_supervisor`/`dri` | **Known, pre-existing, not fixed** — flagged for a decision, not silently changed (see §25) | ⏳ awaiting your decision on whether to harden |

## Item 17 — Database & migration requirements

| Test case | Expected result | Status |
|---|---|---|
| Every migration this project applied is additive (no `DROP TABLE`/destructive rewrite of populated data) | Confirmed by review of migrations 0031-0038 | ✅ |
| Category→Sector data swap preserves FK integrity for historical Findings | Legacy categories marked `is_active=false`, not deleted while referenced | ✅ confirmed live (0 orphaned `category_id` references) |
| `full_migration.sql` matches the live DB migration history | Regenerated after every migration this session | ✅ current as of migration 0038 |

## Item 18 — UI/UX simplicity

Guiding principle applied throughout rather than a standalone test — every new screen/flow reuses
existing components (`WizardScaffold`, `PhotoCaptureStep`, `GpsCaptureStep`, `TpmCard`/`TpmButton`,
existing RBAC helpers) rather than introducing new patterns.

## Item 19 — This document.

## Item 20 — Final system-wide quality check

| Check | Result |
|---|---|
| `npx tsc --noEmit` (web) | Clean |
| `npm run lint` (web) | 6 pre-existing issues, unrelated to any change this project made across the whole session — 0 new |
| Android: Gradle CLI build | Not runnable in this environment (sandboxed loopback socket) — **you must rebuild in Android Studio** to get real compiler verification |
| Security audit | Complete — 1 real finding, fixed (§25); 1 pre-existing architectural note flagged, not changed; 1 harmless cleanup item spun off separately |

---

# RUTF M1 — Reference data & users (brief §11)

| Test case | Expected result | Status |
|---|---|---|
| Katsina boundaries loaded | 1 state, 34 LGAs, 361 wards, every LGA/ward has an `abbr` | ✅ `gis-import/import.js --states KT` + `check-counts.js` |
| Facility import | 2,455 facilities (1 State store, 34 LGA stores, 2,420 health facilities, 272 OTP sites), every one inside an LGA and a ward; 6 lots | ✅ `import-reference.js` summary; 69 wards resolved from coordinates, 12 location flags |
| Ward left blank, coordinates given | Ward filled from the boundary polygon | ✅ `test-mobile-role-access.js` §C |
| Health facility pointed at the State store as supplier | Rejected (supply chain one level at a time) | ✅ §C |
| Facility visibility per role | SA/PA/State Coordinator/Supervisor see all 6 test facilities; a DRI on OTP1 sees OTP1 + its LGA store only | ✅ §C |
| Add a facility | SA → live; PA → `pending_create`; others denied | ✅ §C |
| PA edits a live facility | Live row unchanged, status `pending_update` until approved | ✅ §C |
| `approve_facility` | SA only | ✅ §C |
| Add a lot / edit a dosing band / edit a threshold | Lot: SA + PA. Dosing band, threshold: SA only | ✅ §C |
| Assign a DRI to a facility | Level (`assigned_category_id`) becomes the facility's level (OTP) | ✅ §C |
| PA assigns a user to a facility in another project | Rejected | ✅ §C |
| DRI PATCHes own `facility_id` | Pinned back | ✅ §C |
| Whole role-access suite | 137/137 pass | ✅ `node tools/db/test-mobile-role-access.js` |
| Data Sets page queries (search, OTP filter, flagged filter, store list, thresholds) | Return the expected rows | ✅ run against Supabase with the service key; web `tsc` + `eslint` clean |
| Data Sets: add/edit facility, CSV upload (update OTP flags by code), lots, dosing rules, thresholds | Work end-to-end in the browser | ⏳ needs a Super Admin click-through (sign-in not possible from this session) |
| Users & Roles: assign a DRI to a store / OTP site, bulk import with a facility column | Facility shown under the role; DRI scoped | ⏳ needs click-through |
| Android Room v9 → v10 | `ref_facilities` created; `replaceFacilities` drops rows the user no longer sees | 🔧 `MigrationTest.migrate9To10_createsFacilitiesTable` compiles; run on a device/emulator. Migration SQL matches the exported `10.json` exactly |
| Android: DRI Home shows "My facility" offline | Facility name, type, supplier from the local cache | 🔧 `assembleDebug` builds; needs a device check with a real DRI account |
| Android unit tests | 22/22 pass | ✅ `gradlew testDebugUnitTest` (JDK 21, see DECISIONS R20) |

# RUTF M2 — Ledger & facility recording (brief §11)

| Test case | Expected result | Status |
|---|---|---|
| State → LGA → OTP transfers and a week of dispensing reconcile | SST 1,500 / LST 900 / OTP 160 after receipt, issue, short receipt (2 damaged), 7 × 60 dispensed, a count 3 short and a 5-sachet loss | ✅ `node tools/db/test-ledger.js` (26/26) |
| Forced retries (3 × 3 submissions) | All answered `duplicate`; no new ledger rows, transfers or dispensing days | ✅ test-ledger.js |
| Short receipt | Transfer `discrepancy`, gap 10 | ✅ test-ledger.js |
| Count differs from the ledger | Adjustment for the difference; count result returns the ledger balance | ✅ test-ledger.js |
| Recording outside your own facility / OTP issuing / issuing to an unsupplied facility / supervisor recording / second entry for a day / direct insert / future date | All refused | ✅ test-ledger.js |
| Read scope | OTP user can't read the State store ledger; reads its own and the issue lines addressed to it; supervisor reads all | ✅ test-ledger.js |
| Dummy ledger load | 3,364 transfers, 17,380 rows, 6,998 dispensing days; no negative lot balance | ✅ `import-ledger.js` summary |
| Stock Ledger / Transfers page queries as an OTP user and as a supervisor | OTP user: own facility's 61 ledger rows, 12 transfers; supervisor: all 17,380 rows, 3,364 transfers, 12 overdue | ✅ run through the real API with demo sign-ins; web `tsc` clean, `eslint` clean for the new files |
| Stock Ledger / Transfers pages in the browser | KPIs, filters, running balance, links | ⏳ needs a click-through (sign in as `hadiza.danjuma@…` or `safiya.isa@…`) |
| Android: offline projection, cartons → sachets, record_* parameters, queue JSON round trip | As migration 0101 expects | ✅ `StockProjectionTest` (7) — Android unit tests 29/29 |
| Android Room v10 → v11 | Six stock cache tables; SQL identical to the exported `11.json` | ✅ schema compared; 🔧 `MigrationTest.migrate10To11_createsStockCacheTables` compiles, run on a device |
| Android: Receive / Issue / Daily Dispensing / Stock Count / Loss / My Stock end to end, offline then online | Queued, synced once, balances refresh | 🔧 `assembleDebug` builds; no emulator or device here — needs a device run with a demo facility user |

# RUTF M3 — Auto-Findings (brief §11)

| Test case | Expected result | Status |
|---|---|---|
| Month-end count 7% below the ledger, synced through `record_stock_count` | Exactly one `stock_variance` Finding, `pending_review`, auto-generated, metric 7% / limit 5%, filed under OTP, structured ID | ✅ `node tools/db/test-findings.js` (13/13) |
| Short receipt (490 of 500) | Exactly one `transfer_mismatch`, linked to the transfer, gap 10 | ✅ test-findings.js |
| Re-run checks (single facility, all facilities) and a retried sync | No duplicates | ✅ test-findings.js |
| Count 3% off (under the 5% limit) | No Finding | ✅ test-findings.js |
| State Coordinator sees the Findings in review; facility user can't run checks | As stated | ✅ test-findings.js |
| Rules over the dummy ledger Apr–Sep vs `check.py` | stock_variance 137, transfer_mismatch 68, receipt_not_confirmed 12, stockout 8 facilities, expired_stock 13, short_dispensing 108, late_reporting 13 OTPs — all equal | ✅ evaluated live (424 Findings); `python tools/dummy-data/check.py` |
| Nightly job | `cron.job` row `rutf-nightly-findings`, 01:30 UTC, active | ✅ queried |
| Earlier suites after 0102 | test-ledger 26/26, role access 137/137 | ✅ |
| Findings list (Auto tag, source/type filters) and detail (Automatic check card) | Query shapes return facility, type, metric, transfer for a reviewer | ✅ via the API as the demo State Coordinator; ⏳ browser click-through |

# RUTF M4 — Supervision (brief §11)

| Test case | Expected result | Status |
|---|---|---|
| OTP verification: register 875 vs app 700 sachets (VF 1.25) | Exactly one `dispensing_gap` Finding in review, linked to the visit | ✅ `node tools/db/test-visits.js` (21/21) |
| Retried visit sync | Same visit returned, marked duplicate; no second visit or Finding | ✅ test-visits.js |
| Store check: 13% count variance, no stock card, stock on the floor, ~1 km from the point | `stock_variance`, `no_stock_card`, `poor_storage`; visit flagged outside the geofence | ✅ test-visits.js |
| Supervisor outside their LGA / wrong level / facility user / store check at an OTP / future date | Refused | ✅ test-visits.js |
| Adjustment confirmation | Only the facility's own supervisor; retry harmless; facility user refused | ✅ test-visits.js |
| Dummy visits vs `check.py` | dispensing_gap 15, register_missing 9, poor_storage 7, no_stock_card 6, supervisor variance 18, outside geofence 7 — all equal | ✅ `import-visits.js` (live) |
| Stockout rule from first receipt (0104) | Test facilities onboarded mid-month: no false stockout; dummy unchanged (16 / 8) | ✅ test-findings.js 13/13 |
| Earlier suites | ledger 26/26, findings 13/13, role access 137/137 | ✅ |
| Android visit preview (same cases as the server test), record_visit parameters | As the server | ✅ `VisitPreviewTest` — Android unit tests 37/37 |
| Android Room v11 → v12 | Three supervision cache tables, SQL equal to `12.json` | ✅ schema compared; 🔧 `MigrationTest.migrate11To12…` compiles, run on a device |
| **Both visit types end-to-end on a physical device** (brief M4 "done when") | Visit recorded offline, synced once, Findings in review | 🔧 `assembleDebug` builds — **needs a phone** with `hadiza.danjuma@…` (OTP sites) and `hadiza.kankia@…` (stores) |
| Users & Roles: assign a supervisor's level and LGAs | Shown under the role; scope applies to visits | ⏳ click-through |

# RUTF M5 — Dashboards, metrics, risk, planner, DHIS2 (brief §11)

| Test case | Expected result | Status |
|---|---|---|
| `rutf_kpis` vs hand calculation (`tools/dummy-data/kpis.py`) — Jul, Aug, Sep 2026 | Every KPI equal (Sep: stock on hand 2,876,700 / 1,092,803 / 609,347; MoS 3.22 / 1.25 / 0.72; stockout 2.0%; variance 2.79%; short −0.19%; VF median 1.00; dispensing completeness 98.0%; counts on time 98.4%; supervision 306 / 307) | ✅ `node tools/db/test-kpis.js 2026-09` (26/26; also 07, 08) |
| Risk score and planner sanity | Scores 0–100; due reasons consistent; suggestions ≤ workload per supervisor | ✅ test-kpis.js |
| DHIS2 import | 1,632 facility-months; re-run updates in place | ✅ `import-dhis2.js` (live) |
| Queries per role (rolled back, JWT claims) | Admin / reviewer / supervisor see the project, a facility user only their facility; planner rows for admins and the supervisor's own facilities | ✅ project admin, supervisor, facility user, viewer, state coordinator |
| Performance after 0106 / 0107 | Reviewer KPI call < 2 s via the API (was 34.7 s) | ✅ ~0.5–1.1 s |
| Earlier suites after 0105–0107 | role access 137, ledger 26, findings 13, visits 21 | ✅ |
| Dashboard layout with real data | Hero, sections, meters, Findings panels | ✅ checked on a temporary preview page (removed) |
| Stock Integrity / Reporting Completeness / OTP Dispensing / Supervision / DHIS2 pages, CSV export, DHIS2 upload | Render for each role; upload replaces facility-months | ✅ typecheck + lint; ⏳ browser click-through (sign-in needed) |
| Map layers by risk / months of stock | — | ⏳ deferred (R42) |

# RUTF M6 — Pilot hardening (brief §11)

| Test case | Expected result | Status |
|---|---|---|
| Catalogue audit (`tools/db/audit-permissions.js`) | RLS on every table; no signed-out policies or functions; definer `search_path`; `security_invoker` views; private buckets; every account in a project | ✅ no problems (before 0108: 27 SECURITY DEFINER functions callable signed out) |
| Role-access matrix incl. section D (0108) | 202 checks across 5 roles + signed out | ✅ `node tools/db/test-mobile-role-access.js` 202/202 |
| Facility user can't read the supplier's ledger or balance; Receive Stock pre-fill via `incoming_transfer_lines` (own facility only) | 0 rows / 0 balance; 1 line; 0 for another facility | ✅ section D |
| Direct ledger insert / void, direct visit insert | Denied for every role | ✅ section D |
| `create_notification` called directly (any role, signed out) | Denied; review RPCs that use it still work | ✅ section B + D |
| Audit trail | Change logged; visible to Super Admin / Project Admin only | ✅ section D |
| Sync report → status | Failing device shows *failing*; visible to own user and reviewers, not other supervisors; cleared once synced | ✅ section D |
| Earlier suites after 0108 | ledger, findings, visits, KPIs | ✅ ledger 27/27 (pre-fill check moved to `incoming_transfer_lines`, plus supplier rows hidden), findings 13/13, visits 21/21, KPIs 26/26 |
| New queries per demo role | Sync health and failures: admins and State Coordinator only; audit trail: admins; under 0.5 s | ✅ via JWT claims (rolled back) |
| Android `SyncReport` (counts, failing list, error cleaning, cap) | As specified | ✅ `SyncReportTest` — unit tests 41/41; `assembleDebug` builds |
| Devices & Sync, Audit Trail pages | Render for admins; hidden from other roles | ✅ typecheck + lint; ⏳ browser click-through |
| Morning digest (`rutf-sync-digest`, 06:00 UTC) | One unread notification per admin when devices need attention | ⏳ check after the first morning run |
| **UAT signed by the programme lead** (brief M6 "done when") | `docs/UAT_SCRIPT.md` completed and signed | ⏳ programme |

# Ledger void (migration 0109)

| Test case | Expected result | Status |
|---|---|---|
| Facility user / supervisor voids; reason under 10 characters | Refused | ✅ `test-ledger.js` §11 |
| Void an issue whose transfer was received | Refused until the receipt is voided | ✅ |
| Void a short receipt | 2 rows voided, transfer back in transit, OTP balance −428, 1 lot below zero reported | ✅ |
| Then void the issue | Transfer cancelled; LGA store gets the 600 back | ✅ |
| Void a dispensing day | Day leaves the daily totals, kept with who/why; balance +60; the day can be recorded again; re-void answered as duplicate | ✅ |
| Void a stock count | Its adjustment drops out | ✅ |
| Audit trail and nothing deleted | Void logged with the actor; every row still present | ✅ — ledger 44/44 |
| Unchanged results elsewhere | findings 13/13, visits 21/21, KPIs Aug + Sep 26/26 with 0109 | ✅ |
| Dummy importer through the view | `on conflict (id) do nothing` still works | ✅ (rolled back) |
| Stock Ledger Void button (admins only) | Opens inline, asks the reason, shows the outcome | ✅ typecheck + lint; ⏳ browser click-through |

# Daily Attendance removed from the app (R50)

| Test case | Expected result | Status |
|---|---|---|
| Supervisor Home | No Daily Attendance action; route gone | ✅ code removed; `assembleDebug` builds |
| Room v12 → v13 with an attendance record, a queued attendance and a queued dispensing | Table dropped, attendance queue row and selfie file deleted, dispensing row kept; schema equals `13.json` | 🔧 `MigrationTest.migrate12To13…` compiles — run on a device |
| Unit tests | MobileAccessTest without the attendance capability | ✅ 41/41 |
| Web: Field Monitor Attendance page | Gone from the Administration menu; `/attendance` returns not found | ✅ files removed, typecheck clean; ⏳ browser check |

# Email links (migration 0110)

| Test case | Expected result | Status |
|---|---|---|
| `create_notification` body | No vercel.app / TPM link; platform-only guard and grants unchanged | ✅ dry run (rolled back) |
| Review actions that notify | Still allowed for the right roles | ✅ role access 202/202 with 0110; applied, permissions audit clean |

# Email sender setting (migration 0111)

| Test case | Expected result | Status |
|---|---|---|
| `email_from_address` format check | Accepts `noreply@ehealthnigeria.org`, `rutf.alerts@health.kt.gov.ng`; rejects `not-an-email`, `a@b`, two addresses, `Name <x@y.org>` | ✅ dry run (rolled back) |
| `create_notification` | Uses the setting, falls back to `onboarding@resend.dev`; guard and grants unchanged; no TPM link | ✅ role access 202/202 with 0111; applied, permissions audit clean |
| Settings → Notifications sender field | Saves for Super Admin; invalid address refused in the form | ✅ typecheck; ⏳ browser check |
