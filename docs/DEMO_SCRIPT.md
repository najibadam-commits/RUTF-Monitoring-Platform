# Demo script — RUTF-DTAP Monitoring Platform (proposal)

A 20-minute live demonstration that walks a review panel along one sachet's journey and shows, at
each step, the proof behind a proposal claim. Each step names the screen, the clicks, what to say,
and what the panel should see. Figures quoted are from the demo data (marked DUMMY) and move a
little every night as the automatic checks run — read them off the screen, don't memorise them.

**The story in one line:** every sachet is recorded at every hand-over, checked automatically,
followed to verified closure, and reported — on one trusted record, even where there's no signal.

---

## Before the demo (15 minutes)

| ✔ | Check |
| --- | --- |
| | Present from the **production build**, not the dev server: screens open in 1–4 s instead of compiling on first visit. In `web-platform\web` run `npm.cmd run demo` (builds, then serves http://localhost:3001; keep that window open), and present from **http://localhost:3001**. Run it again after any code change. The dev server on :3000 can stay open for editing. |
| | Signed in as **Super Admin** in the browser you'll present from; a second tab signed in as the **DUMMY Viewer** (zainab.mohammed@rutf-demo.example) if you'll show data requests from both sides. |
| | Phone: **RUTF-DTAP 1.1** installed (GitHub release `v1.1-proposal`), signed in as a DUMMY facility user, ledger downloaded. |
| | Data access requests reset: in `web-platform\tools\db` run `node seed-demo-download-requests.js` (two requests waiting to approve live). |
| | Phone sync reports refreshed: in `web-platform\tools\db` run `node seed-demo-sync-status.js` (reports age; after 3 days a phone shows as "not syncing"). |
| | Nightly checks paused: in `web-platform\tools\db` run `node demo-pause-checks.js --pause` (the DUMMY ledger ends 30 Sept, so each night the checks flag every OTP site for late reporting in the new month; this pauses them and removes only those after-ledger Findings). `node demo-pause-checks.js` alone shows the state. |
| | Monthly Programme Report: open it once and press **Print / save as PDF** to check the print view. |
| | Browser zoom 100 %, window at least 1366 px wide; close other tabs and notifications. |
| | Know your fallback: if the network drops, the phone app still works offline — that is part of the story. |

---

## 1. The platform at a glance — 1 min

**Screen:** landing page `http://localhost:3001` → scroll to **How it works** and **Governance**.

- "One chain of custody, from the State store to the child": State store → LGA store → OTP →
  supervision → Findings.
- Governance: role-based access, nothing deleted (only voided with a reason), exports by
  approval, designed for the NDPA 2023.

**Proof:** the five steps and the six built-in safeguards on the page.

## 2. Recording at the facility, even offline — 3 min

**Screen:** the phone app.

1. Show the sign-in: *"Works offline… syncs when you're back online."*
2. Home: **"✓ Everything is synced"**, the facility card with **stock on hand**, the action buttons
   (Receive Stock, Daily Dispensing, Stock Count, Record Loss).
3. Turn on **airplane mode**, record a **Daily Dispensing** entry → Home now says *"1 entry is on
   this phone, waiting to sync"*.
4. Turn airplane mode off → it syncs by itself.

**Say:** facility staff record where the RUTF is, not where the signal is. Nothing is lost.
**Proof (web):** Administration → **Offline Sync Health** shows the phone, its app version and last
sync.

## 3. One trusted record — 2 min

**Screen:** Stock → **Stock Ledger**.

1. The supply-chain totals: State store → LGA stores → OTP sites.
2. Click the tile **Under 1 month of stock** → the list filters.
3. Open an LGA store (e.g. **Dutsi LGA Nutrition Store**): **Months of stock**, **Last 30 days**
   movement, **Month by month** (count against ledger), and the **Ledger integrity** line —
   *entries are never edited or deleted*.
4. Back to the list, click the tile **Holding expired stock** → open **Babbanduhu Health Clinic**
   (Malumfashi): lot DUMMY-RUTF-2401 shows **Expired 2026-08-31** with sachets still on hand.

**Then:** **Transfers** → **Delivered in full** (about 98 %); click **Received with a discrepancy**
and follow a transfer's **Finding** link.

**Say:** balances are computed from entries, never typed in. A short delivery can't hide.

## 4. Problems found automatically — 3 min

**Screen:** Overview → **Overview Dashboard**.

1. **Needs attention:** the month's figures turned into actions, critical first (critical Findings,
   expired stock, Findings past target, low stock…). Each button goes to where it's fixed.
2. The compact KPI rows: stock position, last-mile dispensing, reporting, Findings.
3. **Findings pipeline:** from awaiting review to verified & closed, with reopened cases in red, in
   one bar.

**Then:** **Findings Register** → the strip **What is being found** (late reporting, stock variance,
short dispensing, transfer mismatch…) — the robot icon marks automatic checks.

**Say:** every night the ledger is checked against the programme's thresholds, and every
supervision visit as it's recorded. Nobody has to go looking for problems.

## 5. Every problem followed to closure — 3 min

**Screen:** Overview → **Corrective Action Tracker**.

1. The five stages in colour, on one row: **Assigned** (blue) → **Being addressed** (orange) →
   **Action recorded** (green) → **Verified & closed** (black), and **Reopen case** (red).
2. Filter **LGA = Daura**, tick **Past target only** → *"this is the list for Monday's meeting."*
3. Click a person in **Who holds the open actions** → their board.
4. Open a card → the Finding's full history.
5. The red **Reopen case** stage: a fix the supervisor could not verify at the follow-up visit goes back to
   the responsible person, with the reason in its history (four DUMMY cases, one in Daura).

**Say:** findings are for review, not accusation — but every one has an owner and a deadline
(30 days) until a supervisor verifies it closed.

## 6. Accountability you can measure — 2 min

**Screen:** Overview → **Accountability Scorecard**.

1. The **Accountability score** (out of 100) and its **6-month trend**.
2. **LGA league table:** on track / needs attention / needs support. Click an LGA → its late actions
   in the tracker.
3. **Facilities needing support**.

**Say:** the score is deliberately simple — half closure, half timeliness — so every LGA knows
exactly how to improve it. *(The 80/60 bands are for the State team to confirm.)*

## 7. The child at the end of the chain — 2 min

**Screen:** Stock → **Last-Mile Dispensing**.

1. **Children seen**, **new admissions**, **sachets dispensed against prescribed**.
2. The **register check**: the supervisor's count of the paper register against the app.
3. **Children reached, last 6 months**.

**Then:** Supervision → **Risk-Based Supervision** → **Visits verified on site by GPS** (about
97 %) → **Risk-Based Planner**: what drives each facility's risk score.

**Say:** aggregate figures only — no child's name or ID ever enters the platform.

## 8. The national system tells the same story — 1 min

**Screen:** Analytics → **DHIS2 Triangulation**.

- **Reports agreeing with the ledger** (about 91 %), **DHIS2 reporting coverage**, agreement by
  indicator, and the reports that differ — for review, since either system may hold the error.

## 9. Reporting and data protection — 2 min

**Screen:** Reporting → **Programme Reporting** → **Open the … report**.

1. The **Monthly Programme Report**: summary in plain sentences, eight sections, LGAs needing
   support, actions for next month. **Print / save as PDF.**
2. **Data Access Requests:** approve one of the two waiting DUMMY requests live — *data leaves
   only with approval, scoped, downloadable once, and on record*.

## 10. Ready to scale — 1 min

**Screen:** Administration → **Programme Administrators**, then **Users & Access**.

- The Katsina programme card; **Bringing another state on** in five steps, no new software.
- Role cards: who can do what; the database enforces it for web, app and API.

**Close:** "From the store shelf to the child, every sachet accounted for — ready for Katsina today,
and for the next state tomorrow."

---

## Likely questions

| Question | Where to show it |
| --- | --- |
| What if there's no network? | Phone in airplane mode (step 2); Offline Sync Health. |
| Can someone change the figures afterwards? | Stock Ledger integrity line; Audit Trail (Administration). |
| Can a Finding be deleted or quietly dropped? | No: there is no Delete in the app, and the database refuses it for every role (permissions test: 202 of 202). A mistaken Finding is returned for correction or edited, with its history; a fix that doesn't hold goes to **Reopen case**. |
| Who decides the limits? | Master Data → Thresholds (variance, short-dispensing, 30-day target); Settings → go-live readiness. |
| Is child data collected? | No — aggregate tallies only; Governance on the landing page; DPIA draft. |
| How does it fit DHIS2? | DHIS2 Triangulation; monthly extract upload. |
| Can partners get the data? | Data Access Requests (approval, scope, one-time download). |
| What does go-live need? | Settings → **Go-live readiness** (domain email, clearing demo data, teams, thresholds, DPIA, UAT, signing key). |

## After the demo

- Reset the data access requests: `node seed-demo-download-requests.js` (in `web-platform\tools\db`).
- Put the reopened cases back, if wanted: `node seed-demo-reopened.js --remove` (in `web-platform\tools\db`).
- Turn the nightly checks back on: `node demo-pause-checks.js --resume` (in `web-platform\tools\db`).
- Nothing else changes the demo data except the nightly checks (and the phone reports ageing).
- Before real pilot data: `node seed-demo-sync-status.js --remove` and `node seed-demo-download-requests.js --remove`, with the rest of the DUMMY data.
