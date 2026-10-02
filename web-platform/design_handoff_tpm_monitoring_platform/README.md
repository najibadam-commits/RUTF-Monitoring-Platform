# Handoff: TPM Monitoring Platform (with Supabase backend)

## Overview
A Third-Party Monitoring (TPM) platform for tracking field-reported issues across states/LGAs in Nigeria: login, role-based admin shell, KPI dashboard, live GIS issue map, issue workflow (report → assign → respond → corrective action → verify/close), user & role management, and Project Admin management.

## About the Design Files
The files in this bundle (`TPM Monitoring Platform.dc.html`, `styles.css`, `mock-data.js`) are **design references built in HTML/JS with an internal templating runtime** — they show intended look, layout, and interaction, and are **not production code to copy directly**. All data is mocked/generated client-side (see `mock-data.js`). The task is to **recreate this design in a real app** (React/Next.js recommended, or your team's standard stack) wired to **Supabase** for auth, database, and storage — using the codebase's own conventions rather than porting the HTML.

## Fidelity
**High-fidelity**: colors, spacing, typography, and component states are final. Recreate the UI pixel-perfectly using the target stack's component patterns; treat interaction/workflow logic below as the functional spec.

## Why Supabase fits this design
- **Auth**: Supabase Auth (email/password) maps directly to the login screen and the 3-tier role system.
- **Postgres + RLS**: role-based visibility (Super Admin / Project Admin / Viewer) should be enforced with Row Level Security policies, not just hidden UI — the client must not be the only gate.
- **Storage**: issue photo evidence (`photoCount` in mock data) maps to a Supabase Storage bucket, one folder per issue.
- **Realtime**: the GIS map and dashboard KPIs can subscribe to `issues` table changes for live updates instead of polling.

## Roles & Permissions (must be enforced server-side via RLS, not just UI hiding)

| Capability | Super Admin | Project Admin | Viewer |
|---|---|---|---|
| View dashboards, map, analytics, issues | ✅ | ✅ (own project scope) | ✅ (read-only) |
| Create/edit/delete issues, assign, respond, verify | ✅ | ✅ (own project) | ❌ |
| Users & Role Management | ✅ (all users) | ✅ (own project's users) | ❌ hidden from nav + route |
| Project Admin Panel (create/reset/deactivate Project Admins) | ✅ | ❌ | ❌ hidden |
| Settings | ✅ | ❌ hidden | ❌ hidden |

Viewer is the floor role: no create/edit/delete/upload/assign anywhere in the app. Enforce this with Postgres RLS policies keyed off a `role` claim/column, in addition to hiding nav items and blocking routes client-side — route guards alone are not sufficient security.

## Screens / Views

### 1. Login
- Email + password fields, role selector used only in this prototype to preview each role (Super Admin / Project Admin / Viewer) — in production this is replaced entirely by Supabase Auth (`auth.users` + a `profiles.role` column), not a user-facing choice.

### 2. App Shell
- Left sidebar nav (icon + label items), top bar with search, notifications bell (dropdown), user menu.
- Nav items, in order: Dashboard, Issue Map, Issues, Analytics, Users & Roles (hidden for Viewer), Project Admin Panel (Super Admin only), Settings (Super Admin only).

### 3. Dashboard
- 8-card KPI grid (totals by status/priority etc.).
- Live Issue Map preview panel.
- Trend line chart (issues over time).
- Status/priority/category breakdown charts.
- Recent activity timeline.

### 4. Issue Map (GIS)
- Leaflet map, light OpenTopoMap basemap, issue pins colored by status/priority, clustered by state/LGA using the `mapX/mapY`-style approximate coordinates plus real `lat/lng` in mock data.

### 5. Issues List + Detail
- Filterable/searchable table (by state, LGA, category, priority, status).
- Detail drawer/modal: description, photos, history timeline, and action buttons gated by role and current status:
  - `canAssign` (status = New) → Assign to DRI
  - `canRespond` (status = Assigned) → Submit DRI response
  - `canCorrective` (status = In Progress) → Record corrective action
  - `canVerify` (status = Resolved) → Verify & close
  - Super Admin only: Edit Submission, Delete (with an audit trail — see History below)
  - All the above are hidden entirely for Viewer.

### 6. Users & Role Management (hidden for Viewer)
- Table of users (name, email, phone, role, status, last login).
- Super Admin: add user, per-row edit/remove with confirm dialog, assign any role including Project Admin.
- Project Admin: manage users within their own project scope only; cannot assign Project Admin role or see global data.

### 7. Project Admin Panel (Super Admin only)
- Create/edit Project Admin accounts, reset credentials, deactivate/remove.

### 8. Settings (Super Admin only)
- Platform configuration (notification prefs, etc. — see `TPM Monitoring Platform.dc.html` Settings section for exact fields).

## Data Model (derive Supabase schema from this — see `mock-data.js` for exact shapes)

- **profiles** (extends `auth.users`): id, name, email, phone, role (`super_admin` | `project_admin` | `viewer` | `tpm_supervisor` | `dri`), project_id (nullable, for Project Admin scoping), status (active/inactive), last_login.
- **states**: name, lga list (or a separate `lgas` table with `state_id` FK).
- **categories**: the 10 fixed issue categories in `mock-data.js`.
- **issues**: id, category, description, state, lga, ward, lat, lng, reported_at, reported_by (FK profiles/tpm), priority, status, assigned_dri (FK profiles), dri_response, corrective_action, verified_by, resolution_date, photo_count.
- **issue_history**: issue_id FK, date, actor, action, note — append-only audit trail (also backs the Edit/Delete history tracking added for Super Admin).
- **issue_photos**: issue_id FK, storage_path (Supabase Storage bucket).

Suggested RLS pattern: a `role` and `project_id` column on `profiles`, then policies on `issues`/`profiles` like `USING (role = 'super_admin' OR project_id = auth.jwt() ... )`, and a blanket `WITH CHECK (role != 'viewer')` on any INSERT/UPDATE/DELETE policy so Viewer can never write regardless of what the client sends.

## State Management
- Current view/route, logged-in user + role, selected issue, modal open/close state, table filters/search, form state per modal (assign/respond/corrective/verify/edit user/etc.).
- Replace all of this-file's in-memory `generateIssues()` mock data with live Supabase queries (`select`, `insert`, `update`) + Realtime subscriptions on `issues`.

## Design Tokens
See `styles.css` — Nocturne dark theme:
- `--color-bg: #161826`, `--color-surface: #232532`, `--color-text: #e9e9ed`
- Status colors: New `#b2b6ca`, Assigned `#b5abfc`, In Progress `#d7a24a`, Resolved `#6fb98a`, Verified/Closed `#e7e5fe`
- Priority colors: Critical `#d97a6a`, High `#d7a24a`, Medium `#b5abfc`, Low `#9397ab`
- Full spacing/typography/shadow scale defined at the top of `styles.css`.

## Assets
No external image assets — icons are Phosphor Icons (`ph` classes) loaded from a CDN; map tiles are OpenTopoMap (Leaflet). No brand-restricted assets used.

## Files
- `TPM Monitoring Platform.dc.html` — full app markup + logic (single-file prototype)
- `mock-data.js` — mock data generator; **use only as the schema reference**, replace with Supabase queries
- `styles.css` — design tokens and component styles
