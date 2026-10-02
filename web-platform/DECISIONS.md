# Implementation decisions & assumptions

The handoff package (`design_handoff_tpm_monitoring_platform/`) is high-fidelity
on UI but leaves a few backend specifics implicit. This file records every
place a judgment call was made, so it can be revisited deliberately rather
than discovered by accident later.

## 1. Role model: 3-tier README vs. 5-role prototype

README's RBAC table defines permissions for exactly three tiers: **Super
Admin / Project Admin / Viewer**. But `mock-data.js` (`USERS`) and the
prototype's own workflow (`TPM Sub-Panel` view, DRI-response gating) use a
richer 5-role set: Admin, TPM Supervisor, DRI, Viewer — plus the login
screen's own "Project Admin" preview role.

**Decision:** `profiles.role` is a 5-value enum — `super_admin`,
`project_admin`, `tpm_supervisor`, `dri`, `viewer` — matching README's own
Data Model section ("role (`super_admin` | `project_admin` | `viewer` |
`tpm_supervisor` | `dri`)"), which already lists all five. The 3-tier table
governs Super Admin / Project Admin / Viewer exactly as written. Permissions
for `tpm_supervisor` and `dri` were inferred from the prototype's actual
workflow logic:

- **TPM Supervisor**: can report issues, assign a DRI, verify & close
  (the field-monitoring role driving the workflow) — no Users/Settings/Project
  Admin Panel access. Sees the **TPM Sub-Panel** nav item.
- **DRI**: can only act on issues where `assigned_dri = self` — submit a
  response, record corrective action. Cannot assign, verify, or manage users.

The prototype itself is looser than this (`!isViewer` gates all four workflow
buttons for *any* non-Viewer role) — this implementation tightens that at the
RLS layer specifically for DRI (self-assigned-only) since the instructions
call for "smallest reasonable change" toward a real security boundary, not a
literal port of a prototype simplification. See [`0009_rls_issues.sql`](supabase/migrations/0009_rls_issues.sql).

## 2. A `projects` table, separate from Project Admin accounts

`profiles.project_id` is described as "nullable, for Project Admin scoping,"
implying a `projects` entity distinct from the admin *account* itself.
Issues also need project scoping (README: dashboards/issues are visible to
Project Admin "own project scope"), so `issues.project_id` was added — not
present in `mock-data.js`, but required for the scoping rule to be
enforceable at all.

**Decision:** `projects(id, name)` is its own table. Creating a Project Admin
(Project Admin Panel screen) also creates/assigns a project. A profile with
`project_id IS NULL` is treated as **global scope** (sees everything except
Super-Admin-only screens) — this covers an HQ-level Viewer or TPM Supervisor
who isn't tied to one project.

## 3. Workflow mutations go through Postgres RPCs, not raw table UPDATEs

The prototype's `confirmModal()` does five different things client-side
(set status, set a field, and append a history entry) as separate, trusted
operations. Since "the database/RLS layer must be the final security
boundary" (README) and history must be tamper-proof, each workflow
transition (`assign_issue`, `submit_dri_response`,
`record_corrective_action`, `verify_and_close_issue`, `edit_issue_submission`,
`delete_issue_submission`) is a `SECURITY INVOKER` Postgres function: it
still runs as the calling user and is still fully subject to RLS, but
guarantees the issue mutation and its audit-trail row commit atomically and
enforces action-specific rules (e.g. only the assigned DRI may respond) that
a column-level RLS policy alone can't express cleanly.

## 4. User creation/removal is server-side only, via the service-role key

Supabase RLS can't grant an `authenticated` client permission to create
`auth.users` rows or reset another user's password — that's Admin API
territory. "Add User," "Create Project Admin," and "Reset Password" are
Next.js Server Actions that first verify the caller's role with a normal
(RLS-respecting) client, then use `createAdminClient()`
(`src/lib/supabase/admin.ts`, `SUPABASE_SERVICE_ROLE_KEY`, server-only) to
call the Admin API. The key never reaches the browser.

## 5. Issue IDs

The prototype's `ISS-1000` style ID is reproduced via a generated column
(`'ISS-' || (1000 + issue_number))`, `issue_number` backed by a `bigserial` —
stable once assigned, human-readable, and still backed by a real `uuid`
primary key for foreign keys.

## 6a. Data Sets (Settlements / Activity Sites) — added post-launch by request

Not part of the original design handoff — added on explicit request. Key
choices:

- **Plain text columns, not FKs.** `statename`/`lganame`/`settlementname`
  (and `activitysitename`) are literal text per the request, not foreign
  keys into `states`/`lgas`. This matches how the field mobile app consumes
  flat pick-lists, and mirrors the app's own boundary source files
  (`LGA.sqlite`/`Ward.sqlite` already carry state/LGA as denormalized text,
  not relational IDs). The Add/Edit UI still uses dropdowns sourced from the
  real `states`/`lgas` tables to prevent typos — only the stored value is
  plain text.
- **Approval workflow via a `status` column + `pending_data` jsonb, not a
  separate change-request table.** A single `enforce_dataset_workflow()`
  trigger (shared by both tables — it operates on `to_jsonb(NEW/OLD)`
  generically, not specific column names) intercepts INSERT/UPDATE/DELETE:
  Super Admin's writes apply immediately and are auto-approved; a Project
  Admin's edit to an *approved* row is redirected into `pending_data` (the
  live row is untouched until approved) and a delete is redirected into a
  `pending_delete` status flag (the actual `DELETE` is cancelled via the
  trigger returning `NULL`). `approve_*`/`reject_*` RPCs, Super-Admin-only,
  apply or discard the pending change.
- **"Exposed via API for the mobile app"** needs no extra work beyond RLS:
  Supabase's auto-generated REST API already serves
  `GET /rest/v1/settlements?status=eq.approved` to any authenticated field
  user's JWT — verified directly (see the DRI-role REST check run during
  testing). No separate sync endpoint was built.

## 6. Notifications are real rows, not a mock array

The prototype's bell dropdown reads a static `notifications` array. This
implementation backs it with a `notifications` table, populated by the
workflow RPCs (e.g. assigning a DRI notifies that DRI), and subscribed to
via Realtime — this was the one addition beyond a literal 1:1 port, because
"replace mock/static data with live Supabase queries" applies to it exactly
as much as to `issues`.

## 7. Field mobile app integration (Android) — migration 0016

The Android app ("TPM Process Monitoring App") was built independently from
a separate design handoff (`../TPM Process Monitoring App/design_handoff_android/`)
predating its connection to this backend, with its own Field Monitor/DRI
2-role workflow. Wiring it to this schema surfaced several real mismatches,
resolved as follows (all in `supabase/migrations/0016_mobile_app_integration.sql`):

- **Roles**: the mobile app's "Field Monitor" maps to `tpm_supervisor` (per
  #1 above, already the role that reports issues and verifies/closes) and
  "DRI" maps directly to `dri`. The Android login screen rejects
  `super_admin`/`project_admin`/`viewer` sign-ins with an explanatory
  message — there's no mobile UI for those roles. **Superseded in part by #31** —
  Super Admin, Project Admin, and State Coordinator can now sign in; `viewer` still can't.
- **Assignment**: the web workflow requires a TPM Supervisor to
  `assign_issue()` before a DRI can act. The mobile spec has no such step —
  a DRI browses unassigned (`status = 'new'`) issues and picks one up
  themselves. Rather than force an admin step onto the field workflow, added
  `dri_self_assign(issue_id)` (SECURITY INVOKER, same pattern as the other
  workflow RPCs) plus one additional `issues_update` RLS clause letting a
  DRI claim a `new`/unassigned row — every other clause on that policy is
  unchanged.
- **Reopen**: `verify_and_close_issue` only closes; the mobile spec's Final
  Verification screen has a required "No, not resolved" path that reopens
  the issue and routes it back to the same DRI. Added an explicit
  `'reopened'` value to `issue_status` (rather than overloading `'assigned'`
  or `'in_progress'`) and a `reject_and_reopen_issue(issue_id, comment)` RPC
  mirroring `verify_and_close_issue`'s shape. A reopened issue re-enters the
  DRI's queue through the *existing* `submit_dri_response`/
  `record_corrective_action` RPCs unchanged — neither one gates on the
  issue's current status beyond `assigned_dri = auth.uid()`.
- **Severity → priority**: the mobile app's 3-level High/Medium/Low (which
  also drives a client-side SLA countdown — 2/5/14 days — that exists only
  in the Android app, not in this schema) maps onto 3 of `issue_priority`'s
  4 values (`high`/`medium`/`low`). `critical` is intentionally not
  reachable from the mobile app — it stays a web/admin-only escalation via
  `edit_issue_submission`, matching the original mobile design's 3-level
  severity control exactly rather than adding a 4th option that spec never had.
- **Per-stage GPS**: the mobile app captures GPS separately at issue
  discovery, DRI action, and verification — `issues.lat/lng` only ever held
  one point. Added `issue_gps_captures(issue_id, stage, lat, lng,
  accuracy_m)`, one row per (issue, stage), rather than three more nullable
  column-pairs on `issues` — matches this schema's existing preference for a
  child table over widening a core table (`issue_history`, `issue_photos`).
- **Settlement / Activity Site**: added as denormalized text columns
  directly on `issues` (`settlement`, `activity_site`), same treatment as
  the existing `ward` column — populated from the `settlements`/
  `activity_sites` tables added in #6a, which already exist for exactly
  this purpose.
- **Two issue-ID schemes, on purpose**: the mobile app is offline-first and
  shows a Field Monitor their issue's ID (`LAG-HLT-2026-000052` style)
  immediately on submission, before the row can possibly exist server-side.
  Rather than force it to wait for `code` (`ISS-1042`, server-generated on
  insert), `issues.mobile_code` stores the client-generated ID as its own
  real, permanent column — both IDs are valid and both are shown, in
  different places (`code` is what the web app displays; `mobile_code` is
  what the Field Monitor who filed the report sees).
- **Evidence photos need two more dimensions**: the mobile app captures
  exactly an MOV photo and a selfie at up to three lifecycle stages (up to
  6 photos, each with clear semantics), where `issue_photos` previously had
  neither concept — added `kind` (`mov`/`selfie`) and `stage` (reusing the
  new `capture_stage` enum), both nullable so existing/future
  web-uploaded photos aren't required to set them.
- **Note, not fixed here**: `issue_gps_captures_insert` and the pre-existing
  `issue_history_insert`/`issue_photos_insert` policies check only that the
  referenced issue exists, not `in_scope(issue.project_id)` — a caller who
  already knows/guesses another project's issue UUID could theoretically
  insert a child row for it. Matched the existing pattern for consistency
  rather than unilaterally tightening only the new table; worth a follow-up
  pass across all three if project-scoped write isolation matters here.

## 8. Administrative hierarchy: Settlement/Activity Site as independent Ward siblings — migration 0019

By explicit request. Prior state (#6a): `settlements`/`activity_sites` were
flat, scoped only to `statename`/`lganame` text, with no Ward link at all —
fine for a simple admin pick-list, but not enough for the Android app's
cascading State→LGA→Ward→Settlement/Activity-Site dropdowns, which need
real filtering at every level.

- **Both get a real `ward_id` FK**, added as `not null` directly (both
  tables were empty in production at the time — no backfill needed).
- **Independent siblings, not a chain**: Activity Site does **not**
  reference Settlement. The original request's example schema showed
  `activity_sites.settlement_id`, but the user explicitly asked for them
  to be independent — both hang directly off Ward instead. Simpler, and
  matches how the two are actually used in the field (a settlement and an
  activity site are each just "a place in this ward," not naturally
  parent/child).
- **`statename`/`lganame` become derived, not client-supplied**: a
  `derive_dataset_location_names()` trigger looks up `ward_id` →
  `lga_id` → `state_id` and overwrites whatever the client sent for those
  two columns. This makes an inconsistent State/LGA/Ward/Settlement
  combination *structurally impossible* rather than merely validated —
  satisfies the "reject invalid hierarchical relationships" requirement
  with less code than manual validation, and means the web Data Sets
  screen/CSV upload only ever need to resolve a `ward_id`, not separately
  validate three text fields against it.
- **PK stays UUID `id`, not `wardcode`**: considered switching `wards`'
  primary key to the natural `code` (verified empirically unique across
  all 9,403 rows — no nulls, no duplicates). Decided against it — a
  `UNIQUE, NOT NULL` constraint on `code` (already in place) gives the same
  stability guarantee (survives renames, never reused) without the
  structural risk of changing a PK type that `issues.ward_id` and the
  Android app already reference. Surrogate key for joins, natural key for
  human/business identification — standard pattern, less risk, same
  outcome.
- **`issues` gains `settlement_id`/`activity_site_id`** (uuid, nullable, FK
  into the now-real tables) alongside the existing `settlement`/
  `activity_site` text columns from #6a — satisfies the "store stable IDs,
  not just names, on historical submissions" requirement. Text columns
  stay for display; IDs are authoritative.
- **Android**: `SettlementRefEntity`/`ActivitySiteRefEntity` switched from a
  composite `(stateName, lgaName, name)` text primary key to the real
  Supabase row `id`, keyed/queried by `wardId`. `ReferenceRepository`'s
  `ensureSettlementsLoaded`/`ensureActivitySitesLoaded` moved from firing on
  LGA-change (filtering only by state+LGA name, not actually re-filtering
  by Ward) to firing on Ward-change, which was the actual root cause of the
  "dropdowns don't really cascade" bug — enablement already cascaded
  correctly, only the option *filtering* didn't reach past LGA. Room DB
  version bumped 2→3 (`fallbackToDestructiveMigration()`, pre-launch, no
  installed base to preserve — confirmed before making the change).

## 9. Merged Settlement/Activity Site picker + manual "Other" fallback — migration 0020

Field request: a single combined picker for Settlement + Activity Site in
the Register New Issue wizard, with a manual-entry fallback for a place
that isn't in the preloaded reference list yet.

- **Data model stays split, only the picker UI merges.** `settlements`/
  `activity_sites` remain distinct tables and `issues.settlement_id`/
  `activity_site_id` remain two separate FKs (see #8) — deliberately not
  collapsed into one table/one FK. TPM reporting distinguishes "issue at a
  settlement" from "issue at an activity site"; merging the underlying
  model would lose that for a UX convenience obtainable without touching
  the schema. `NewIssueWizardScreen`'s `LocationStep` instead builds one
  `List<LocationOption>` (`Settlement`/`Site`/`Other`) from the same two
  Ward-scoped reference queries and renders it as a single `TpmDropdown`;
  whichever variant is picked determines which FK the submitted issue
  actually carries.
- **A location is now exactly one of Settlement, Activity Site, or
  Other** — not "both required," which was the prior (accidental)
  behavior (`isCurrentStepValid` required `selectedSettlement != null &&
  selectedSite != null`). A Ward with only settlements, or only activity
  sites, or neither yet catalogued, is no longer a dead end.
- **`issues.location_other` (new nullable text column)** holds the
  manually-typed name when `Other` is chosen; `settlement_id`/
  `activity_site_id` stay null in that case. Deliberately a new column
  rather than reusing the existing `settlement`/`activity_site` text
  columns — those mean "resolved to a real reference row," so writing an
  unclassified manual entry into either would misrepresent it as
  matched/authoritative.
- **Manual entries are display-only, not auto-submitted as pending
  dataset rows.** The existing Settlements/Activity Sites approval
  workflow (`pending_create` → admin review, see #6a) already covers
  formally adding a new place; wiring the mobile "Other" fallback to
  auto-create a `pending_create` row was considered and deferred —
  offline dedupe (two enumerators typing the same new name), no GPS/
  geometry captured at creation time, and a new WorkManager sync-queue
  item type are meaningfully more work for a fallback path whose actual
  usage frequency isn't known yet. An admin sees `location_other` on the
  issue (web Issue Detail now surfaces Settlement/Activity Site/Other
  alongside State/LGA/Ward) and can decide whether to add it via Data
  Sets. Revisit as a v2 if "Other" turns out to be heavily used.
- Android: `LocationOption` sealed class (`Settlement`/`Site`/`Other`)
  replaces the two separate `selectedSettlement`/`selectedSite` view-model
  fields. `AppRepository.submitNewIssue`'s `settlementId`/`settlement`/
  `siteId`/`site` params became nullable (previously always non-null,
  always both supplied). Room DB version bumped 5→6
  (`fallbackToDestructiveMigration()`, pre-launch).

## 10. Settlements/Activity Sites bundled offline (Settlement.sqlite/ActivitySite.sqlite)

Field audit found a real offline gap: States/LGAs/Wards all ship as bundled
SQLite assets (`state.sqlite`/`LGA.sqlite`/`Ward.sqlite`, ~43MB, geometry
included) and work from a fresh install with zero network calls — but
Settlements/Activity Sites had no such asset. They were only ever fetched
from Supabase the first time a Field Monitor opened a given Ward, and the
lookup itself required network just to resolve the Ward's real UUID from
its locally-known wardcode. Net effect: opening a Ward for the first time
while genuinely offline silently showed an empty picker — indistinguishable
from "this Ward really has none" — even though the data existed.

- **Bundled as assets, not left as pure on-demand fetch.** Considered the
  lighter fix (connectivity check + honest "not downloaded yet" messaging)
  but the user explicitly wanted full offline coverage for real field use,
  not just a clearer error. `tools/db/export-locations-for-offline.js` +
  a Python script build `Settlement.sqlite` (354,148 rows, 14.9MB) and
  `ActivitySite.sqlite` (32,201 rows, 1.7MB) from the live `settlements`/
  `activity_sites` tables joined to `wards.code` — no geometry, so far
  smaller per row than Ward.sqlite despite ~4x the row count. ~60.8MB
  total assets now, up from ~43MB.
- **Local IDs are deliberately not real UUIDs.** There isn't one available
  offline. `ReferenceRepository` seeds them as `"offline:<wardcode>:<name>"`
  — just needs to fail `SupabaseSyncApiService.isUuid()` so that at sync
  time, `resolveSettlementId`/`resolveSiteId`'s existing by-name+ward_id
  fallback (already built for the CSV-upload/wardname-text path) resolves
  the authoritative Supabase row. No new resolution logic needed.
  Prefixed with wardcode since settlement/site names repeat across wards
  (common Nigerian place names) but this is the Room primary key.
  `ensureSettlementsLoaded`/`ensureActivitySitesLoaded` try the asset
  first, falling back to the existing online lookup (by ward UUID, then by
  state+LGA name) for anything added to Supabase after the asset was last
  generated — best of both: instant offline availability, online top-up
  for genuinely new data.
- **Regeneration is manual, not automatic.** These assets are a snapshot
  as of generation time — re-running the export+build scripts and
  re-committing the two files is required after any meaningful
  settlements/activity_sites data change (e.g. another CSV import).
  Considered auto-syncing them from the device instead (download-on-
  demand into local storage rather than bundling in the APK) but bundling
  keeps zero-network-ever-required for a fresh install, which is the
  stronger guarantee for field use; a background "assets may be stale,
  refresh when online" reconciliation pass is a reasonable v2 if this
  becomes a real staleness problem in practice.

## 11. Structured Issue ID (LGA3-WARD3-CAT3-YY-INITIALS###) — migration 0026

`issues.code` (the `ISS-1042`-style ID from decision #5) was a `generated always as` column,
which can only reference other columns on the *same row*. The requested new format —
`KMC-NAS-ROA-26-NI001`, derived from the LGA/ward/category names, the reporter's initials, and
an atomically-incrementing per-combination sequence — needs table lookups and a mutable counter,
neither of which a generated column can do. So `code` became an ordinary `text` column, set by
a new `before insert on issues` trigger instead.

- **Existing rows are untouched, on purpose.** `ALTER COLUMN code DROP EXPRESSION` converts the
  column without recomputing anything — every pre-migration issue keeps its original `ISS-NNNN`
  value forever. Only issues created after this migration get the new format.
- **`abbr` columns added to `categories`/`lgas`/`wards`, not a reuse of `lgas.code`/
  `wards.code`.** Those already exist but are the *source dataset's* own codes (e.g.
  `states.code = 'LA'`, 2 letters) — not reliable 3-letter abbreviations, and already serve as
  import join keys. `categories` had no code column at all. New, dedicated `abbr text` columns
  keep the two concerns separate.
- **Category codes (10 rows) are hand-curated in the migration; LGA/ward codes (774 + ~9,400
  rows) are algorithmically derived**, per an explicit choice to ship working for the whole
  country immediately rather than block on hand-curating thousands of rows. The algorithm
  (`generate_abbr_candidates()`) tries the name's first 3 letters, then `first-2 + scanning
  letter`, then a guaranteed-unique `first-letter + AA..ZZ` fallback — valid and unique, but
  won't always land on a "natural" abbreviation a human would pick (may not be exactly `KMC`
  for Kano Municipal). They're plain editable columns — correct any specific one with an
  `UPDATE` any time; only future issues for that LGA/ward pick up the correction, matching the
  immutability requirement below.
- **Ward `abbr` is unique per LGA, not globally.** The ID format's `LGA3` segment already
  disambiguates, so two different LGAs may safely reuse the same ward abbreviation (e.g. both
  having a "Central" ward → `CEN`) — this cuts collision pressure dramatically at ~9,400 rows.
- **`profiles.initials`** (new column) is auto-derived from `name` (first letter of the first
  token + first letter of the last token) only when null, so a manual correction is never
  clobbered by a later name edit.
- **Counter is scoped by literal `initials` text, not by user ID**, exactly as specified: two
  different people who happen to share initials share a counter bucket and their sequence
  numbers interleave; a different prefix or different initials always starts its own `001`.
  This is a deliberate characteristic of the requested design, not an oversight.
- **`INSERT ... ON CONFLICT (prefix, year, initials) DO UPDATE SET last_number = last_number + 1
  RETURNING last_number`** is the atomic-increment mechanism — explicitly not `SELECT MAX()+1`,
  which race-conditions under concurrent inserts from multiple devices/users.
- **`issues_set_code` (before insert) unconditionally overwrites `code`**, ignoring any
  client-supplied value — no current caller (web's report-issue action, Android sync, the demo
  seed script) ever sends `code`, so this is a no-op in practice and closes what would otherwise
  be a "trust the client" gap. **`issues_protect_code` (before update)** unconditionally resets
  `code` back to its old value, so it can never change after creation regardless of role.
- **No web or Android application code changed.** Audited both: search is a plain `ilike`
  substring match against `code`, sorting is always by `reported_at`, CSV export writes `code`
  as an opaque string, and the Android app never even renders `code`/`remoteCode` in its UI
  (only its own separate `mobile_code`, decision #7's offline placeholder — untouched, unrelated).
  The new format just shows up everywhere `code` was already displayed.

## 12. Mock-data page convention — Implementation Monitoring / Coverage Analysis / Post
Implementation Report

The remaining items from the original design brief are net-new pages with no backend yet.
Building them as real features (new tables, RLS, RPCs) wasn't requested — the brief explicitly
asked for "UI shells with clearly-labeled mock data" so the nav/IA reads as finished while the
real data model for each feature is worked out separately, later. This is the first batch of
those pages (three more — Team Performance, Teams, Devices/IMEI, Reporting/Export Centre,
generic bulk import — are deferred to their own follow-up batches).

- **Mock datasets live in `web/src/lib/mock/`, one file per page.** Every file opens with a
  comment stating it's mock data, that it replaces to a real Supabase query when the feature
  ships, and pointing back here. Where a dataset mixes something real (e.g. Nigerian state
  names, or the 37/774/~9,411 state/LGA/ward totals already shown elsewhere in the app) with
  something invented (counts, percentages, report entries), the file comment says so explicitly
  — the goal is that nobody mistakes an invented number for a live one.
- **Every mock page shows a `.tag.tag-outline` "Preview · Sample Data" badge** next to its
  header subtitle — a code comment alone isn't enough; this needs to be visible to anyone using
  the app, not just someone reading the source.
- **These are read-only previews, not functional-looking CRUD.** No "Add"/"Edit" button that
  opens a modal and silently does nothing on submit. Post Implementation Report's per-row
  "Download" button is a real, visibly `disabled` button with an explanatory `title`, not a dead
  link or a button that pretends to generate a file.
- **No new Supabase tables, RPCs, RLS, or server actions** — these pages don't call Supabase at
  all, which is itself new: every other page in this app queries real data (confirmed by
  auditing all 9 existing `(app)` routes before writing this batch).
- **New `NavSection: "reporting"`** — added now because Post Implementation Report is the first
  real page that belongs there; earlier phases (see the app-shell plan) deliberately left the
  REPORTING section out of the sidebar until a real page justified it.

**Batch 2 (Teams, Devices)** follows this same convention exactly, with one notable choice: this
Supabase project's `projects` table is empty and every `profiles` row has `project_id = null`,
so a real query for "Teams" would render an empty page by default — worse than a clearly-labeled
mock one. Both pages stayed fully self-contained mock rather than a hybrid real+mock query,
unlike Coverage Analysis's real state names. Both land in the existing `administration` section
(no new section needed) — icons were picked deliberately distinct from existing ones (`ph-users`
for Teams vs. `ph-users-three` already used by "Users & Roles").

**The Reporting & Export Centre (`/reporting`) breaks from the mock-page convention on
purpose.** One real export already existed (`issues/export/route.ts`, CSV-only, filter-aware) —
building a hub that pretended it was all preview would be dishonest in the other direction. So
this page is a mix, badged per-card rather than page-wide: "Issue Data Export" and "Post
Implementation Report" are real (the former exports live data via genuinely working buttons, the
latter links to the real preview page from batch 1); "Coverage Analysis Report", "Team
Performance Report", "Implementation Monitoring Report", and "Data Sets Export" are disabled
"Coming Soon" cards, same honest-disabled pattern as before. Alongside it, `issues/export`
gained a backward-compatible `?format=json` param (default stays `csv`, every existing caller —
the Issues page and Settings — is unaffected) — a small, real addition, not a mock, that finally
gives the centre a second real export format to offer. Settings' `export_format`/`data_retention`
fields remain unread by anything (a pre-existing gap, not fixed here) — deliberately did **not**
add copy implying they're applied, and did not wire retention/purge (a data-lifecycle decision
out of scope for an export-mechanism change).

## 13. Generic column-mapped bulk import — Bulk Invite Users

The last brief item. Unlike the existing Settlements/Activity Sites CSV upload
(`CsvUploadModal.tsx`, fixed template — headers must be exactly `statename`/`lganame`/
`wardname`/`<kind>name`), this is a genuinely new pattern: upload any CSV, then map its columns
to the target fields yourself. Applied to Users & Roles, the only real screen where it made
sense (see below for what was excluded and why).

- **`inviteAndSetupUser()` extracted as a shared helper** in `lib/actions/users.ts`, used by
  both `addUserAction` (single) and the new `bulkAddUsersAction` (many) — same
  authorization/role-assignability/invite/profile-patch logic either way, not duplicated.
- **Sequential, not parallel, with a per-row delay and a 25-row cap.** Each invite is its own
  Supabase Auth Admin API call, not a batchable table insert — and this project has already hit
  Supabase's email rate limit from repeated invites before (see `tools/db/add-user-no-email.js`'s
  own comment). Confirmed live during testing: a 2-row test batch immediately hit "email rate
  limit exceeded" on the second row. The per-row result list is what makes this tolerable — an
  admin sees exactly which rows got through before a limit was hit and can re-submit the rest,
  rather than the whole batch silently failing or partially succeeding with no visibility.
- **Project Admins excluded as a target.** `addProjectAdminAction` creates a *new project* per
  admin by design (#2) — bulk-importing rows through it would spawn one new project per row,
  almost certainly not what "bulk import project admins" means. Fixing that ambiguity (e.g.
  letting bulk rows target an existing project) is a separate design question.
- **Teams/Devices excluded.** Both are still pure mock data (#12) with no backend/action file —
  bulk import needs something real to import into.
- **Data Sets' existing CSV upload was left as-is**, not upgraded to column-mapping, per an
  explicit choice to add the new capability rather than risk the working settlements/activity
  sites import path.

## 14. Navigation performance — Dashboard aggregate RPC, trimmed Issues select, route skeletons — migration 0027

Root-cause investigation confirmed the Dashboard was fetching the entire `issues` table (no
`.range()`/`.limit()`) and then computing every KPI/trend/breakdown with 20+ JS `.filter()`/
`.reduce()` passes over that array, plus two more sequential round-trips for Recent Issues and
the Timeline. The Issues list's `ISSUE_SELECT` (7 joined relations, built for the Detail page)
was reused for the paginated list, which never renders `reporter`/`verifier`/`dri.phone/email`/
`ward_ref`.

- **`get_dashboard_stats()` SQL RPC** (`0027_dashboard_stats_rpc.sql`) replaces the full-table
  fetch — one aggregate query returns totals, per-status counts, avg resolution days, the 14-day
  trend, and the top-6 state breakdown. Deliberately `security invoker` (the default), **not**
  `security definer` like the `current_user_role()`/`in_scope()` helper functions in
  `0007_functions_and_triggers.sql` — this function *is* a query RLS applies to, not a policy
  helper that needs to bypass it. `dashboard/page.tsx` now runs this RPC + a lean
  `lat,lng,status`-only map query + the existing Recent Issues/Timeline queries in one
  `Promise.all` (4 concurrent round-trips replacing 3 sequential ones, the first of which was
  unbounded). KPI values/trend/breakdown are unchanged — same rounding, same UTC-day bucketing,
  same zero-filled statuses — only where the numbers are computed moved from JS to SQL.
- **`ISSUE_LIST_SELECT`** added alongside the untouched `ISSUE_SELECT` in `lib/queries/issues.ts`
  — the Issues list query now selects only the 8 fields/relations its table actually renders.
  Issue Detail (`getIssueById`/`getIssueByCode`) keeps the full 7-relation `ISSUE_SELECT`
  unchanged. The list's independent `getCategories`/`getStates` lookups now run in `Promise.all`
  alongside the paginated issues query instead of only after it.
- **Two indexes added**, both justified by an actual unindexed query pattern (not speculative):
  `issue_history_occurred_at_idx` (the Dashboard Timeline orders by `occurred_at desc` with no
  `issue_id` filter — the existing `(issue_id, occurred_at)` composite doesn't help it) and
  `pg_trgm` + GIN indexes on `issues.description`/`issues.code` (the Issues search's
  leading-wildcard `ilike` can never use a plain btree index). Every other column the
  investigation checked — `status`/`priority`/`category_id`/`state_id`/`assigned_dri`/
  `project_id`/`reported_at` — already had a btree index since `0004_issues.sql`.
- **`loading.tsx` added to every `(app)` route** (new `components/ui/Skeleton.tsx` primitive,
  reused across them) — Next.js route-level Suspense fallbacks shown immediately on navigation
  while a page's Server Component data fetch is in flight. Purely additive UI, paired with the
  query fixes above rather than standing in for them — a skeleton doesn't make a slow query
  faster, so it's shown *because of* real fetches, not to mask a still-slow one.
- **Investigated and left unchanged**: the double `auth.getUser()` in `proxy.ts` (optimistic
  redirect) + `dal.ts` (the real DB-backed check) — this is the documented Next.js DAL pattern,
  and collapsing it would weaken either the pre-render redirect or the per-request re-verification
  every Server Component relies on. `RealtimeRefresher`'s 400ms debounce, GIS's existing
  `dynamic(...,{ssr:false})` lazy-loading, and `gis/page.tsx`'s already-parallel lookup queries
  were all confirmed already correct.

## 15. Team Performance Report page

The last remaining net-new page from the original brief. Deliberately deferred during the
mock-data batches (#12) because Analytics already has real, per-*individual* "DRI Performance"/
"TPM Monitoring Performance" tables — a second mock page on the same subject risked reading as a
contradicting data source. Also already promised, by name, as a disabled "Coming Soon" card on
the Reporting Centre.

- **Stays at a different grain than Analytics on purpose**: per-*team*, not per-person. No
  overlap with the DRI/TPM tables' columns or grouping.
- **Extends the existing `Team` type in `lib/mock/teams.ts`** (`avgResponseHours`,
  `resolutionRate`, `deviceUtilization`) rather than forking a second dataset — both `/teams`
  and `/team-performance` read the same 5-row `TEAMS` array, so member counts/leads/status can
  never drift between the two pages. The three new fields are invented plausible figures, called
  out as such in the file's header comment — **not** derived from `devices.ts`, whose 6 rows are
  an illustrative subset (not a real per-team device pool), confirmed live that `projects` is
  empty and every `profiles.project_id` is null, so there's no real data to query instead.
- **Reporting Centre's "Team Performance Report" card** switched from disabled "Coming Soon" to
  a real "View Report" link — same treatment as Post Implementation Report's card, which already
  established this exact mock-page-with-a-real-hub-link pattern.
- Lands in the `reporting` `NavSection` (not `administration`, where Teams/Devices live) —
  following Post Implementation Report's precedent as the one other page that's both a mock
  preview *and* linked from a Reporting Centre card.

## 16. Time Efficiency Analysis page — migration 0028

The last unbuilt nav item from the original brief. Unlike every other net-new page (#12, #15),
**this one is fully real — no mock data at all**. The workflow RPCs (`assign_issue`,
`submit_dri_response`, `record_corrective_action`, `verify_and_close_issue`) already write a
real, server-timestamped (`occurred_at = now()`, never client-supplied) `issue_history` row at
every stage transition, using stable `action` strings already rendered verbatim in Issue Detail's
Activity History — no new instrumentation needed.

- **Different grain than Analytics, same non-overlap principle as #15**: Analytics measures one
  end-to-end span (`reported_at` → `resolution_date`, "discovery to closure"), averaged overall
  and per-DRI. This measures the four stage-to-stage intervals *inside* that span (report→assign,
  assign→response, response→corrective action, corrective action→verify) — entirely additive.
- **`get_time_efficiency_stats()` SQL RPC** (`0028_time_efficiency_stats_rpc.sql`), `security
  invoker` like `get_dashboard_stats()` (#14) — computes stage averages and a per-priority
  breakdown in one query, RLS-respecting. Each average `filter`s out issues that haven't reached
  that stage (`null`, not `0`).
- **Simplification called out explicitly**: uses the *first* occurrence of each action per issue,
  so a reopened issue's second pass through corrective-action/verification isn't separately
  tracked — an aggregate efficiency view, not a per-issue audit trail.
- No "Preview · Sample Data" badge — deliberately, since this is real data, unlike every other
  page that convention applies to.
- Lands in the `analytics` `NavSection` right after Analytics (extends its domain) rather than
  `reporting` — no existing Reporting Centre card references it, unlike Team Performance.

## 17. Data Sets column-mapped CSV upload

Brings the column-mapping UX proven by Bulk Import Users (#13) to Settlements/Activity Sites,
replacing the old fixed-template CSV upload (headers had to be exactly `statename`/`lganame`/
`wardname`/`<kind>name`) — the deferral #13 documented is now resolved.

- `CsvUploadModal.tsx` rewritten in place: Papa Parse → auto-guessed, user-editable column
  mapping (State/LGA/Ward/Name, any header names) → live preview running the same sequential
  State→LGA→Ward resolution the old modal had, just sourced from the mapped columns instead of
  fixed keys. `bulkAddSettlementsAction`/`bulkAddActivitySitesAction` gained a 1000-row cap
  (`BULK_DATASET_IMPORT_MAX_ROWS`) — generous since, unlike Bulk Import Users, this is a plain
  table insert with no external rate limit to hedge against.
- **Two real bugs found and fixed during this work's own verification, both pre-existing and
  unrelated to the column-mapping change itself:**
  1. **`getAllWards()` (`lib/queries/lookups.ts`) silently truncated at Supabase/PostgREST's
     default 1000-row cap** — 6,166 wards are seeded, only the first 1000 alphabetically ever
     reached the client, so any ward sorting after that cutoff (the large majority) was
     "unrecognized" by every consumer of this function: Data Sets' CSV upload, its "Add
     Manually" cascade, and the old modal too. Fixed by paginating with `.range()` until a
     short page confirms nothing's left. **Root-caused by testing this feature against a real
     ward outside the first 1000** — caught here, not shipped.
  2. **Found, NOT fixed here (too large for this task)**: `data-sets/page.tsx`'s
     `settlements`/`activity_sites` `select("*")` hits the same 1000-row cap — but those tables
     have **354,148** and **32,201** real rows respectively. The Data Sets screen has likely
     only ever shown/worked with a small recent subset of either table. An initial version of
     this feature added a client-side "already exists" duplicate check against those props;
     it was removed once this scale was discovered, since flagging duplicates against <0.3% of
     the real data would give false "OK" confidence on the vast majority of actual duplicates —
     worse than no check. Only **duplicate-in-file** checking shipped (fully reliable — it only
     looks at the CSV's own rows). The DB's `unique (ward_id, name) where status <> 'rejected'`
     index (migration 0019) remains the real safety net, exactly as before this change. The
     underlying over-fetch is a separate, much larger problem (real pagination/search needed
     for the whole Data Sets screen) — flagged for its own future task, not attempted here.

## 18. Ward-level GIS drilldown

`get_ward_boundaries(p_lga_id)` existed in Supabase since the original boundary-RPC migration
(#0013) but nothing ever called it. Added the missing level to `GisMapInner.tsx`, following the
existing State→LGA boundary layers' own pattern exactly rather than inventing a new one.

- **Click-to-drill, not a new dropdown**: the sidebar already has 5 filter selects; clicking an
  LGA polygon (hover-highlighted for discoverability) drills into its wards, matching the
  standard GIS interaction for this and needing no new sidebar chrome. The LGA `FeatureCollection`
  now carries `id` in `properties` (previously only `name`) so the click handler knows which LGA
  was clicked.
- **Third boundary layer, same lifecycle as State/LGA**: its own `useEffect` keyed on
  `selectedLga`, same `cancelled` closure-guard against React Strict Mode's dev-only
  double-invoke, same remove-old-before-fetch-new, same `addOverlay`/`fitBounds` pattern. Styled
  `#b45309` (amber) — a third, visually distinct color following State's grey and LGA's purple.
- **Cascading cleanup**: changing (or clearing) the State filter, and "Reset Filters", both clear
  the ward drilldown too — otherwise a stale ward layer for an LGA in a since-abandoned state
  selection could linger.
- **Exit affordance**: a small `Wards: {name} ✕` chip in the sidebar (only rendered while a
  drilldown is active) — the only way to back out of the drilldown without touching the State
  filter, since there's no dropdown to blank out.
- Purely a boundary-visualization layer, like State/LGA before it — doesn't filter which issue
  markers show. No new route, migration, or RPC — `get_ward_boundaries` needed nothing added.

## 19. Bulk Import Project Admins

The last excluded target from the Bulk Import Users work (#13): `addProjectAdminAction` creates
a *new project* per admin by design (#2), so a naive bulk-loop would spawn one project per row.
Per your decision: **rows sharing the same (trimmed, case-insensitive) project name in the
uploaded file become multiple admins on one newly-created project; different names each create
their own new project.** Never targets a pre-existing project — that capability doesn't exist
anywhere in the app, and `projects` was still empty as of this change, so there'd be nothing to
pick from regardless.

- **`bulkAddProjectAdminsAction`** (`lib/actions/users.ts`) groups rows by normalized project
  name, `insert`s the `projects` row **once per group**, then loops that group's rows invoking
  the same invite-then-patch-profile sequence `addProjectAdminAction` already uses — not routed
  through `inviteAndSetupUser` (its project_id logic — inherit from the calling Project Admin —
  doesn't apply here; every caller is `super_admin`). Same `BULK_INVITE_MAX_ROWS`/
  `BULK_INVITE_DELAY_MS` as Bulk Import Users, since this is still one `inviteUserByEmail` Auth
  API call per row — same rate-limit exposure.
- **No new rollback/transaction behavior** — if a group's project insert fails, every row in
  that group fails together with a clear message; if invites fail *after* a successful project
  insert, the project row is left behind with zero admins, matching the single-add flow's
  already-accepted non-transactional risk (confirmed live: a project can end up orphaned this
  way, cleaned up manually — same as it always could via the single "Create Project Admin" form).
- **`BulkImportProjectAdminsModal.tsx`**: same parse → map → preview → submit shape as
  `BulkImportUsersModal`, with a Project Name field replacing Role, and a preview summary line
  ("N ready to import across M projects") so the grouping behavior is visible before submitting
  — the one non-obvious part of this feature.
- Verified live: a 2-row file sharing one project name created exactly one `projects` row
  (confirmed via direct query); duplicate-email-vs-existing-admin, duplicate-email-in-file, and
  the project-count preview summary all behave correctly. Live invite sends hit both a genuine
  email-format rejection (`@example.org`, unrelated to this feature) and Supabase's email rate
  limit (same well-documented, expected constraint from #13's own testing) — neither is a defect
  in the grouping/reporting logic, both surfaced correctly as per-row errors.


## 20. Post-shipping code review — 7 fixes across #15/#17-19

An independent 8-angle review pass (correctness ×3, cleanup ×3, altitude, conventions) of
everything shipped since Team Performance found 7 real, verified issues in that same body of
work. All 7 were fixed with minimal, targeted edits:

- **`bulkAddProjectAdminsAction` couldn't recover from its own partial failures** —
  `projects.name` is `UNIQUE`, and a group whose invites all failed left an orphaned,
  admin-less project row behind (reproduced live). Retrying the same project name then hit the
  unique-constraint violation with a misleading "could not be created" error. Fixed: on a name
  collision, look up the existing project and reuse it if it has zero admins attached (an
  orphan from this same mechanism); only refuse if it already has admins (a real, populated
  project — still never silently adopted, preserving the "never targets a pre-existing project"
  product decision). Verified live: seeded an orphan, retried, confirmed exactly one project
  row (same id) rather than a duplicate or a failure.
- **`getAllWards` paginated with `.order("name")` alone, no tiebreaker** — Postgres doesn't
  guarantee stable tie-order across separate `.range()` calls without one. Live query found two
  wards both named "Goniri" sitting exactly at a 1000-row page boundary. Fixed: added
  `.order("id")` as a secondary key. Verified live: re-ran the full paginated fetch — all 6,166
  wards returned exactly once, zero duplicates, zero gaps.
- **`bulkAddProjectAdminsAction` now calls `inviteAndSetupUser`** instead of a third hand-rolled
  copy of the invite+profile-patch sequence — the helper gained an optional `projectIdOverride`
  parameter for this.
- **CSV column-mapping selects (`CsvUploadModal.tsx`, `BulkImportProjectAdminsModal.tsx`)** now
  clear a field's existing mapping when its column is picked for a different field — previously
  nothing stopped two target fields silently reading the same CSV column.
- **Ward drilldown (`GisMapInner.tsx`)**: the ward-boundary effect now depends on `selectedLga?.id`
  instead of the `selectedLga` object reference, so re-clicking the same already-drilled-into
  LGA no longer tears down and refetches the layer / resets the map view for no reason.
- **Same file**: an LGA with zero seeded ward boundaries now shows "(no boundary data)" next to
  the drilldown chip instead of leaving it looking like a silently broken feature.
- **Team Performance now uses the existing `ActiveStatusTag`** component instead of
  re-implementing the same active/inactive color/label formula inline.

`npm run build` stayed clean throughout; the two most load-bearing fixes (project-retry
recovery, ward pagination) were verified against the live database, not just by inspection.

## 21. Data Sets real server-side pagination — migration 0029

Closes the loop #17 deliberately deferred: `data-sets/page.tsx` unconditionally did
`select("*").order("created_at", ...)` against `settlements` (354,148 rows) and `activity_sites`
(32,201 rows), shipping the *entire* result into a Server Component prop and rendering one
client-side table with no pagination. PostgREST silently caps an unbounded `select()` at its
configured max-rows (observed 1000) — so the screen had only ever shown/worked with an arbitrary
~1000-row slice (whatever sorted first by `created_at desc`) of either table, never the real
data, and any duplicate/search/filter logic against it was correspondingly meaningless.

- **Real `.range()` pagination + a search/filter UI**, following the exact pattern already used
  on the Issues page (`issues/page.tsx` + `IssuesFilterBar.tsx`) rather than inventing a new one:
  `searchParams`-driven (`tab`/`page`/`search`/`status`/`state`/`lga`), `count: "exact"` for
  accurate totals, `PAGE_SIZE = 20`. `DataSetsClient.tsx` no longer holds the full row set or an
  internal tab `useState` — tab switching is now a URL change, and the component reads
  `useSearchParams`/`useRouter` directly (it was already `"use client"`) instead of a separate
  filter-bar file.
- **Search covers name + state + LGA**, not ward — the tables store `ward_id`, not a ward-name
  column, and joining just to support search text wasn't judged worth it for this pass; state/LGA
  is enough to find a specific record in practice per the actual ask.
- **State/LGA filter values are names, not ids** in the URL, since `statename`/`lganame` are
  plain text columns, not FKs (#6a, deliberate). The filter UI still cascades State → LGA using
  the id-keyed `lgasByState` map (already loaded for the Add/Edit form) via a small reverse
  name→id lookup — same shape as the existing `lgaToState`/`wardToLga` lookups in the same file.
- **Pending-review count is now a real `count: "exact", head: true` query** (`status in
  (pending_create, pending_update, pending_delete)`, summed across both tables), not derived from
  whatever slice of rows happened to be in memory — it was silently wrong before this fix for the
  same reason the whole page was.
- **New indexes** (migration 0029): `pg_trgm` + GIN trigram indexes on the name/state/LGA text
  columns of both tables, since the search box's `ilike '%term%'` has a leading wildcard a btree
  index can't serve, and a 354k-row sequential scan per keystroke isn't acceptable; plus a plain
  btree `(statename, lganame)` index for the filter dropdowns' equality lookups. Non-concurrent
  `create index`, matching every other migration in this repo — briefly locks writes on these two
  tables, meant to run in a low-traffic window.
- **CSV upload (`CsvUploadModal.tsx`) is untouched.** Its duplicate-in-file-only checking (#17)
  was already correct given the scale, independent of whatever subset of rows the page happened
  to have loaded — nothing about this fix changes that reasoning.
- Picked up and finished from a stalled parallel session (uncommitted work, no activity for 2+
  hours) — reviewed in full before finishing: the design and implementation were already sound,
  matching the Issues page's own filter pattern; only the migration apply, build, and live QA
  were still outstanding.

## 22. State Coordinator review/approval workflow + DRI sector scoping — migrations 0031-0033

New workflow: `TPM Field Monitor → State Coordinator → DRI` (was a direct Field-Monitor-to-DRI
assignment). A State Coordinator now reviews every new Finding before a DRI is ever notified.

- **Scoped by State, single state per coordinator.** `profiles.managed_state_id` — matches the
  role name literally and Nigeria's real admin hierarchy; not project-scoped like Project Admin.
  A coordinator covering multiple states isn't supported yet — extend to a join table if that's
  ever needed, rather than widening this column's meaning.
- **Approve and Assign are one combined action**, not two persisted states. `issues_status`
  gained `pending_review` and `returned_for_correction` — there is no separate long-lived
  "approved but unassigned" status; `approve_and_assign_finding` moves a Finding straight from
  `pending_review`/`returned_for_correction` to `assigned`, recording an "Approved by State
  Coordinator" history row immediately followed by "Assigned to DRI" in the same call. This is
  the *only* place a fresh assignment notification fires — the insert path never notifies a DRI.
- **Existing Findings are untouched, on purpose.** Only the `issues.status` column default
  changed (`'new'` → `'pending_review'`); no existing row was updated. Every pre-migration `new`
  Finding keeps flowing through the original `dri_self_assign`/`assign_issue` paths (both left
  completely unchanged) — this is what "treat existing Findings as already-approved" means in
  practice: there was no bulk status migration to write, because nothing needed backfilling.
- **`issues_select` was narrowed for State Coordinator and DRI, not just extended.** The prior
  policy was one blanket `in_scope(project_id)` grant with no role condition — every authenticated
  role, DRI included, could already see every Finding in scope. A DRI's sector restriction can't
  be real if that blanket grant still applies alongside it (permissive RLS policies OR together,
  they don't restrict each other), so the policy itself had to change, not just gain a new
  addition. super_admin/project_admin/tpm_supervisor/viewer keep their exact prior access.
- **DRI visibility requires BOTH `assigned_dri = auth.uid()` AND a matching sector**, even though
  a State Coordinator should only ever assign within a DRI's own sector. This is deliberate
  defense-in-depth — the DB-level restriction doesn't rely on that discipline being followed
  correctly every time (see spec: "implemented at the permission/data-access level, not only by
  hiding UI elements"). A DRI with no `assigned_category_id` sees zero Findings — a safe default
  requiring an explicit admin action, not an oversight.
- **`issues_update`'s coordinator carve-out is a separate additional policy**, not a rewrite of
  the existing one — UPDATE's existing policy is already fully role-conditioned (no blanket grant
  to narrow), so adding was safe and lower-risk than editing the tested existing expression.
- **Category → Sector is a taxonomy change, not a rename.** The old 10 categories were incident
  *types* (Water & Sanitation Failure, Infrastructure Damage, ...); the requested 7 Sectors are
  humanitarian program *areas* (WASH, Nutrition, Health Services, MHPSS, Protection & AAP, Food
  Assistance, Fraud) — a different axis of classification, not a 1:1 relabel. The 3 old rows real
  Findings still reference (Water & Sanitation Failure/Infrastructure Damage/Safety Incident) keep
  their id/name — so those Findings' historical label stays accurate — but flip a new
  `categories.is_active` to `false`, hiding them from any "pick a sector" list without breaking
  their `category_id` FK. The 7 old rows nothing referenced were deleted outright and replaced by
  the 7 new sector rows. `assigned_category_id` (a DRI's sector) intentionally reuses the
  `categories` table/FK rather than a new `sectors` table — same reasoning as migration 0016's
  `mobile_code` decision: reuse the existing structure, don't stand up a parallel one.
- **`profiles.assigned_category_id`/`managed_state_id` are added now, ahead of the full
  Category→Sector UI terminology pass** (a separate, later item) — the schema work for DRI sector
  scoping was tightly coupled to the category/sector data swap (both needed in the same migration
  set to avoid a half-consistent schema in between), even though the UI-facing "Category" →
  "Sector" label rename itself is still pending.
- **`approve_and_assign_finding`/`return_finding_for_correction` are SECURITY INVOKER**, matching
  `dri_self_assign`/`assign_issue`'s existing convention — the actual mutation is gated by RLS
  (`issues_update_state_coordinator`), the explicit role check inside each function exists only
  for a clearer error message, not as the real security boundary. Both allow an `is_super_admin()`
  override (migration 0033 — an oversight in the initial 0032 pass, since every other workflow RPC
  in this codebase already allows that override per "Super Admin has full administrative access").
- **`edit_issue_submission` was extended, not duplicated**, to also allow the assigned State
  Coordinator to correct a Finding's category/priority/description while it's pending their
  review — same RPC, same history event, one more class of permitted caller.

## 23. Download approval: add Project Admin — migration 0036

`decide_download_request` is SECURITY INVOKER — it only ever succeeded because of
`download_requests_update`'s RLS, which was `is_super_admin()` alone. Project Admin had no path
to approve at all (the app's own `download-requests/page.tsx` didn't even show them the review
table — it branched purely on `role === "super_admin"`), even though the requirement lists both
roles.

- **Project Admin is scoped to their own project (`in_scope(project_id)`), not platform-wide** —
  matching every other Project Admin capability in this schema (issues, profiles, ...). The
  spec's "both roles must be able to approve" doesn't imply *identical* scope; Super Admin stays
  unscoped, Project Admin sees/decides only requests from their own project.
- **Additive policies**, not a rewrite of the existing simple ones — `download_requests_select`/
  `_update` untouched, `_select_project_admin`/`_update_project_admin` added alongside. Same
  reasoning as the State Coordinator RLS in migration 0032.
- **`create_download_request`'s admin-notification loop now also includes the requester's own
  Project Admin(s)** (matched by `project_id`), not just every Super Admin — they can now
  actually act on the request, so they should know about it.
- **Viewer's access is unchanged** — still `requester_id = auth.uid()` only, still routes to the
  "my own requests" view, not the review table (`canReviewDownloadRequests`).

## 24. Field Monitor Attendance — migration 0037

New `field_monitor_attendance` table + `attendance-evidence` storage bucket, backing a daily
proof-of-presence record: one selfie, one assignment-location photo, GPS, and a device
identifier, captured once per Field Monitor per day.

- **No UPDATE or DELETE policy at all — the record is immutable by design.** A daily attendance
  record is evidence, not a working document; if a Field Monitor mis-captures it, the fix is a new
  day's record or an admin-level data correction outside the app, not a self-service edit that
  would undermine the "proof of presence" purpose. This mirrors `issue_history`'s
  append-only convention rather than any of the editable-record tables.
- **`unique(field_monitor_id, attendance_date)`** is the actual duplicate-prevention boundary
  (Item 13), enforced at the DB level, not just client-side — the mobile app checks its local Room
  cache first (fast path, works offline), but the constraint is what actually guarantees it even
  across two devices or a reinstalled app.
- **State/LGA are resolved server-side** by a `before insert` trigger
  (`resolve_attendance_location()`) calling the existing `resolve_administrative_location(lat,
  lng)` RPC (already built for GIS in migration 0012) — reused rather than duplicated, per the
  spec's "do not create unnecessary parallel infrastructure." `project_id` is likewise defaulted
  from the field monitor's own profile in the same trigger, so the mobile app never has to send
  (or fake) either value.
- **Device identifier reuse is a flag, not a block** (Item 12) — `findReusedDeviceIds()` surfaces
  device_ids shared across more than one Field Monitor account in the admin table, but nothing
  prevents the insert. A device legitimately changes hands (handed-down phone, shared pool
  device); the requirement is visibility for admins to investigate, not a hard rule that would
  lock out a legitimate reassignment.
- **RLS scoping matches the established convention exactly**: `super_admin` unscoped,
  `project_admin` via `in_scope(project_id)`, `state_coordinator` via `managed_state_id` matching
  the record's resolved `state_id`, and the Field Monitor can `select`/`insert` only their own
  rows (`field_monitor_id = auth.uid()`). No new scoping pattern introduced.
- **Storage path scheme is `{field_monitor_id}/{attendance_date}/selfie.jpg` (and
  `.../location.jpg`)** — keyed by the natural (`field_monitor_id`, `attendance_date`) unique
  pair, not the row's own server-generated `id`, since the mobile app needs a path it can compute
  *before* the DB write happens (see the Android push implementation) and the row has no UPDATE
  policy to patch a path into afterwards. The bucket's own insert policy checks
  `(storage.foldername(name))[1] = auth.uid()::text`, so a Field Monitor can only ever write into
  their own folder; the select policy separately grants admins/coordinators access via a join back
  to `field_monitor_attendance`, matching the same scoping as the table itself. The bucket is
  private (never public) — every admin view request signs a short-lived URL, same pattern as
  Finding evidence photos.
- **The mobile push is a plain `insert`, retried as an `insert`, not an `upsert`** — since the
  table has no UPDATE policy, `ON CONFLICT DO UPDATE` would itself be rejected by RLS. A retry
  after a lost response instead gets a 23505 unique-violation on
  `unique(field_monitor_id, attendance_date)`, which the app treats as confirmation that an
  earlier attempt already succeeded (nothing to reconcile against an immutable row) rather than as
  a failure to retry again.
- **Web admin section (`/attendance`) is read-only** — there's no approve/reject workflow for
  attendance the way there is for Findings; it's a monitoring view, not a queue. Access is gated
  by `canAccessAttendance()` (`super_admin`, `project_admin`, `state_coordinator` — the roles the
  user confirmed need to review Field Monitor presence).

## 25. Security audit (Item 16) — profile self-edit privilege-escalation fix, migration 0038

Systematic pass over every RLS policy, SECURITY DEFINER function, and storage policy in the
schema (`pg_policies`, `pg_proc.prosecdef`/`proconfig`, `storage.buckets`,
`information_schema.role_table_grants`), specifically checking that role/data security introduced
this session is enforced at the database level, not only by the frontend hiding a button.

**Found and fixed**: `enforce_profile_update_rules()` (migration 0007) is the `BEFORE UPDATE`
trigger that stops a non-admin from editing their own `profiles` row's `role`/`project_id`/
`status` — necessary because `profiles_update`'s RLS policy allows `id = auth.uid()`, so without
this trigger a user could self-escalate with a raw REST `PATCH` to their own row (no UI bug
required, no client bypass — Supabase's `authenticated` key is expected to be usable this way).
Migration 0031 added two more security-sensitive columns to `profiles` — `managed_state_id` (which
state a State Coordinator may review/approve Findings in) and `assigned_category_id` (which sector
a DRI may see Findings for) — but never added them to this trigger's pin-back list. Confirmed
exploitable: a `dri` account could `PATCH` its own `assigned_category_id` to a different sector's
id and immediately gain visibility into that sector's Findings (`issues_select`'s
`category_id = profiles.assigned_category_id` check would just pass); a `state_coordinator`
account could do the same to `managed_state_id` and gain review/approve authority over a state
they were never assigned to.

- **Fix is the narrowest possible**: extends the exact pin-back pattern already used for
  `role`/`project_id`/`status`, in the same trigger, same branch (a user editing their own row).
  Project Admin/Super Admin are unaffected — they're the roles meant to set these two columns for
  *other* users (`UsersTable.tsx`'s Managed State / Assigned Sector fields), and this only
  tightens the final "editing my own row" branch that previously left them unguarded.
- **Everything else audited came back clean**: every RLS policy in the schema is scoped
  `to authenticated` (none granted to `anon`/`public`), so `anon`'s default Supabase table grants
  are inert; every `SECURITY DEFINER` function sets `search_path = public` (no search-path
  injection surface); all nine workflow RPCs (`assign_issue`, `dri_self_assign`,
  `submit_dri_response`, `record_corrective_action`, `verify_and_close_issue`,
  `reject_and_reopen_issue`, `approve_and_assign_finding`, `return_finding_for_correction`,
  `edit_issue_submission`, `decide_download_request`, `create_download_request`) are
  `SECURITY INVOKER`, meaning RLS — not the RPC body — is the real enforcement boundary for all of
  them, consistent with every prior decision in this log; the new `field_monitor_attendance` table
  and both storage buckets' policies match their documented design exactly (§24).
- **Noted, not changed**: the base `issues_update`/`issues_insert` policies (pre-dating this
  session) authorize by role + project scope only — they don't distinguish "the client went
  through the intended RPC" from "a raw REST call touched this row directly," so a `project_admin`/
  `tpm_supervisor`/`dri` with valid credentials could in principle write directly to `issues`
  columns RPCs would normally validate (e.g. setting `status` without the matching history/
  notification side effects). This is a pre-existing architectural characteristic of the whole
  `issues` table, not something introduced by any migration in this project, and tightening it
  (e.g. moving to `SECURITY DEFINER` RPCs with a much narrower base UPDATE policy) is a
  meaningfully larger, cross-cutting change than "smallest safe fix" — flagged for the user to
  decide on rather than changed unilaterally.
- **Also noted, since fixed**: an empty, unused, `public = true` storage bucket named `evidence`
  (distinct from `issue-evidence`/`attendance-evidence`) existed with 0 objects in it and no code
  references — a leftover from before the current bucket naming. Removed via a follow-up cleanup
  session using the Supabase Storage API (`storage.deleteBucket`), not a SQL migration —
  `storage.buckets`/`storage.objects` reject direct `DELETE`/raw DML ("Direct deletion from
  storage tables is not allowed. Use the Storage API instead."), the same reason `full_migration.sql`
  creates buckets via `insert into storage.buckets` but can never fully replay a bucket *removal*
  through the migration pipeline. Confirmed gone via direct query; nothing further to do.

## 26. Add "Warehouse" sector — migration 0039

User-requested addition to the Item 4 sector list after the original 7-sector rollout. Sectors
are pure reference data — both apps fetch the category/sector list live from `categories`
(`getCategories()`/`getAllCategories()` on web, `ReferenceRepository` on mobile), nothing is
hardcoded in either client — so a single `insert` is the whole change: `sort_order = 7` continues
the existing sequence, `abbr = 'WAR'` satisfies `categories_abbr_format`
(`^[A-Z]{3}$`)/`categories_abbr_unique`. No RLS/RPC/UI change needed anywhere.

## 27. Android: prune Findings a device no longer has access to (delta-pull staleness gap)

User-reported: a DRI test account's Home screen showed a `pending_review` Finding it should never
see at all (RLS's DRI branch requires `assigned_dri = auth.uid()` AND
`category_id = assigned_category_id` — neither matched; `assigned_dri` was `null`). Confirmed live
against the DB that the row genuinely isn't visible to that account under current RLS, which
narrowed this to the mobile app's own sync, not a server-side hole.

Root cause: `SupabaseSyncApiService.pullIssues()`'s delta pull (`updated_at > lastPulledAt`) only
ever adds or updates rows the server reports as changed — it never removes a locally-cached row
that simply stops being returned. That's fine for a Finding's own field edits, but RLS visibility
can narrow for reasons that don't touch the row's `updated_at` at all: a DRI reassigned away, an
`assigned_category_id`/`managed_state_id` change, a State Coordinator scope change, a deletion.
This specific device most likely cached the row before migration 0032's `issues_select` rewrite
(when the old blanket `in_scope(project_id)` grant was still in effect for every role) and never
had a reason to drop it since.

- **Fix**: every `pullIssues()` run now also fetches the full, non-delta set of every Finding id
  the account can currently see (RLS-scoped, no `updated_at` floor — the same authoritative
  listing the delta pull's own query would give with the floor removed), paginated in 1000-row
  pages past PostgREST's default response cap so this stays correct even if an account's visible
  set ever exceeds it, then deletes any locally-synced row whose `remoteId` isn't in that set.
- **Never touches an unsynced local draft** (`remoteId` still `null`) — a Field Monitor's own
  just-submitted Finding that hasn't pushed yet is never "on the server" to compare against, so
  it's structurally exempt regardless of what the visible-ids sweep returns.
- **The empty-set case is handled explicitly, not left to SQLite**: an account can legitimately
  have zero currently-visible Findings (a brand-new DRI with nothing assigned yet), which should
  wipe every previously-synced local row — but Room/SQLite's behavior for `NOT IN ()` with an
  empty parameter collection isn't something to trust for a security-relevant delete, so
  `IssueDao` has a separate `deleteAllSynced()` and `AppRepository.pruneIssuesNotVisible()`
  branches to it explicitly when the visible-ids set is empty.
- **Cost**: one extra request per sync (a single indexed column, no `SELECT *`) — accepted in
  exchange for the actual guarantee that a device's local cache converges to what RLS currently
  allows, rather than only ever growing/updating. Every mobile account is either `tpm_supervisor`
  (project-scoped) or `dri` (assignment+sector-scoped) — never `super_admin`/`project_admin`, which
  have no mobile UI (DECISIONS.md #7) — so the realistic visible-set size for this sweep is small.

## 28. Live GIS Map: finish the Category→Sector rename, drop legacy options from the filter

Two leftover "Category" spots on the GIS page specifically (the Item 6/4 renames elsewhere had
already covered the rest of the platform):

- The Sector filter's own `<label>` already said "Sector," but its default option still said
  "All Categories" — fixed to "All Sectors." The Status filter's default option changed from
  "All Statuses" to "All status" per an explicit user request (grammatically unusual, applied only
  to this one dropdown — not a platform-wide rename of every "All Statuses" instance).
- **The dropdown's option list itself was sourced from `getAllCategories()`** (every category,
  active or legacy) — same as the Issues list/CSV export, where that's deliberate (keeps
  historical Findings filterable by their original, now-legacy category). On the GIS map
  specifically, the user wants only the current approved sector set offered, so this one call site
  switched to `getCategories()` (active-only). A Finding still tagged with a legacy category
  remains visible under "All Sectors" and still shows its real category name on the map's detail
  panel — it just can't be filtered to specifically by name anymore from this dropdown.
- **The actual sector filtering logic needed no changes at all** — `GisMapInner`'s existing
  `filtered` memo already gated on `i.category === filters.category`, and every downstream
  consumer (markers, the "N of M findings shown" count, the auto-fit-bounds effect, "No matching
  records found") already derives from `filtered`, not the raw `issues` list. The dropdown was
  just offering options beyond what should've been on a list meant to only show the 8 approved
  sectors — the wiring itself was correct.
- Verified live (as a DRI test account, since `categories_select`'s RLS is `using (true)` — every
  authenticated role sees the full active sector list regardless of their own assignment): the
  Sector dropdown shows exactly the 8 approved sectors, no legacy names, both labels read
  correctly.

## 29. "Findings" as module name, "Issue" as operational terminology — plus Project Admin review

Two related requests landed together: (a) split the terminology so "Findings" stays the
high-level module/dashboard name while the detailed management screens revert to "Issue"
terminology, and (b) extend Issue review/approve/return-for-correction/edit authority from
State Coordinator-only to State Coordinator + Project Admin + Super Admin (Super Admin already
had it via migration 0033's override).

### Terminology split

The dividing line, applied literally: the sidebar nav item and every Dashboard overview card
("Total Findings", "Live Finding Map", "Findings by Status", ...) keep saying "Findings" — those
are explicitly named as exceptions. Every other user-facing string in the module — the page
header ("Issue Management"), the detail-page title, table headers ("Issue ID", "Issue
Description"), buttons ("Report Issue"), modal copy, empty-states, the GIS map's marker-layer
name and issue-count, Settings/Reporting/Time-Efficiency/Team-Performance page text, download
request labels — reverts to "Issue." Internal identifiers (the `/issues` route, the `issues`
table, `approveAndAssignFindingAction`'s function name, etc.) were never touched by either the
original rename or this reversal — same "user-facing text changes, technical names don't"
convention as every other terminology pass in this project.

Not reverted, kept as "Findings": the `UsersTable.tsx` helper text ("This DRI will only see
Findings in this sector.") — a general reference to the domain/module, not the detailed
management screen; the login page's hero copy and `layout.tsx`'s meta description — top-level
platform branding, not operational UI.

### Project Admin review/approve authority

No RLS policy changes were needed — `issues_update`'s existing `project_admin` branch
(`current_user_role() = 'project_admin' and in_scope(project_id)`) already permitted a Project
Admin to `UPDATE` any issue row in their own project; the only thing blocking them was each RPC's
own internal role check (`raise exception ... only a State Coordinator may ...`), evaluated
*before* that already-permitted `UPDATE` ever ran. Migration 0040 widens `approve_and_assign_finding`
`/return_finding_for_correction`/`edit_issue_submission`'s internal allowlist to
`state_coordinator`, `project_admin`, or `is_super_admin()`. The two approve/return RPCs' own
`UPDATE ... WHERE status = any('pending_review','returned_for_correction')` remains the real
state-transition guard regardless of which role/RLS branch authorizes the row — a Project Admin
still can't approve or return an issue that isn't awaiting review, same as a State Coordinator
always couldn't. `edit_issue_submission` got an equivalent scope check added inline
(`project_admin and in_scope(project_id)`, alongside the existing `state_coordinator` check),
since that RPC does its own explicit scoping rather than relying on the UPDATE's WHERE clause to
narrow it.

`isCoordinatorForThisState` (web, `issues/[id]/page.tsx`) was renamed `isReviewerForThisIssue` and
extended with a Project Admin branch that mirrors `in_scope()`'s own null-passthrough exactly
(`profile.project_id === null || profile.project_id === issue.project_id`) rather than a stricter
check that could hide the Approve/Return buttons for a case the server would actually allow.

### Audit trail: `actor_role`

`issue_history` gained a nullable `actor_role user_role` column (migration 0040) — before three
roles could produce the same review action, "Approved by State Coordinator" was safe to hardcode
into the action text because only a State Coordinator (or the Super Admin override) could ever
produce that row. That stopped being true the moment Project Admin gained the same authority, so
the three review RPCs now: (1) record the caller's actual role in the new column, and (2) build
the action text from it via a small `role_label(user_role)` SQL helper (mirrors the web's
`ROLE_LABELS` map) instead of a hardcoded role name. The web's Activity History now renders
`{actor_label} ({role_label})` when a role is present — every pre-migration row simply omits the
parenthetical, which is honest (the role wasn't recorded, not unknown-and-guessed) rather than
backfilled.

Deliberately scoped to just these three RPCs, not every `issue_history` writer — the ambiguity
this fixes is specific to "which of three roles performed *this* review action," not a general
gap across the whole history log (a Field Monitor registering a Finding, or a DRI responding to
one, isn't ambiguous about which role did it).

### DRI notification timing (verified unchanged)

Confirmed via a full sweep of every function that calls `create_notification()`: nothing on the
Finding-registration path (`log_issue_reported()`'s trigger) notifies a DRI. Only
`approve_and_assign_finding` (and the legacy pre-migration `assign_issue` path) ever notify a DRI,
both strictly after approval + assignment — this requirement was already satisfied by the
existing architecture from migration 0032 onward and needed no change.

### What wasn't (and doesn't need to be) touched

Mobile app: no UI terminology change. A registered Finding was already, and remains, a single
`issues` table row that transitions through the same statuses a Field Monitor's submission always
has — there was never a separate Finding record and a separate Issue record to reconcile.

### Verification

`tsc --noEmit`/lint clean (0 new issues); live in the browser as a DRI test account confirms
"Issue Management," "Issue ID"/"Issue Description" columns, "No issues match these filters,"
dashboard still showing "Total Findings" etc. **Not verified live**: the Project Admin/Super Admin
Approve & Assign/Return/Edit buttons and the `actor_role` display, since the only accounts with
those roles in this database are real accounts (not test fixtures created for this session) —
resetting either password to test would be changing a real user's account access without their
knowledge, which wasn't done. Verified instead by direct inspection of the applied migration's
live function bodies via `pg_proc`, and by tracing the exact RLS policies each RPC's `UPDATE`
depends on. Recommend the user verify the Approve & Assign/Return/Edit buttons and audit-trail
role display with their own Project Admin and Super Admin accounts before relying on this.

## 30. Official TPM logo + Android rebrand to "TPM Monitor"

Source asset: `ttp.jpeg` (482×482, a globe+magnifying-glass mark over "TPM" / "Third-Party
Monitoring" / "INDEPENDENT · OBJECTIVE · IMPACTFUL"). Two derived assets, both losslessly cropped
from the original pixels — no redesign, recolor, or distortion:

- **`logo-full`** — the whole lockup, tightly cropped to its content bounding box (removing the
  source JPEG's ~5-7% margin), near-white background pixels snapped to pure `#fff` (compression
  noise cleanup, not recoloring). Used wherever there's room and a light background: the web
  login card, the Android login screen text pairing.
- **`logo-mark`** — just the globe/magnifying-glass icon (the source has a clean whitespace gap
  between the icon and the "TPM" text at y≈269-280px, used to isolate it), background made
  transparent via a distance-from-flat-background alpha ramp (the source background is a genuinely
  uniform off-white, so this cutout has no visible fringing — checked by compositing it onto a
  dark navy swatch). Padded to ~68% fill within its own square canvas, matching Android's adaptive-
  icon safe-zone convention, so the same file drops into every icon/mark context without
  per-use-case re-padding. Used for: the web sidebar (small, on a dark background — verified this
  reads cleanly without needing a white backing chip, so none was added), the web login hero
  badge, the favicon/app icons on both platforms, and the Android launcher/header/splash.

Followed the user's own stated preference: full logo for "platform identity" contexts (login),
mark alone for small/icon contexts (sidebar, favicon, app icon, in-app header) — not the same
asset stretched to fit everywhere.

### Web

- Sidebar header: the generic `ph-shield-check` icon replaced with the mark, at its existing
  size/position — no layout change, so expand/collapse behavior needed no touching.
- Login page: the hero panel's badge (dark photo background) got the mark on a white chip
  matching its existing rounded-square treatment; the login card's badge+text row was replaced
  entirely with the full logo image (there's room, and duplicating "TPM Monitoring Platform" as
  both an image and adjacent text would be redundant since the logo already contains that text).
  Root route already redirects straight to `/login` — there's no separate landing page to touch.
- Favicon/app icons: `src/app/favicon.ico` (was Vercel's default black-circle-with-triangle
  placeholder — confirmed and replaced), plus Next.js's file-convention `icon.png`/`apple-icon.png`
  (auto-detected, no metadata config needed). No PWA manifest exists on this platform, so "PWA
  icons" doesn't apply — not adding a PWA manifest from scratch here, since that's new
  functionality beyond this branding request's scope.
- Deliberately not touched: the authenticated top header bar. The sidebar already carries the
  logo on every page; a second copy there would be exactly the redundant repetition the brief
  says to avoid.

### Android

- **App name**: `strings.xml`'s `app_name` → "TPM Monitor" (cascades automatically to the
  launcher label, app drawer, Settings → Apps entry, and the manifest's `android:label` — all
  reference the same string resource, so this one change covers every OS-level surface). Also
  fixed the two in-app text spots that hardcoded the old name: the Home screen header title and
  the login screen's headline.
- **Launcher icon**: replaced the generic crosshair-and-checkmark placeholder
  (`ic_launcher_foreground.xml`, a vector, referenced by both `ic_launcher.xml` and
  `ic_launcher_round.xml`) with the real mark, rendered as density-bucketed PNGs
  (`mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_foreground.png`) since `minSdk = 26` means adaptive
  icons alone are sufficient — no legacy non-adaptive mipmap set was ever needed or added.
  `ic_launcher_background.xml` (flat `#F2F2F3`, matching the design system's own "color-bg"
  token) was left as-is — already a clean, appropriate backdrop.
- **In-app mark**: the same placeholder vector was also reused for the login screen's badge and
  the shared `TpmHeader`'s small corner badge (shown on every screen) — both now point at a new
  `ic_tpm_logo_mark` (colored, density-bucketed PNGs).
- **Notification icon**: `TpmFirebaseMessagingService`'s `setSmallIcon()` was also pointed at the
  same placeholder vector — this one could **not** just get the colored mark, since Android's
  status-bar icon convention requires a white-silhouette-on-transparent asset (the OS tints it
  itself; a full-color icon renders wrong). Generated a separate `ic_tpm_notification` — same
  mark shape, alpha channel preserved, RGB forced to white — at Android's own 24dp notification-
  icon density spec. This is a platform requirement, not a brand redesign: the artwork's shape is
  identical, only its color channel is forced to comply with how the OS actually uses this asset.
- **Splash screen**: didn't exist before this at all. Added via `androidx.core:core-splashscreen`
  (works down to API 21, uses the platform SplashScreen API natively on 31+) — a
  `Theme.TpmApp.Splash` style (parent `Theme.SplashScreen`) set on `MainActivity` in the manifest,
  with `postSplashScreenTheme` swapping back to the app's real theme automatically, and
  `installSplashScreen()` called before `super.onCreate()` per the API's contract. Shows the mark
  alone (same reasoning as every other small/icon context) on the existing window background
  color — no animation, no "TPM Monitor" text on the splash itself (the very next screen, Login,
  already carries the full "TPM Monitor" + logo identity, and the system SplashScreen API isn't
  well-suited to rendering paragraph-style text reliably across OS versions).
- Old, now-fully-unreferenced resources deleted rather than left dangling:
  `drawable/ic_app_mark.xml`, `drawable/ic_launcher_foreground.xml`.

### Verification

Web: `tsc --noEmit`/lint clean (the four new `<img>` tags needed `eslint-disable-next-line
@next/next/no-img-element` — deliberate: these are fixed local brand assets, not user content,
so `next/image`'s optimization pipeline buys nothing); verified live in the browser — login hero
badge, login card's full logo, and sidebar mark (both expanded and via the DOM in collapsed state)
all render correctly, no distortion, no stretching, favicon confirmed replacing the old Vercel
placeholder. Android: verified by direct file/resource inspection only (correct resource types,
correct XML references, correct density buckets, no dangling references to deleted files) — same
build limitation as every other Android change this session, needs the user's own Android Studio
rebuild to confirm the launcher icon, splash screen, and in-app marks actually render as intended
on a device.

## 31. Mobile app access for Super Admin, Project Admin, and State Coordinator

Supersedes the role restriction in #7 ("the Android login screen rejects `super_admin`/
`project_admin`/`viewer`"). Super Admin, Project Admin, and State Coordinator can now sign in to
the mobile app with their existing platform accounts, for oversight, guidance, and support.
`viewer` is still rejected. No backend/migration change was needed.

### Where the change lives, and why

- **Authentication** needed no server change: Supabase Auth is role-agnostic, and the only thing
  refusing these roles was `AppSession.mapRole()` in the Android app (sign in, then sign straight
  back out). It is replaced by `UserRole.fromDbValue()`. Same accounts, same password/reset/
  offline-grace-period flows — untouched.
- **Read visibility is not a mobile concept.** The app pulls `issues` and lets RLS decide what
  comes back (`issues_select`: Super Admin all; Project Admin own project; State Coordinator own
  managed state; Field Monitor own project; DRI own assigned Findings in own sector). The local
  Room cache therefore already holds exactly the right set per role with no client-side
  filtering — the only change was to stop hard-coding "everything that isn't a Field Monitor is a
  DRI" in the UI.
- **What each role may DO** is the same matrix the web already enforces (`rbac.ts` ↔ RLS/RPC
  guards), mirrored in the app as `MobileAccess` (one small file, unit-tested):

  | Mobile action | Field Monitor | DRI | Super Admin | Project Admin | State Coordinator |
  |---|---|---|---|---|---|
  | View Findings, detail, history, map, alerts (RLS-scoped) | yes | yes | yes | yes | yes |
  | Register a Finding | yes | – | yes | yes | – |
  | Final Verification (verify & close / reject & reopen) | yes | – | yes | yes | – |
  | DRI Response | – | yes | – | – | – |
  | Daily Attendance capture | yes | – | – | – | – |

  Each row matches a server rule (`issues_insert`, `issues_update`, `submit_dri_response`'s
  assigned-DRI guard, `field_monitor_attendance_insert`); the UI never shows an action the server
  would refuse, and the four action wizards also have a route-level guard so they can't be reached
  any other way. The server remains the real boundary.
- **Deliberately not offered to senior roles on mobile:**
  - *DRI Response* — Super Admin can do this on the web as an override, but the mobile wizard
    stamps the responder's own GPS/selfie/photos as the DRI's field evidence; a senior officer
    responding from their own location would misrepresent who was on site.
  - *Attendance capture* — Field Monitor only, by RLS and storage policy.
  - *Review actions (approve & assign / return for correction)* and every web-admin area (Users,
    Data Sets, Settings, Teams…) — not part of the DRI/Field Monitor mobile workflows, so not
    added. See the State Coordinator gap below before considering review on mobile.
- Home screen for these roles is an oversight view (Total / Pending Review / Ongoing / Resolved —
  Awaiting Verification / Verified-Closed / Reopened / Overdue), header pill and tab labels show
  the real role name ("Super Admin", "State Coordinator", …; matches web `ROLE_LABELS`), and the
  list is titled "Findings" rather than "My…/Assigned…".
- **Sync fix that broad-scope roles needed:** `pullIssues` fetched `limit(300)` newest-first and
  then set its watermark from that batch, so any account that can see more than 300 Findings would
  never receive the older ones. Invisible for Field Monitor/DRI; real for Super Admin/Project
  Admin. Now keyset-paged on `updated_at` (offset paging would skip a row updated mid-pull).

### Verification — `tools/db/test-mobile-role-access.js`

Re-runnable, leaves nothing behind: (A) creates one throwaway account per role, signs in through
the real API exactly as the app does, reads its profile and the tables the app pulls, then deletes
the accounts; (B) runs every read/write a role could attempt, under that role's identity, against
seeded fake data inside one always-rolled-back transaction. 79 checks: 76 pass, 3 known gaps
(below), 0 fail. Includes: each role signs in and reads its own profile; RLS visibility counts per
role (SA 4/4, PA own project 3, SC own state 3, FM 3, DRI own sector 1); register/verify/reopen/
respond/approve/attendance/delete allowed or denied exactly per the table; no role can escalate
its own `role` to `super_admin`; admin-only delete works for Super Admin only.

### Pre-existing gaps the test found (not caused by this change, not fixed here)

1. **State Coordinator cannot approve & assign a Finding** — on web or mobile.
   `profiles_select` (0008) lets a State Coordinator read only their own profile, and
   `approve_and_assign_finding` (SECURITY INVOKER) looks the chosen DRI up in `profiles`, finds
   nobody, and raises "Selected user is not a DRI". Project Admin/Super Admin are unaffected.
2. **A DRI can verify/close or reject/reopen their own Finding by calling the API directly.**
   `verify_and_close_issue` and `reject_and_reopen_issue` have no role check and `issues_update`
   lets the assigned DRI update their row. The app never offers it, but it defeats the
   "no Finding closes on self-reporting alone" guarantee for anyone using the API.
Both are fixed by **migration 0041** (see #32) rather than in this change. Until it is applied to
the live database the test script marks them `KNOWN GAP` so it keeps guarding everything else; once
applied they simply pass and the entries in `KNOWN_GAPS` can be deleted.

### Not verified

The Android app could not be compiled in this environment (Gradle can't open a loopback socket
here), so the Kotlin changes and `MobileAccessTest` are unbuilt: needs the user's Android Studio
build and an on-device pass for each role.

## 32. Fix: review-time DRI visibility and verify/reopen role guard — migration 0041

Fixes the two pre-existing gaps listed under #31. Additive: one new policy and two
`create or replace function`s; nothing existing is narrowed.

1. **State Coordinators (and Project Admins with no `project_id`) could not see any DRI.**
   Root cause is `profiles_select` (0008): own row, Super Admin, or a Project Admin whose
   `project_id` *equals* the row's. A State Coordinator therefore saw only themselves, and a
   Project Admin with no project — every real one today, since `in_scope()` treats null as "sees
   everything" — matched nothing because `null = null` is not true. Consequences: the web's DRI
   picker (`getDris`) was empty for them, and `approve_and_assign_finding` (SECURITY INVOKER)
   raised "Selected user is not a DRI" even for a valid DRI. Note this means the review step from
   #22/#29 could not actually complete for those two roles, only for Super Admin (and a Project
   Admin who happened to have a project). Fix: `profiles_select_dris_for_reviewers` — State
   Coordinator, and Project Admin under `in_scope()`, may read **active DRI profiles only**.
   Choosing a DRI is inherent to the review action they already hold, so this exposes nothing
   beyond it. Chosen over a SECURITY DEFINER lookup because the web picker reads `profiles`
   directly, so one policy fixes the RPC and the UI with no code change.
2. **A DRI could verify/close or reject/reopen their own Finding via the API.**
   `verify_and_close_issue` / `reject_and_reopen_issue` (0024) had no role check. Added up front:
   Super Admin, Project Admin, or TPM Field Monitor only — exactly the web's `canVerify`. Bodies
   are otherwise 0024's, so the idempotent-retry behaviour the mobile sync queue relies on is
   unchanged. The guard uses `coalesce(current_user_role()::text, '')` because `null not in (...)`
   is null and would let a profile-less caller fall through.

### Verification
`node tools/db/test-mobile-role-access.js --with-migration supabase/migrations/0041_….sql` applies
the migration *inside the test's rolled-back transaction*, so it is proven against the real
schema without changing the live database: 86/86 pass. New checks confirm the policy is narrow —
a State Coordinator sees other users' DRI profiles and no other profile; Field Monitor and DRI
still see no profile but their own. Without the flag (today's live state) the same script reports
the four affected checks as known gaps.

### Rollout
**Applied to the live database on 2026-09-20** with `apply-one.js`; the test script then passed 86/86 against
the live schema with no flag. To re-apply elsewhere: `node tools/db/apply-one.js
../../supabase/migrations/0041_fix_review_dri_visibility_and_verify_role_guard.sql`. `CREATE
POLICY` briefly takes a lock on `profiles`; apply at a quiet moment. Revert: drop the policy and
re-run 0024's two function definitions.

## 33. Android: evidence photos load via signed URLs, not public URLs

**Bug.** `issue-evidence` is a private bucket (0010; deliberately — these are community evidence
photos), but the Android app built `storage.from("issue-evidence").publicUrl(path)` for every photo
it pulled. For a private bucket that URL always answers `400 {"error":"Bucket not found"}`, so a
photo only ever displayed on the device that captured it. A DRI could not see a Field Monitor's
evidence, and — once #31 let senior roles into the app to *review* field work — neither could they.
The web app was unaffected (it already used signed URLs).

**Fix (Android only, no backend change).** The app stores a stable reference (`storage:<path>`)
instead of a URL, and resolves it to a fresh 1-hour signed URL when a photo is shown, through the
signed-in session — so the existing `issue-evidence select` storage policy still decides who can
see what. Verified against the real policy per role: Super Admin / Project Admin / Field Monitor
see all sample photos, a State Coordinator only their own state's, an unassigned DRI none.
Rejected: making the bucket public (would expose community photos to anyone with a link).
Details: old public URLs already cached in Room are converted on read (no re-sync); Coil caches on
the stable path since the signed URL changes each fetch; a refresh no longer overwrites the
capturing device's local photo file with the remote reference, so its own photos work offline;
offline or no access shows the placeholder icon.

**Update (same day):** the detail screen originally displayed only the discovery-stage MOV/selfie
photos. It now also shows the DRI-response and final-verification evidence (each stage only once it
has some), with the DRI's name/date and the verifier's outcome and note. That needed one more fix:
the server's verification result (photos, GPS, confirmed / not resolved, comment) was never built
from the detail pull — only the device that ran the verification wizard had it — so it is now
derived from the verification-stage photos/GPS and the newest "Verified and closed" / "Final
Verification — Not Resolved" history event (`IssuePullDto.toVerification`, unit-tested).

**Housekeeping (done 2026-09-20):** `issue-evidence` held 36 orphaned objects (~50 MB of real camera
photos, 23 Aug – 14 Sep) from Findings deleted in the earlier demo-data cleanup — no `issues` row and
no `issue_photos` row, so unreachable from any screen. They were downloaded with sizes verified to a
local backup folder and then removed through the Storage API; the bucket now holds only referenced
files. Note `cleanup-demo-data.js` removes rows, not storage objects — after any future data wipe,
clear the bucket too.

Unbuilt at time of writing (Gradle can't run in the authoring environment): needs an Android
Studio build and a device check — see the Android PR.

## 34. `derive_initials()` no longer breaks Add User on non-plain names — migration 0042

**Bug.** `profiles.initials` must match `^[A-Z]{2}$`, but `derive_initials()` (0026) took the first
character of the first and last whitespace-separated words verbatim. A last word starting with
anything but a plain A–Z letter — `"Demo DRI (Health)"`, `"John (Lagos)"`, a stray `"-"` or digit,
and, more importantly for this program, **accented or dotted Yoruba/Igbo letters (`"Ọlá Ṣola"`)** —
violated the check, and the whole account creation failed with the unhelpful "Database error
creating new user". Found when creating demo accounts named with a parenthesised suffix.

**Fix.** Decompose accents (NFD), keep only the A–Z letters of each word, ignore words left with no
letters, then first letter of the first and last remaining word (single word doubles; nothing left
→ `XX`). Fixed in the database rather than as a form-validation message because the form can't
predict what the database will reject, and a name like `Ọlá` is perfectly valid.

**Verified** (`tools/db/test-derive-initials.js`, rolled-back transaction): 7 previously failing
names now give valid initials; every name the old function already handled gives the *identical*
result — all real profiles in the database (only counts printed) plus 300 random plain names.
Stored initials on existing profiles are untouched; only newly derived ones change.

## 35. Sample-data tooling (`tools/db/sample-findings.js`)

`node sample-findings.js create | photos | remove` creates a small, clearly labelled set of demo
Findings (every workflow status, real wards, per-stage GPS, evidence photos) attributed to three
`Demo …` accounts — never to real people — for screenshots and training, and removes exactly what it
made, including stored images. Counters are adjusted only for the buckets of the Findings deleted
(floored by a pre-`create` snapshot, never restored wholesale — a wholesale restore would clobber the
numbering of any real Finding registered in between); `remove --dry-run` previews, `--also CODE`
adds a real test Finding (e.g. one registered from a phone while taking screenshots). Database rows
are deleted first, stored files only after the transaction commits. Photos are
generated illustrations stamped "SAMPLE IMAGE" (`make-sample-photos.py`, Pillow), deliberately not
photographs, so they can't be mistaken for field evidence. Rows keep `updated_at = now()` on
purpose: an already-synced phone only pulls rows newer than its watermark. Inserted directly (no
RPCs), so no notifications or emails fire. While samples exist, any real user whose scope covers
them (Super Admin, Project Admin, Field Monitor, unscoped roles) will see them — keep the window
short. The `issue-evidence` bucket also held 36 orphaned real camera photos from Findings deleted
in the earlier demo-data cleanup; they were backed up locally and removed on 2026-09-20.

## 36. Android: CameraX 1.3.4 → 1.4.2 for 16 KB page-size devices

Android Studio flagged the debug APK as "not compatible with 16 KB devices". Reading the ELF program
headers of the APK's two native libraries showed exactly one offender: CameraX's
`libimage_processing_util_jni.so` (camera-core 1.3.4 ships it with 4 KB LOAD alignment in all four
ABIs; `libandroidx.graphics.path.so` was already 16 KB aligned). It only matters on devices that use
16 KB memory pages (a few current phones, and Google Play's requirement for new updates — not a
concern for direct APK distribution today, but it will be).

Chose **1.4.2** after downloading the published AARs and checking each: everything from 1.4.0 on is
aligned; 1.4.2 is the last 1.4 release, the smallest API jump, and fits the project (minCompileSdk
34 vs 35, minSdk 21 vs 26, no newer AGP needed). The app's only CameraX use is
`CameraCaptureModal.kt` (ImageCapture / Preview / ProcessCameraProvider / PreviewView), all
unchanged core APIs. `android/tools/check-16kb-alignment.py` checks any built APK — rerun it after
future dependency bumps. Verification of the upgrade itself needs a build and real camera use (the
authoring environment can't run Gradle).
