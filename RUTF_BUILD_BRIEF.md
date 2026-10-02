# RUTF Monitoring Platform — Build Brief for Claude Code

**Status:** Draft v0.3 · 2 Oct 2026 · Author: Najib Adam (Data & GIS Lead)
**v0.3:** model changed to **facility recording + supervisor checks** (Najib, 2 Oct). Health-facility
staff record every RUTF receipt, issue, dispensing and count; LGA/State nutrition officers verify on
routine supervision visits. Community-level data collection (caregiver interviews, market checks)
is out of scope. v0.2 answers (Katsina pilot, UNICEF data owner, product, thresholds) carry over in §12.
**Builds on:** `../TPM Monitoring Platform Design/` (web + Supabase) and `../TPM Process Monitoring App/` (Android)
**Related:** *RUTF-DTAP Technical Assessment & Digital Solution Concept Note*. This platform now
covers DTAP's facility commodity-tracking layer, but **not** its child-level registry (DTAP Card/QR).

> Items marked **[VALIDATE]** are assumptions to confirm with the programme (State nutrition unit / supply partner) before or during the build. Do not hard-code them — put them in reference tables or `settings`.

---

## 1. What we are building (and what we are not)

A **digital RUTF commodity tracking, accountability, monitoring and reporting system operating
inside the government health-facility structure** of Katsina State.

The workflow:
**RUTF is received / issued at a facility → the commodity register / stock card is completed →
authorised facility staff enter the transaction in the app → the system keeps a running stock
ledger per facility and lot, reconciles transfers between levels, and reports movement and use.**

On top of that, LGA and State nutrition officers do **routine supervision visits** (physical count,
register check) that independently verify what facilities record. Any discrepancy above threshold
— from the facility's own data or from a supervision visit — **automatically becomes a Finding**
in the existing Finding workflow (Discovery → Review → DRI response → Corrective action → Verify/Close).

| In scope | Out of scope |
| --- | --- |
| State store → LGA store → OTP stock movements, by lot | Child-level registry, DTAP Card, QR, beneficiary IDs |
| OTP **daily aggregate** dispensing from the register (totals, no rows per child) | Caregiver interviews, household visits, market checks |
| Facility stock counts, losses, expiries | External / third-party field monitors |
| Supervision visits by government nutrition officers | Live DHIS2 integration (CSV import only, §12.8) |

**Governance** is role-based: who may record, verify, approve and report, per facility and level
(§4), with the existing audit trail. No external monitor mandate is needed (§12, item 5).

**Guiding rule:** reuse before you build. Every feature uses the existing wizard framework, sync
queue, evidence capture, Finding workflow, RLS pattern, boundaries and GIS map.

---

## 2. Repository & environment setup

1. Copy both projects into this folder as `web-platform/` (from `TPM Monitoring Platform Design`) and
   `android/` (from `TPM Process Monitoring App/android`). Start **new git history** in this folder.
2. **Never copy secrets.** Exclude `web/.env.local`, `android/local.properties`, `.next/`, `node_modules/`,
   `.gradle/`, `build/`, `.claude/worktrees/`. Recreate env files from the `*.example` files.
3. Use the RUTF Supabase project (§12.1). Apply the existing migrations 0001–0042 unchanged, then
   the new RUTF migrations from `0100_` onward (keeps lineage clear).
4. Re-run `tools/gis-import/import.js` against `../state.sqlite`, `../LGA.sqlite`, `../Ward.sqlite`.
5. Rename app identity only where users see it: app name **"RUTF Monitoring"**, Android
   `applicationId = org.tpmnigeria.rutf`, web title, app mark caption. Keep package-internal names
   where renaming adds risk without value.
6. Keep `DECISIONS.md` and `TEST_MATRIX.md` going — every judgement call recorded, every new RPC tested.

---

## 3. Reuse map

| Keep as-is | Adapt | Build new |
| --- | --- | --- |
| Supabase Auth, profiles, projects, RLS pattern, SECURITY INVOKER workflow RPCs | Roles (§4); `profiles.facility_id` for facility users | `facilities` registry (stores + OTPs, geocoded) |
| States/LGAs/wards + `resolve_administrative_location()` + boundary GeoJSON RPCs | `categories` → supply-chain levels (§4) | `products`, `product_lots` |
| `issues` workflow, `issue_history` audit trail, photos, GPS captures, notifications, email | Structured Finding ID (0026) with new CAT3 codes | **`stock_transactions` ledger**, transfers, OTP daily dispensing (§5) |
| Android: Room + sync queue + SyncWorker, CameraX (camera-only), GPS modal, voice input, WizardScaffold | Home: role-based actions (§8) | Facility recording screens + 2 supervision wizards (§8) |
| Attendance, devices, download requests, data sets approval workflow | Data Sets → facilities, lots, users-to-facility upload | Ledger/variance calculations + auto-Finding rules (§6–7) |
| GIS map (Leaflet + clustering), coverage-analysis page | Map layers and filters; dashboards, analytics | Reporting completeness, transfer reconciliation, supervision planner |

---

## 4. Roles and supply-chain levels

**Roles (reuse `user_role` enum — no new values):**

| Existing role | RUTF meaning | Records | Verifies / approves |
| --- | --- | --- | --- |
| `super_admin` | Platform owner | — | Data Sets, users |
| `project_admin` | Programme manager (UNICEF / implementing partner) | — | Users and facility assignments, exports |
| `state_coordinator` | State Nutrition Officer's office (+ UNICEF officer): **reviews Findings** before they go to DRIs | — | Findings (existing 0031/0032 flow) |
| `tpm_supervisor` | **Supervisor**: LGA Nutrition Officer (supervises OTPs in their LGA) or State nutrition / SMoH M&E officer (supervises LGA stores and the State store) | Supervision visits | Verifies corrective action; confirms month-end counts |
| `dri` | **Facility user**: State store officer, LGA store officer, or OTP in-charge / nutrition focal person. Scoped to **one facility** via new `profiles.facility_id` (plus level via `assigned_category_id`) | Receipts, issues, daily dispensing, counts, losses at their facility | Responds to Findings about their facility |
| `viewer` | UNICEF / SMoH / FMoH read-only | — | — |

Separation of duties: a supervisor never verifies a facility they record for; LGA stores are
supervised from State level, OTPs from LGA level.

**Repurpose `categories` (shown as "Sector" in UI) as supply-chain *levels*.** Deactivate the TPM
sectors with `is_active = false` (do not delete) and insert:

| name | abbr |
| --- | --- |
| State Store | SST |
| LGA Store | LST |
| OTP Site | OTP |

Finding ID (`LGA3-WARD3-CAT3-YY-INITIALS###`, e.g. `KMC-NAS-OTP-26-NA001`), DRI scoping and every
Sector filter keep working with zero code change. Add `finding_type` on `issues` (§5).

---

## 5. Data model (new migrations, `0100_` onward)

All new tables: `uuid` PK (`gen_random_uuid()`), `created_at/updated_at`, RLS enabled with policies
following the `in_scope(project_id)` pattern plus a facility-scope check for `dri`, `project_id` FK.
Spatial columns in EPSG:4326. Every row recorded from the app carries `recorded_by`, `device_id`
and an idempotent `local_id`.

```sql
-- 0100_rutf_reference.sql
create type facility_type as enum ('state_store','lga_store','health_facility');

create table facilities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  facility_type facility_type not null,
  name text not null,
  national_code text,                     -- registry globalid until a national code exists
  state_id uuid not null references states(id),
  lga_id uuid not null references lgas(id),
  ward_id uuid references wards(id),
  ward_name_source text,                  -- ward as written in the source list
  lat numeric(9,6), lng numeric(9,6),
  geocode_accuracy_m numeric,
  geocode_source text,                    -- 'field_gps' | 'registry' | 'manual'
  is_otp_site boolean not null default false,
  supplied_by_facility_id uuid references facilities(id),  -- OTP -> LGA store -> State store
  is_hard_to_reach boolean not null default false,         -- uses variance_pct_max_remote
  is_active boolean not null default true,
  status dataset_status not null default 'approved'        -- reuse 0015 approval workflow
);
-- trigger: ward/lga/state resolved from lat/lng via resolve_administrative_location();
--          flag (do not block) when the point falls outside the declared LGA.

alter table profiles add column if not exists facility_id uuid references facilities(id);

create table products (id uuid primary key default gen_random_uuid(), name text not null,
  unit text not null default 'sachet', units_per_carton int not null, shelf_life_months int);
create table product_lots (id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id), lot_no text not null, expiry_date date not null,
  unique (product_id, lot_no));

-- Dosing rules are DATA, never code (§12.3).
create table protocol_rules (id uuid primary key default gen_random_uuid(),
  protocol_version text not null, weight_min_kg numeric not null, weight_max_kg numeric not null,
  sachets_per_week numeric not null, effective_from date not null, effective_to date);

create table rutf_thresholds (project_id uuid references projects(id), key text not null,
  value numeric not null, primary key (project_id, key));   -- §12.4
```

```sql
-- 0101_rutf_ledger.sql  — the core of the system
create type txn_type as enum (
  'receipt',        -- stock arrives (from upstream facility or supplier)
  'issue',          -- stock sent to a downstream facility
  'dispensed',      -- OTP: daily total handed to caregivers (generated from otp_daily_dispensing)
  'loss_damaged', 'loss_expired', 'loss_other',
  'adjustment',     -- correction with mandatory reason, needs supervisor confirmation
  'physical_count'  -- month-end (or ad-hoc) count by facility staff; not a movement
);

create table transfers (                  -- one shipment between two facilities
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  code text unique,                       -- e.g. TRF-KMC-26-000123
  from_facility_id uuid not null references facilities(id),
  to_facility_id uuid not null references facilities(id),
  issued_date date not null, received_date date,
  sachets_issued int not null, sachets_received int,
  status text not null default 'in_transit'  -- 'in_transit' | 'received' | 'discrepancy'
);
-- An 'issue' creates the transfer; the receiving facility confirms it with a 'receipt'
-- (pre-filled lots/quantities, editable). Mismatch -> transfer_mismatch Finding.

create table stock_transactions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  facility_id uuid not null references facilities(id),
  txn_type txn_type not null,
  txn_date date not null,
  lot_id uuid references product_lots(id),
  lot_no_seen text, expiry_seen date,     -- as read on the carton, if lot not in list
  quantity_sachets int not null,          -- >= 0, except 'adjustment' which is signed
  check (quantity_sachets >= 0 or txn_type = 'adjustment'),
  counterparty_facility_id uuid references facilities(id),  -- sender for receipt, receiver for issue
  transfer_id uuid references transfers(id),
  document_no text,                       -- waybill / issue voucher / stock card page
  reason text,                            -- required for loss_* and adjustment
  recorded_by uuid not null references profiles(id),
  device_id text, local_id text unique,
  status text not null default 'recorded' -- 'recorded' | 'confirmed' | 'voided' (void = new row, never delete)
);


create table otp_daily_dispensing (       -- AGGREGATE from the OTP register: no child rows, no names
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  facility_id uuid not null references facilities(id),
  dispense_date date not null,
  new_admissions int not null default 0,
  children_seen int not null,
  sachets_prescribed int not null,        -- register tally
  sachets_dispensed int not null,         -- register tally; creates a 'dispensed' ledger row
  recorded_by uuid not null references profiles(id),
  device_id text, local_id text unique,
  unique (facility_id, dispense_date)
);
-- Photos (waybill, stock card page, register page with names covered): reuse the issue_photos
-- pattern in a ledger_photos table, same private bucket rules.
```

```sql
-- 0102_rutf_supervision.sql  — supervisor visits (reuses the visit design of v0.2)
create type visit_type as enum ('store_check','otp_verification');

create table monitoring_visits (
  id uuid primary key default gen_random_uuid(),
  code text unique,                       -- e.g. VIS-KMC-26-000123
  project_id uuid references projects(id),
  visit_type visit_type not null,
  facility_id uuid not null references facilities(id),
  supervisor_id uuid not null references profiles(id),
  visit_date date not null, period_start date, period_end date,
  lat numeric(9,6) not null, lng numeric(9,6) not null, gps_accuracy_m numeric,
  distance_to_facility_m numeric,         -- computed vs facility point
  device_id text not null, local_id text unique,
  status text not null default 'submitted'
);
create table stock_check_lines (          -- supervisor's physical count per lot
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references monitoring_visits(id) on delete cascade,
  lot_id uuid references product_lots(id), lot_no_seen text, expiry_seen date,
  stock_card_balance int,                 -- as written on the card
  system_balance int,                     -- ledger balance at visit time (filled server-side)
  physical_count int not null, damaged_count int default 0, expired_count int default 0
);
create table store_checks (               -- 1:1 with store_check: storage + stock card checklist
  visit_id uuid primary key references monitoring_visits(id) on delete cascade,
  stock_card_present boolean not null, stock_card_up_to_date boolean,
  storage_dry boolean, storage_off_floor boolean, storage_ventilated boolean,
  pests_seen boolean, fefo_followed boolean, notes text
);
create table otp_verifications (          -- 1:1 with otp_verification: recount from the register
  visit_id uuid primary key references monitoring_visits(id) on delete cascade,
  register_present boolean not null,
  admissions_counted int, sachets_dispensed_counted int,   -- supervisor's tally for the period
  admissions_recorded int, sachets_dispensed_recorded int, -- what the app has for the period (server-side)
  notes text
);
```

```sql
-- 0103_rutf_findings.sql
create table finding_types (key text primary key, label text not null,
  default_priority issue_priority not null, level_abbr text);
alter table issues add column if not exists finding_type text references finding_types(key);
alter table issues add column if not exists facility_id uuid references facilities(id);
alter table issues add column if not exists visit_id uuid references monitoring_visits(id);
alter table issues add column if not exists transfer_id uuid references transfers(id);
alter table issues add column if not exists auto_generated boolean not null default false;
alter table issues add column if not exists metric jsonb;   -- e.g. {"variance_pct": 7.4, "threshold": 5}
```

---

## 6. Auto-Finding rules

Two Postgres functions, both idempotent (re-running never duplicates), inserting into `issues`
with `auto_generated = true`, `metric` filled and status `pending_review` (→ State Coordinator):
- `evaluate_facility_period(facility_id, period)` — nightly job and on month-end count.
- `evaluate_visit(visit_id)` — after a supervision visit syncs.

| Finding type | Rule (threshold key in `rutf_thresholds`) | Source | Priority |
| --- | --- | --- | --- |
| `stock_variance` | abs(ledger balance − physical count) ÷ ledger balance > `variance_pct_max` (5; 10 if hard-to-reach) | month-end count or supervisor count | high |
| `transfer_mismatch` | sachets received ≠ sachets issued for a transfer | ledger | high |
| `receipt_not_confirmed` | transfer in transit > `receipt_confirm_days` (default 7) | ledger | medium |
| `stockout` | ledger balance = 0 on any day at an active store/OTP | ledger | critical |
| `expired_stock` | expired lot with balance > 0, or `expired_count` > 0 at a visit | ledger / visit | high |
| `short_dispensing` | Σ prescribed − Σ dispensed > `short_dispense_pct` of prescribed over the period | OTP daily | high |
| `dispensing_gap` | OTP VF = supervisor's register count ÷ app-recorded dispensing outside [`vf_min`, `vf_max`] | visit | high |
| `late_reporting` | active OTP with no daily dispensing for > `reporting_gap_days` (default 7), or no month-end count by day 5 | ledger | medium |
| `unexplained_adjustment` | adjustment > `adjustment_pct_max` (default 2) of balance without supervisor confirmation | ledger | medium |
| `no_stock_card` / `poor_storage` / `register_missing` | checklist answers at a supervision visit | visit | medium / medium / high |

Supervisors and facility users can still raise a manual Finding from the existing New Finding wizard.

---

## 7. Calculations (SQL views in a `rutf_metrics` schema — single definitions for web and exports)

```text
Ledger balance (facility, lot, date) = Σ receipts − Σ issues − Σ dispensed − Σ losses ± adjustments
Stock variance %          = (ledger balance − physical count) ÷ ledger balance × 100
Transfer gap              = sachets_issued − sachets_received (per transfer; in-transit age in days)
Short-dispensing %        = (Σ prescribed − Σ dispensed) ÷ Σ prescribed × 100  (OTP, period)
Verification factor (VF)  = supervisor-counted dispensing ÷ app-recorded dispensing  (OTP, period)
Expected consumption      = children_seen × protocol sachets/week (§12.3)  — plausibility check only
Months of stock           = ledger balance ÷ average monthly (issues + dispensed), last 3 months
Reporting completeness    = days with dispensing recorded ÷ OTP service days; month-end counts on time
Distance flag             = visit distance_to_facility_m > geofence_m (150 m)
Facility risk score (0–100) = weighted: last variance, VF deviation, transfer gaps, stockout days,
                            short-dispensing %, reporting completeness, open critical Findings,
                            days since last supervision visit
```

---

## 8. Android app (reuse `WizardScaffold`, GPS/camera modals, sync queue)

Same compulsory-validation rule as today: Continue/Submit disabled until the step is valid. Every
screen works offline and queues like New Finding (new `SubmissionType` values; idempotent `local_id`).
Home shows actions by role. Daily Attendance stays for supervisors only.

**Facility user (`dri`) — their own facility only**
- **Receive Stock** — pick the in-transit transfer (pre-filled) or record a supplier delivery; lots,
  cartons + loose sachets (app computes sachets), damaged on arrival; photo of waybill. 4 steps.
- **Issue Stock** (stores only) — receiving facility (filtered to those it supplies), lots,
  quantities, voucher no.; creates a transfer. 4 steps.
- **Daily Dispensing** (OTPs) — date, new admissions, children seen, sachets prescribed and
  dispensed from the register tallies. One screen; "same as register page" photo optional
  (names covered checklist).
- **Stock Count** — month-end (or any day) count by lot; shows the expected ledger balance only
  **after** the count is entered, to avoid anchoring. 3 steps.
- **Record Loss / Adjustment** — type, lot, quantity, reason, photo. 3 steps.
- **My Stock** — current balance by lot, expiry warnings, transfers in transit, open Findings.

**Supervisor (`tpm_supervisor`)**
- **A. Store Check** (LGA/State store) — facility, GPS (geofence warning), stock card checklist,
  count by lot, storage checklist, evidence (stock card, stack, selfie), review showing the
  Findings this visit will raise. 7 steps.
- **B. OTP Verification** — facility + period, GPS, register present?, recount admissions and
  sachets dispensed for the period, count by lot, evidence (register page names covered, stock,
  selfie), review. 7 steps.
- **Confirm adjustments** queued by facilities in their area.

Reference data to sync down (extend `ReferenceRepository` / `ReferenceDao`): facilities (all in
scope + own facility), products, lots, protocol rules, finding types, thresholds, open transfers
for the user's facility. Bundle the boundary SQLite as an asset.

---

## 9. Web platform — screens

**Adapt:** Dashboard (RUTF KPIs), Findings list/detail (linked transaction / transfer / visit +
metric), GIS map, Analytics, Data Sets (→ Facilities, Lots, Protocol rules, Thresholds, Users →
facility assignment, with the existing Super Admin approval flow), Reporting / post-implementation
report, Coverage analysis.

**New:**
- **Stock Ledger** — per facility and lot: transactions, running balance, documents, photos.
- **Transfers** — in transit, received, discrepancies; State → LGA → OTP flow per period.
- **Reporting Completeness** — which OTPs/stores have recorded dispensing and month-end counts.
- **Stock Integrity** — variance by facility and lot; trend; expiry watchlist; months of stock.
- **OTP Dispensing** — dispensed vs prescribed (short-dispensing), VF from supervision, children
  seen vs expected consumption.
- **Supervision** — visits list/detail, evidence, Findings raised; **Supervision Planner** (risk
  ranking + suggested next facilities per supervisor, export to their task list).
- **DHIS2 Triangulation** — CSV import of monthly DHIS2 figures vs the ledger (§12.8).

**Map layers:** facilities by type (coloured by risk score or months of stock), stock-outs,
transfers as State → LGA → OTP links (in transit / discrepancy), supervision visits (geofence flag),
open Findings by priority, LGA choropleth of variance / reporting completeness.

**Headline KPIs:** stock on hand (State / LGA / OTP) and months of stock · stockout rate · mean stock
variance % · transfers in transit and with discrepancy · short-dispensing % · OTP VF (median, %
outside range) · reporting completeness · expired / lost sachets · supervision visits done vs
planned · open critical Findings · median days to close.

---

## 10. Privacy, safeguarding and governance (non-negotiable)

- **No child-level data**: no child or caregiver names, phone numbers, IDs or per-child rows.
  OTP data is daily aggregate tallies only.
- Photos: stock cards and waybills allowed; register pages only with names covered (§12.5);
  never photograph children or caregivers. Camera-only capture into the private bucket.
- Role-based access per facility and level (§4); every create/edit/void recorded in the audit
  trail; transactions are never deleted, only voided by a new row with a reason.
- Aggregated public displays suppress cells < 5 where counts relate to children. Exports go through
  the existing download-request approval.
- Findings are **for review, not accusation** — neutral wording in UI and notifications.
- **DPIA (NDPA 2023) required before go-live**, based on the data actually processed: register
  fields captured, identifiability, who can access, storage and security, access control,
  retention, backup, breach handling, aggregate vs identifiable reporting. [VALIDATE with DPO]

---

## 11. Build order and acceptance criteria

| Milestone | Scope | Done when |
| --- | --- | --- |
| M0 Fork | §2 setup, renames, Supabase project, migrations 0001–0042 applied, boundaries imported | Web and Android log in against the RUTF project; existing flows pass `TEST_MATRIX.md` |
| M1 Reference data & users | 0100 migration, Facilities/Lots/Protocol/Thresholds in Data Sets with CSV upload, levels swapped, users ↔ facility assignment | Katsina facilities + dummy stores/OTPs loaded and inside their LGA; a facility user sees only their facility offline |
| M2 Ledger & facility recording | 0101, Receive / Issue / Daily Dispensing / Stock Count / Loss screens, sync, Stock Ledger + Transfers pages | State → LGA → OTP transfer and a week of dispensing reconcile to the right balance; offline entries sync once, no duplicates after 3 forced retries |
| M3 Auto-Findings | 0103, `evaluate_facility_period()`, thresholds | Seeded 7% month-end variance raises exactly one `stock_variance` Finding into review; a short receipt raises one `transfer_mismatch` |
| M4 Supervision | 0102, wizards A and B, `evaluate_visit()`, adjustment confirmation | Both visit types end-to-end on a physical device; VF Finding raised from seeded data |
| M5 Dashboards & map | §9 screens, metrics views, risk score, Supervision Planner, DHIS2 CSV import | KPIs match hand-calculated values on seed data |
| M6 Pilot hardening | Permissions review, DPIA actions, training material for facility users and supervisors, sync-failure monitoring | UAT signed by programme lead |

Write SQL tests for every new RPC and RLS policy (extend `test-mobile-role-access.js`), and Room
migration tests for every Android schema change (extend `MigrationTest.kt`).

---

## 12. Answers to open questions (Najib, 2 Oct 2026)

Values below are **seed defaults**. They still live only in reference tables / `rutf_thresholds` /
`settings` so the programme can change them without a code change. Where an answer is a general
EUM/CMAM standard rather than a Katsina- or UNICEF-signed figure, it is marked *(confirm with programme)*.

**12.1 Pilot scope and ownership — settled**
- Pilot: **Katsina State, all LGAs, wards and health facilities.** The boundary files already
  cover it: `state.sqlite` (code `KT`), 34 LGAs in `LGA.sqlite`, 361 wards in `Ward.sqlite`.
- Data owner: **UNICEF** (work proposed for UNICEF). The Supabase project is owned on that basis.
- Supabase project URL: `https://yghlvzfzohlctigchehq.supabase.co` (URL only; keys go in
  untracked `.env.local` / `local.properties`, never in this file or git).

**12.2 Product — settled**
- RUTF paste, **92 g sachet**, ≈500 kcal per sachet (520–550 kcal/100 g; protein 13–17 g/100 g;
  lipid 26–37 g/100 g; moisture ≤ 2.5 %, water activity ≤ 0.6, aflatoxin ≤ 10 µg/kg).
- **150 sachets per carton.** Shelf life **24 months** below 30 °C.
- Quality limits are reference text only; they cannot be tested at the facility.

**12.3 Dosing table (seed `protocol_rules`, version `CMAM-175kcal-generic`)** *(confirm with
programme: must be signed off by Katsina State nutrition unit against the Nigeria CMAM guideline)*

| Weight (kg) | Sachets/day | Sachets/week |
| --- | --- | --- |
| 3.5 – 3.9 | 1.5 | 10 |
| 4.0 – 4.4 | 1.5 | 11 |
| 4.5 – 4.9 | 1.75 | 12 |
| 5.0 – 5.9 | 2.0 | 14 |
| 6.0 – 6.9 | 2.5 | 17 |
| 7.0 – 7.9 | 3.0 | 20 |
| 8.0 – 8.9 | 3.25 | 23 |
| 9.0 – 9.9 | 3.75 | 26 |
| 10.0 – 11.9 | 4.0 | 28 |
| ≥ 12.0 | 5.0 | 35 |

**12.4 Thresholds (seed `rutf_thresholds`)** *(confirm with programme)*

| key | value | note |
| --- | --- | --- |
| `variance_pct_max` | 5 | ± stock card vs physical |
| `variance_pct_max_remote` | 10 | facilities flagged hard-to-reach (new `facilities.is_hard_to_reach boolean default false`) |
| `vf_min` / `vf_max` | 0.90 / 1.10 | < 0.90 suggests over-reporting; > 1.10 under-reporting or a parallel supply |
| `geofence_m` | 150 | smartphone GPS (30–50 m only with dedicated GPS units) |
| `short_dispense_pct` | 5 | 0 % tolerance in principle; flag above 5 % cumulative deficit |

Note: the answer also describes VF as "recounted ÷ reported". This brief keeps two distinct metrics:
**stock variance** (physical vs stock card, §7) and **OTP VF** (sachets dispensed per register ÷
sachets expected from caseload and dosing). Both use the thresholds above.

**12.5 Photos — settled**
- Stock cards: allowed. Capture guidance in the wizard: headers, dates, voucher numbers and
  signatures legible.
- OTP registers: allowed **with child and caregiver names covered**. Keep visible: admission date,
  age, sex, weight/height/MUAC, sachets prescribed vs dispensed, and admission numbers only if not
  re-identifiable outside the clinic. On-screen checklist before the shutter.
- Safeguards: photos are taken only in-app by authorised facility users and supervisors
  (camera-only, never the gallery) and go to the private bucket; this matches the existing TPM
  capture design. No separate monitor mandate (item 5 below).

**12.6 DRIs and users — settled (structure, revised v0.3); names still needed**

| Level | Facility user / DRI (`dri`, one facility) | Supervisor (`tpm_supervisor`) |
| --- | --- | --- |
| State store | State store officer / SMoH supply-chain specialist | State nutrition or SMoH M&E officer |
| LGA store | LGA store officer / pharmacist | State nutrition or SMoH M&E officer |
| OTP / health facility | Facility in-charge or nutrition focal person | LGA Nutrition Officer (DNO) |
| Implementing partner | Nutrition programme manager → `project_admin` | — |

**12.7 Who reviews Findings — settled (structure)**
- In-app reviewer (`state_coordinator`, approves Findings before they reach DRIs): Katsina State
  Nutrition Officer's office jointly with a UNICEF nutrition/supply officer.
- Off-app: Findings and dashboards feed the monthly/quarterly Nutrition Coordination Working
  Group, UNICEF supply/nutrition review, and Federal MoH oversight. The platform supports this with
  the existing post-implementation report and approved exports; no new workflow states.

**12.8 DHIS2 — partly settled**
- DHIS2 carries aggregate monthly RUTF data (received, distributed, wasted, balance, stock-out
  days) and admissions. Treat it as an **optional triangulation source**: M5 adds a CSV import
  of DHIS2 extracts into a `dhis2_reports` table; no live API integration in this phase.

**12.9 Supervision cadence and workload (seed `settings`)** *(confirm with programme)*
- Routine supervision: each facility **once per quarter**.
- High-risk (VF outside range, variance above threshold, stockouts, late reporting): **monthly**
  until metrics stabilise. The Supervision Planner applies this from the risk score.
- Workload: **5–10 facilities per supervisor per month** (default 8), one facility per day.
- Facility recording: dispensing **daily** (or per OTP session day); stock count **monthly**,
  by day 5 of the next month.

### Still open

**Dummy data in use (Najib, 2 Oct):** for the proposal, items 1–4 below are filled with generated
dummy data in `data/dummy/` (see its README; regenerate with `python tools/dummy-data/generate.py`;
`python tools/dummy-data/check.py` prints the Findings the §6 rules should raise on it).
Every dummy row is tagged `DUMMY` and is replaced with programme data during implementation.

1. **Which facilities are OTP sites, and the store list.** Received 2 Oct:
   `data/reference/katsina_health_facilities.csv` — 2,420 Katsina health facilities, all with
   coordinates, 35 LGA names / 401 ward names, `globalid` unique (use as `national_code` until a
   registry code exists). It does **not** say which facilities run OTP/CMAM, and contains no State
   or LGA stores. Import plan (M1): load all rows as the facility registry with a new
   `facility_type` value `health_facility` plus `is_otp_site boolean default false`; flip the flag
   from the programme's OTP site list. State/LGA stores to be added from a separate list (or
   field-geocoded on first visit). Cleaning at import: LGA "Danmusa" → boundary "Dan Musa";
   67 rows (44 ward names) don't match boundary ward names, so ward is resolved from coordinates
   by `resolve_administrative_location()` and the CSV ward kept as `ward_name_source`;
   152 rows have blank `functional_status`/`type`; 1 duplicate name+ward and 1 duplicate point to
   review.
2. **Named reviewers and DRIs** (people + emails) for the State, the 34 LGAs and the OTPs. Needed
   before M3 Findings route to anyone.
3. **Programme sign-off** on the dosing table, thresholds and visit cadence above (Katsina SMoH
   nutrition unit / UNICEF). The build proceeds on the defaults meanwhile.
4. **DHIS2 access** for Katsina: an extract or read access, and the data element names used.
5. ~~Signed mandate / ToR for field monitors~~ **Not applicable** (Najib, 2 Oct): data is recorded
   by authorised government health-facility and programme staff, not external field monitors.
   Governance is role-based access, defined responsibilities, supervisory oversight and the audit
   trail. **DPIA under NDPA 2023 is still required**, scoped to the data the system actually
   processes (register fields captured, identifiability, access, storage, retention, backup,
   breach handling, aggregate vs identifiable reporting).
6. **Supabase keys — available.** Publishable key received; it goes only in untracked
   `web/.env.local` / `local.properties`. Applying migrations also needs the database password or
   a secret key, shared out of band and never committed.
7. ~~Scope shift to confirm~~ **Settled 2 Oct:** facility recording + supervisor checks
   (Najib chose the recommended option). §1–§11 rewritten in v0.3.

---

## 13. Kick-off prompt (paste into Claude Code from this folder)

```text
Read RUTF_BUILD_BRIEF.md in full — it is the spec of record. Then read
../TPM Monitoring Platform Design/README.md, DECISIONS.md and TEST_MATRIX.md, and
../TPM Process Monitoring App/android/README.md, to understand the code being reused.

Work milestone by milestone (section 11), starting with M0 only. Reuse before you build: every new
feature must use the existing wizard framework, sync queue, evidence capture, Finding workflow,
RLS/RPC patterns, boundaries and GIS map. Never copy or print secrets (.env.local,
local.properties). Put every value marked [VALIDATE] in reference tables or settings, never in code.
Record each judgement call in DECISIONS.md and each new test in TEST_MATRIX.md. Ask me before
guessing anything ambiguous. Stop at the end of each milestone, summarise what changed, and wait
for my go-ahead.
```
