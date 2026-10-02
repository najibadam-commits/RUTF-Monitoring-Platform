# TPM Monitoring Platform — Supabase Implementation

Production implementation of the design in [`design_handoff_tpm_monitoring_platform/`](design_handoff_tpm_monitoring_platform),
wired to a real Supabase backend (Auth, Postgres + PostGIS, Storage, Realtime).
See [`DECISIONS.md`](DECISIONS.md) for every place an ambiguity in the design
spec was resolved, and why.

## Repository layout

```
web/                      Next.js 16 (App Router, TypeScript, Tailwind) application
supabase/
  migrations/             Versioned SQL migrations, applied in order (0001 → 0014)
  seed.sql                Reference data (categories) — safe to run anywhere
  full_migration.sql      All migrations concatenated, for pasting into the SQL Editor
tools/
  db/                     One-off scripts: apply migrations, introspect schema, seed demo data
  gis-import/             Imports the Nigeria boundary SpatiaLite files into PostGIS
design_handoff_tpm_monitoring_platform/   Original design reference (do not edit)
```

## What's implemented

- **Auth**: Supabase Auth (email/password), session persistence + refresh via
  `proxy.ts` (Next.js 16 renamed Middleware → Proxy), password reset flow.
- **Database**: full Postgres schema — `profiles`, `projects`, `states`,
  `lgas`, `wards`, `categories`, `issues`, `issue_history`, `issue_photos`,
  `notifications`, `settings` — with RLS enabled and policies on every table.
- **PostGIS**: real Nigeria administrative boundaries (37 states, 774 LGAs,
  9,403 wards) imported from user-supplied SpatiaLite layers, with a
  `resolve_administrative_location(lat, lng)` point-in-polygon function and
  GeoJSON boundary RPCs for map rendering.
- **Storage**: private `issue-evidence` bucket, one folder per issue, RLS'd
  the same way as the `issues` table; served via signed URLs only.
- **Realtime**: `issues`, `issue_history`, `notifications` published; the app
  subscribes and refreshes affected views automatically.
- **RBAC**: 5 roles (`super_admin`, `project_admin`, `tpm_supervisor`, `dri`,
  `viewer`) enforced at the RLS layer (the real boundary) and mirrored in the
  frontend (`web/src/lib/rbac.ts`) for nav/UI — see DECISIONS.md #1.
- **Workflow**: Discovery → Assign → DRI Response → Corrective Action →
  Verify/Close, each transition a Postgres RPC that atomically updates the
  issue and appends to the immutable `issue_history` audit trail.
- All 8 screens from the design: Dashboard, GIS Map, Issues List/Detail, TPM
  Sub-Panel, Analytics, Users & Roles, Project Admin Panel, Settings.
- **Data Sets** (added post-launch by request): Settlement Lists and
  Activity Sites, managed by Super Admin and Project Admin, with Project
  Admin submissions requiring Super Admin approval before going live —
  see DECISIONS.md #6a. Exposed to the field mobile app via Supabase's
  standard REST API (`GET /rest/v1/settlements?status=eq.approved`).

## Local setup

### 1. Environment variables

```bash
cp web/.env.local.example web/.env.local
```

Fill in from your Supabase project's **Settings → API**:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server-only — never exposed to the browser
NEXT_PUBLIC_SITE_URL=http://localhost:3000   # used to build auth email links
```

### 2. Apply the database schema

Either:
- **SQL Editor** (simplest): paste [`supabase/full_migration.sql`](supabase/full_migration.sql) into
  Supabase Dashboard → SQL Editor → Run, **or**
- **Direct connection** (what this implementation used — see `tools/db/`):
  ```bash
  cd tools/db && npm install
  # DATABASE_URL in tools/db/.env — the Session Pooler connection string
  # (Settings → Database → Connection string), IPv4-compatible
  node migrate.js
  ```

Adding a migration later (after the first apply)? Use `node apply-one.js <path-to-new-migration.sql>` —
**never re-run `migrate.js`**, it drops and recreates `issues`/`profiles` on every run.

### 3. Import Nigeria boundary data (states/LGAs/wards)

```bash
cd tools/gis-import && npm install
# edit the SRC paths in import.js to point at your state.sqlite/LGA.sqlite/Ward.sqlite
node import.js --states KT   # RUTF pilot: Katsina only (omit the flag for all of Nigeria)
```

Then load the RUTF reference data (facility registry + lots; migration 0100 seeds the product,
dosing rules and thresholds):

```bash
cd tools/db && node import-reference.js   # reads ../../../data/dummy/facilities.csv, product_lots.csv
node seed-demo-accounts.js                # demo sign-ins from people.csv (shared password in .env.demo)
node import-ledger.js                     # dummy transfers, ledger and OTP dispensing (needs the demo accounts)
```

Tests: `node test-ledger.js` (M2), `node test-findings.js` (M3) and `node test-mobile-role-access.js`.

### 4. Seed demo accounts + sample issues (optional, for local testing)

```bash
cd tools/db
node seed-demo.js
```

Creates one account per role, all sharing the password printed at the end,
plus ~70 sample issues spread across every workflow stage.

### 5. Run the app

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000 — you'll land on `/login`.

## Deploying

1. Push `web/` to your platform of choice (Vercel is the path of least
   resistance for Next.js). Set the same environment variables as above in
   the platform's dashboard — **never** commit `.env.local`.
2. Set `NEXT_PUBLIC_SITE_URL` to the deployed domain (used in password-reset
   email links).
3. In Supabase Dashboard → Authentication → URL Configuration, add the
   deployed domain to **Redirect URLs** (needed for `/auth/confirm`).
4. Run the migrations against your production Supabase project the same way
   as local setup, step 2 — this repo's migrations are idempotent-safe to
   re-run except `migrate.js`'s initial drop step (see the warning above).

## Known limitations / follow-ups

- Password reset emails use Supabase's default mailer — configure custom
  SMTP in the Supabase dashboard before relying on this in production
  (default rate limits are low).
- `resetUserPasswordAction` uses the standard `resetPasswordForEmail` flow;
  there's no "generate and display a temporary password" option, since
  Supabase Auth doesn't support setting a known password without the user's
  own confirmation.
- Full-text `description`/`code` search on Issues uses `ilike` — fine at
  current scale, consider `pg_trgm` + a GIN index if the issues table grows
  into the hundreds of thousands of rows.
- Photo **upload** UI isn't built yet — `issue_photos` + the `issue-evidence`
  bucket + RLS/storage policies are fully wired, and the issue detail page
  already renders existing photos via signed URLs, but there's no "attach a
  file" control in the Report Issue or issue detail screens. The design
  prototype has the same gap (its photo grid is static placeholders). Next
  step: a file input in `ReportIssueButton`/`IssueDetailClient` that uploads
  to `issue-evidence/{issue_id}/{filename}` via the browser Supabase client,
  then inserts a matching `issue_photos` row.
- Ward-level boundary rendering on the GIS map is wired at the RPC level
  (`get_ward_boundaries`) but not yet triggered from the UI (LGA boundaries
  load on state selection; wards would need a further LGA-selection step) —
  straightforward to add if ward-level map detail becomes a priority.
