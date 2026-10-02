# RUTF platform — decisions log

TPM-era decisions are in `web-platform/DECISIONS.md` and still apply unless overridden here.

| # | Date | Decision | Why |
| --- | --- | --- | --- |
| R1 | 2026-10-02 | Model is **facility recording + supervisor checks** (brief v0.3), not sample-and-verify by external monitors. | Najib: data is recorded by government facility staff; no community-level collection. |
| R2 | 2026-10-02 | Proposal runs on generated dummy data (`data/dummy/`), every row tagged `DUMMY`. | Najib: real DRIs, OTP list, stores, DHIS2 not at hand; replace during implementation. |
| R3 | 2026-10-02 | One repo for both apps: `web-platform/` + `android/`, fresh history, secrets excluded by root `.gitignore`. | Brief §2. |
| R4 | 2026-10-02 | Renamed only user-visible identity: "RUTF Monitoring", `applicationId org.tpmnigeria.rutf`; Kotlin package `org.tpmnigeria.tpm` kept. | Brief §2.5: renaming packages adds risk without value. |
| R5 | 2026-10-02 | `tpm_supervisor` label is now "Supervisor"; enum values unchanged. | Brief §4; enum names are stored on device (Room), so values are never renamed. |
| R6 | 2026-10-02 | Supabase publishable key used as the anon key in untracked `web/.env.local` and `android/local.properties`. | Publishable keys are client-safe; RLS is the boundary. |
| R7 | 2026-10-02 | Signed adjustments allowed only for `txn_type = 'adjustment'`; month-end count shortfalls are recorded as adjustments pending supervisor confirmation. | Keeps the ledger replayable; corrections are visible, never silent. |
| R8 | 2026-10-02 | Migrations applied with `tools/db/migrate.js` (direct DB connection) and recorded in `supabase_migrations.schema_migrations`, so the GitHub integration treats them as applied. | Integration did not fire after two pushes. |
| R9 | 2026-10-02 | Duplicate version `0031` split: `0031_state_coordinator_sector_schema.sql` → `00311_…`. | The Supabase CLI/integration requires unique versions; the two 0031 files are independent. |
| R10 | 2026-10-02 | `seed.sql` replaced: TPM sectors deactivated (kept), RUTF levels SST / LST / OTP inserted. | Old seed predated the `abbr` column and failed; brief §4. |
| R11 | 2026-10-02 | Public landing page at `/` follows the mockup's layout, but its copy follows brief §1: "RUTF Monitoring" (not DTAP), State → LGA → OTP plus supervision, no QR codes or per-child tracking. Photos cropped from `Landing page pictures/` to remove the baked-in login boxes and captions. | Mockup promised out-of-scope DTAP features; public copy must not over-claim. |
| R12 | 2026-10-02 | Login page and sidebar restyled to the landing page: RUTF shield mark replaces the TPM logo; shared public copy in `web/src/lib/rutf-copy.ts` reuses mockup wording that fits the brief (taglines, "Digital Traceability & Accountability Platform", the four why-it-matters points). Login stat row is now LGAs / Wards / Health facilities, zeros hidden. | Najib asked to carry the valid RUTF-DTAP mockup wording across; one copy source keeps both pages consistent. |
