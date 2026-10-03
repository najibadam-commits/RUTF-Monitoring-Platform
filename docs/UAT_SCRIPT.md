# User Acceptance Test — RUTF-DTAP Monitoring Platform (Katsina pilot)

**M6 "done when": UAT signed by the programme lead.** This script is what the programme lead (or
their delegates) runs before go-live. Each test is done by a real user in the named role, on a
programme phone or the web, against the pilot environment. Record ✅ / ❌ and a note; any ❌ is
logged as an issue with the test number, fixed, and re-tested.

**Before UAT:** pilot accounts created and assigned to the *Katsina RUTF Pilot* project (each
facility user to one facility; each supervisor to a level and LGAs); the app installed from the
pilot build; everyone has done the training in `docs/training/`.
**Test data:** UAT uses a training store, a training LGA store and a training OTP set up for the
purpose, so live figures aren't touched. Remove them afterwards.

| Role | Tester name | Phone / browser |
| --- | --- | --- |
| Facility user — State store | | |
| Facility user — LGA store | | |
| Facility user — OTP site | | |
| Supervisor — stores | | |
| Supervisor — OTP sites | | |
| State Coordinator (reviewer) | | |
| Project Admin | | |

---

## A. Stock moves from State to OTP

| # | Who | Steps | Expected | Result | Note |
| --- | --- | --- | --- | --- | --- |
| A1 | State store | Receive Stock → Supplier delivery: 2 lots, cartons + loose sachets, waybill photo | Saved; after sync, My Stock shows the sachets by lot; the web Stock Ledger shows the receipt with the photo | | |
| A2 | State store | Issue Stock to the LGA store, 1 000 sachets | Saved; after sync, a transfer appears "in transit" on the web Transfers page | | |
| A3 | LGA store | Receive Stock → pick the transfer; lines are pre-filled; receive 980 (20 short) | Transfer marked *discrepancy*; a **transfer mismatch** Finding appears in the reviewer's queue | | |
| A4 | LGA store | Issue Stock to the OTP, 300 sachets | Transfer in transit to the OTP | | |
| A5 | OTP | Receive Stock (pre-filled), all 300 | Transfer received; OTP balance 300 | | |
| A6 | OTP | Daily Dispensing for 5 days (e.g. 10 prescribed / 10 dispensed / 3 children each day) | Balance 250; a second entry for the same day is refused | | |
| A7 | OTP | Stock Count: count 230 (ledger 250, 8% below) | The ledger figure appears only after the count is entered; after sync, one **stock variance** Finding (limit 5%). A count within 5% raises none | | |

## B. Offline and sync

| # | Who | Steps | Expected | Result | Note |
| --- | --- | --- | --- | --- | --- |
| B1 | OTP | Airplane mode: record Daily Dispensing and a Loss | "Saved — it will sync when you're online"; Home banner shows 2 waiting | | |
| B2 | OTP | Turn data on, Sync Now | Both sync **once**; the ledger shows each record once | | |
| B3 | OTP | Airplane mode on and off three times during a sync | No duplicates on the web | | |
| B4 | Project Admin | Open Offline Sync Health | The OTP user shows **OK** with the last sync time and phone model | | |
| B5 | Facility user | Record something, leave the phone offline > 1 day, then open Offline Sync Health on the web | The user shows **Waiting > 1 day** once the phone reports; the next morning the admin gets a "records waiting to sync" notification | | |

## C. Supervision

| # | Who | Steps | Expected | Result | Note |
| --- | --- | --- | --- | --- | --- |
| C1 | Supervisor — stores | Store Check at the LGA store: count one lot 15% below the ledger, answer "no stock card", stock on the floor | Review step lists *stock variance*, *no stock card*, *poor storage*; after sync the visit and 3 Findings appear on the web (Supervision → Visits) | | |
| C2 | Supervisor — stores | Same visit, GPS taken away from the store (> 150 m) | Visit flagged *outside the geofence* on the web; no extra Finding | | |
| C3 | Supervisor — OTP | OTP Verification: register recount 20 % higher than the app for the period | Verification factor ~1.2; a **dispensing gap** Finding | | |
| C4 | Supervisor — OTP | Register photo with names covered | Photo visible on the visit page (web); no uncovered names | | |
| C5 | Facility user → supervisor | OTP records an Adjustment (+5); supervisor confirms it with a note | Adjustment shown as confirmed on the web ledger | | |
| C6 | Supervisor — OTP | Try to start an OTP Verification at a facility outside their LGAs | The facility isn't offered | | |

## D. Review and dashboards (web)

| # | Who | Steps | Expected | Result | Note |
| --- | --- | --- | --- | --- | --- |
| D1 | State Coordinator | Findings → Automatic checks: open the transfer mismatch from A3 | Shows the measurement (issued vs received) and links to the transfer; wording is neutral | | |
| D2 | State Coordinator | Approve and assign the Finding to the LGA store's user | The user is notified | | |
| D3 | Project Admin | Command Centre (dashboard) for the current month | Stock on hand by level matches the Stock Ledger totals for the training facilities | | |
| D4 | Project Admin | Stock Reconciliation, Completeness & Timeliness, Last-Mile Dispensing | The training OTP shows its count variance, dispensing weeks and short-dispensing as tested above | | |
| D5 | Supervisor | Supervision → Planner | Their facilities ranked by risk; the visited ones not "due"; CSV export opens | | |
| D6 | Project Admin | DHIS2 Triangulation: upload a small CSV (2 rows) | "2 facility-months loaded"; a wrong period (2026-13) is refused with the line number | | |

## E. Access and privacy

| # | Who | Steps | Expected | Result | Note |
| --- | --- | --- | --- | --- | --- |
| E1 | OTP user | On the web, open Stock Ledger | Only their own facility | | |
| E2 | Viewer | Try Users & Roles, Data Sets, Offline Sync Health, Audit Trail | Not in the menu; direct links redirect to the dashboard | | |
| E3 | Project Admin | Change a threshold or a facility name, then open Audit Trail | The change is listed with their name, old and new value | | |
| E4 | Project Admin | Deactivate a test account; that user tries to sync | Sign-in refused; records stay on the phone (not lost) until reactivated | | |
| E5 | Any | Look through every OTP screen and export | No field for child or caregiver names, phones or IDs | | |
| E6 | Project Admin | Request an export through Programme Reporting → Data Access Requests | Needs approval before download | | |
| E7 | Project Admin | Stock Ledger → the OTP → **Void** one dispensing day from A6 with a reason | Entry struck through with name, date and reason; balance goes up by that day's sachets; the OTP can record that day again; the void appears in Audit Trail | | |
| E8 | Project Admin | Try to void the State store's issue from A2 | Refused — its transfer was received; void the receipt at the LGA store first | | |
| E9 | Facility user / supervisor | Look for a Void action | None — only administrators can void | | |

## F. Sign-off

Open issues at sign-off (number, severity, agreed action):

| # | Severity | Description | Agreed action / date |
| --- | --- | --- | --- |
| | | | |

**I confirm the RUTF-DTAP Monitoring Platform has been tested as above and is accepted for the
Katsina pilot, subject to the open issues listed.**

| | Name | Signature | Date |
| --- | --- | --- | --- |
| Programme lead | | | |
| Katsina SMoH Nutrition (State) | | | |
| Technical lead | Najib Adam | | |
