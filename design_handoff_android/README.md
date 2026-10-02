# Handoff: TPM Process Monitoring App — Android

## Overview
A field-monitoring app for tracking Total Program Management (TPM) process issues: Field Monitors register issues on-site, Designated Response Individuals (DRIs) respond/resolve, and the original Field Monitor gives final verification before an issue closes. Includes org-wide issue visibility (list + map), offline queuing, and SLA/severity tracking.

## About the Design Files
The bundled files (`TPM Field App.dc.html`, `issue-map.jsx`) are **design references built in HTML** — high-fidelity interactive prototypes showing exact look, copy, and behavior. They are NOT production code to port directly (they use a template-binding runtime, not React/Kotlin). The task is to **recreate this design natively for Android** (Kotlin + Jetpack Compose recommended) using Android's own patterns — real navigation (Navigation Compose), real local persistence (Room) for the offline queue, real GPS (FusedLocationProviderClient), real camera capture (CameraX), and a real backend integration for sync (endpoints TBD by the team — this package defines the client-side contract, not the API).

## Fidelity
**High-fidelity.** Colors, type, spacing, copy, step order, and validation rules below are final — build pixel-close to this spec, not just "inspired by" it.

## Design Tokens
- Background: #f2f2f3 · Surface (inputs/cards): #e9e9ea · Text: #1d1f20 · Divider: #1d1f20 @ 16% opacity
- Accent (primary brand blue): #5980a6 — ramp: 100 #eef6ff, 200 #d6ebff, 300 #b5d9fd, 400 #94bce3, 500 #749dc4, 600 #597ea3, 700 #416180, 800 #2c455d, 900 #1d2d3d
- Neutral ramp: 100 #f5f5f8, 200 #e7e7ea, 300 #d4d4d7, 400 #b7b7ba, 900 #2b2b2d
- Heading font: Barlow Condensed, weight 600 (used for titles, card titles, nav labels, section heads — Google Font, available via Android's downloadable-fonts API)
- Body font: Barlow (Google Font)
- Radius: small/medium rounded corners on inputs and cards (~6–8dp equivalent)
- Signature motif: "blueprint" cards — a thin divider-colored border (1px) with four small L-shaped corner brackets (~8dp arms, accent-colored) drawn at each corner of key cards/buttons. Recreate as a reusable Composable modifier (`Modifier.blueprintCorners()`) drawing 4 corner brackets via Canvas/DrawScope.
- Buttons: primary = accent fill / bg text; secondary = surface fill / divider border; ghost = accent text, no border. Disabled state: 45% opacity, non-interactive.
- Tags/pills: rounded-pill, small caps-ish label, colored by status/severity (see Status & Severity System below).

## App Structure & Navigation
Single Activity, Compose Navigation. Bottom nav bar (5 tabs, visible on top-level screens only): Home, Issue List, Map, Notifications, Sync Queue. A shared top header shows: back arrow (hidden on top-level screens), a small square "blueprint" app mark + screen title (+ role pill on Home), and a circular avatar button (initials) that opens a bottom sheet.

### Roles
Two roles for this build: **Field Monitor** and **DRI**. The signed-in user's role drives which Home CTA and dashboard KPIs show. (A demo/dev build may want a role switcher in the profile sheet; a shipped app would derive role from the authenticated account.)

## Screens

### 1. Login
- Center-top: blueprint-bordered 56dp square with app mark icon (see App Mark below), app name "TPM Process Monitoring" (H1, Barlow Condensed), subtitle "Field Monitoring & Issue Resolution" (muted, small).
- Username field, password field (masked), inline "Forgot password?" ghost button (left-aligned).
- Full-width primary "Log in" button with blueprint corners.
- Footer caption: "Your role and profile are detected automatically after login."
- Validation: username + password both required to submit; show inline error text (accent-800 color) on failure.

### 2. Home (per role)
- Greeting: "Good day," (muted) + user's name (H2).
- Field Monitor: full-width primary CTA "Register New Issue" (+ icon) → New Issue flow.
- DRI: full-width primary CTA "Look Up Issue ID" (+ search icon) → DRI Response flow.
- KPI grid: 2-column grid of blueprint cards, each showing a big number + label (e.g. counts by status/severity, overdue count). Tapping a KPI navigates to Issue List pre-filtered.
- "Recent Issues" list below: rows with Issue ID (bold), site + date reported (muted), and on the right a status tag + an "overdue" outline tag when applicable.

### 3. Issue List
- Horizontal scrolling row of filter chips (status/severity/overdue filters) — active chip filled, others outlined.
- Empty state: centered muted text "No issues in this filter yet."
- Rows: Issue ID (bold), category · site (muted), date reported (muted, smaller) on the left; status tag + optional overdue tag stacked on the right. Tap → Issue Detail.

### 4. Issue Detail
- Header card (blueprint, with corner brackets): category kicker (small caps, accent) + status tag top row; Issue ID (large, heading font); severity tag + SLA/overdue tag row; site · ward, LGA, state (muted); full description paragraph; "Reported by {name} · {date}" meta line with person icon.
- "Evidence" section: 2-column grid of two blueprint image-placeholder tiles (4:3 aspect), one labeled "MOV Photo" one "Selfie," each with a placeholder icon (camera / person) — swap for the actual captured photos in the native build.
- "Geographic Records" section: one row per GPS capture across the issue's lifecycle (discovery, DRI action, verification) — pin icon, capture label (muted), monospace lat/lng coordinates, and a "±Nm" accuracy pill.
- "Case History" section: vertical timeline — dot + connecting line per event, each with event name (bold), "{user} · {date} {time}" (muted), and location (muted).
- Sticky bottom CTA: contextual primary button — "Respond to Issue" (DRI, if new/ongoing/reopened), "Verify Resolution" (Field Monitor, if pending verification) — or, right after a Field Monitor submits a new issue, a secondary "Close & Back to Home" button that returns to Home.

### 5. Register New Issue (Field Monitor) — 6-step wizard with progress bar + step label
1. **Location**: five cascading dropdowns — State → LGA → Ward → Settlement → Activity Site. Each is disabled until its parent is chosen; choosing a parent resets and repopulates its child's options. All five required.
2. **Issue Details**: Category dropdown (Commodity Stockout, Cold Chain Failure, Health Worker Absenteeism, Infrastructure Damage, Data Discrepancy, Service Denial, Other); Severity segmented control (High/Medium/Low — drives the SLA clock, see below); Description textarea with a "Speak instead" voice-to-text button; Date of registration (date picker, capped at today). All required.
3. **GPS Capture**: blueprint card showing captured lat/lng (monospace) + accuracy pill once captured, or "Not captured yet." Full-width button opens a GPS modal (pulsing radar animation → coordinates + accuracy; low-accuracy warning + "Recapture"/"Use Location" choice). Required to proceed.
4. **MOV Photo**: single evidence photo capture (48dp icon tile + label/hint + capture button). Opens a camera modal — **camera capture only, no gallery/upload**, to preserve evidence integrity — with viewfinder → captured state → Retake/Use Photo. Required.
5. **Selfie**: identical capture pattern to MOV Photo, confirms the Field Monitor's on-site presence. Required.
6. **Review & Submit**: read-only summary card of all entered data; submit generates a unique Issue ID (format `{STATE_CODE}-HLT-{YEAR}-{6-digit sequence}`, e.g. `LAG-HLT-2026-000052`) and routes to Issue Detail.

Each step's Continue/Submit button is **disabled until that step's required fields are filled** — inline warning text appears under the button explaining what's missing. This is compulsory validation, not a soft warning: users cannot advance or submit with required fields empty. Back button on step 1 exits the flow.

### 6. DRI Response — 6-step wizard
1. **Look Up Issue**: Issue ID text search, or pick from a list of assignable issues (status New/Ongoing/Reopened) shown below. Required: an issue must be found/selected.
2. **Response**: Designation dropdown (LGA Desk Officer, M&E Officer, Program Officer, State Coordinator); Action taken textarea (+ voice-to-text). Both required.
3. **Date & Location**: date of action + GPS capture (same modal pattern as above). Both required.
4. **Status**: segmented control, Ongoing vs Resolved (defaults to Ongoing). Hint text below explains: Resolved routes to the Field Monitor for final verification (does not auto-close); Ongoing keeps it open/visible.
5. **Evidence**: MOV photo + selfie capture, same pattern as New Issue. Both required.
6. **Review & Submit**: summary card; if status is Resolved, an extra note explains the verification handoff. Submitting updates issue status, appends a case-history event, and (if Resolved) fires a notification to the original Field Monitor.

Same compulsory-validation rule as New Issue: Continue/Submit disabled until the current step is valid.

### 7. Final Verification (Field Monitor) — 5-step wizard
1. **Look Up Issue**: search by Issue ID or pick from issues in "Resolved — Pending Verification" status. Shows the DRI's response + case history once found. Required.
2. **Confirm Resolution**: Yes/No segmented control — "Did the DRI's corrective action adequately resolve the reported issue?" If **No**, a required textarea appears: "Why does the issue remain unresolved?" (+ voice-to-text). Required: Yes selected, or No + non-empty comment.
3. **Date & Location**: date + GPS capture, both required.
4. **Evidence**: Selfie required (confirms verifier's presence); MOV photo optional (photo of the resolved condition).
5. **Review & Submit**: summary incl. confirmed/reopened outcome, comment (if No), GPS, selfie confirmation. Submitting either closes the issue ("Verified / Closed") or reopens it ("Reopened") — a reopened issue **auto-routes back to the original DRI** with a notification and re-enters their response queue.

### 8. Map
Full-screen map (Leaflet in the prototype — use Google Maps SDK or Mapbox natively) with one pin per issue, colored by severity (High/Medium/Low use the same severity tag colors as elsewhere) and an overdue indicator. Tap a pin to open that Issue Detail.

### 9. Notifications
Flat list, each row: bell icon, title (bold), body (muted), relative time (muted, smaller), and an unread dot (accent) on the right when unread. Tap navigates to the related issue and marks it read. Empty state: "No notifications yet."

### 10. Sync Queue (offline)
Top info card: "Offline-first: submissions save to this device first and sync automatically when a connection is available." + "Sync Now" button. Below: one row per queued submission (Issue ID, submission type, relative time, status pill: pending/synced). Empty state: "Nothing queued — everything is synced." A banner appears above the content area on other screens whenever there are pending items, linking to this screen.

### 11. Profile bottom sheet
Opens from the header avatar. Shows avatar + name + role/subtitle, then (demo-only) role and connectivity toggles, then a full-width "Log out" button. **In production, drop the role/connectivity toggles** — those exist only to let reviewers preview both roles and offline mode in this prototype; role comes from the authenticated account, and connectivity is detected automatically (e.g. `ConnectivityManager`), not user-toggled.

### Shared modals
- **GPS capture modal**: acquiring state (pulsing radar ring animation around the app-mark pin icon, "Acquiring GPS signal…") → result state (monospace coordinates, accuracy pill, low-accuracy warning copy) → Recapture / Use Location.
- **Camera capture modal**: viewfinder (icon placeholder + "Camera capture only — gallery upload is disabled for evidence integrity.") → Capture → captured state (checkmark + timestamp + "GPS attached") → Retake / Use Photo.
- **Voice-to-text modal**: idle (tap-to-speak mic button) → listening (animated waveform bars) → transcript review (editable textarea) → Redo / Use Text.
- **Toast**: bottom-anchored, checkmark icon + message, auto-dismiss, used for all submission confirmations.

## App Mark / Logo
A scope/target mark: a circle with four short crosshair ticks (top/bottom/left/right, outside the circle) and a checkmark inside — reads as "monitoring + verified." Drawn in the accent color, inset in a small blueprint-cornered square. Used at login (56dp) and in the header on every screen (26dp, next to the title). Recreate as a vector drawable (see the inline SVG in `TPM Field App.dc.html`'s header/login markup for exact path data) — do not substitute a generic pin or checkmark-only icon.

## Status & Severity System
- **Issue statuses**: New → Ongoing → Resolved – Pending Verification → Verified / Closed (or → Reopened → back to Ongoing, routed to the original DRI). Each has a distinct tag color (see `statusMeta`/tag classes in the DC file's script for exact class-to-color mapping).
- **Severity**: High / Medium / Low, each with its own tag color, selected at issue registration and shown throughout.
- **SLA**: due date = date reported + {High: 2, Medium: 5, Low: 14} days. When elapsed, the issue is flagged overdue (outline tag) everywhere it appears (Home recents, Issue List, Issue Detail, Map pins) and can be used as a Home KPI filter.

## State & Data Notes
- Issue ID format: `{STATE_CODE}-HLT-{YEAR}-{6-digit sequence}`. State codes: Kano→KAN, Lagos→LAG, Niger→NIG (sample data only — extend as needed).
- Location cascade sample data (State→LGA→Ward) and Settlement/Site generation logic live in the DC file's script block (`STATE_DATA`) — treat as seed/sample data, not final geographic reference data.
- Each issue carries: id, state/lga/ward/settlement/site, category, severity, description, reporter, dateReported, gpsIssue {lat,lng,acc}, status, driResponse {designation, action, date, gps, status}, verification {confirmed, comment, date, gps}, history[] (event, user, date, time, location).
- Local persistence needed: a Room (or equivalent) table for issues + a separate sync-queue table (localId, issueId, submission type, status: pending/synced, timestamp) that Field Monitor/DRI submissions write to first, then a background sync worker (WorkManager) pushes to the backend and flips status to synced.
- Compulsory step validation (see wizards above) must block navigation client-side regardless of network state.

## Files
- `TPM Field App.dc.html` — full interactive prototype, all screens/flows/copy/styles (inline styles = the exact values to match).
- `issue-map.jsx` — Leaflet map component reference (pin logic, severity color mapping) — port the *behavior*, not the Leaflet-specific code.
- `_ds_styles.css` — the design system's token stylesheet (colors, spacing, component CSS) referenced above.

## Not Covered By This Package (needs a decision from your team)
- Backend API contract (endpoints, auth, payload shapes) — this package defines only the client-side data model.
- Push notification transport (FCM setup).
- Real map SDK choice (Google Maps vs Mapbox) and API key provisioning.
