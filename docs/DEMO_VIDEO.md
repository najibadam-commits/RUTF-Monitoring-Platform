# Demo video — shot list and narration (backup for the live demo)

A 2 min 50 s screen recording that follows the live demo script (`docs/DEMO_SCRIPT.md`) in the same
order. Use it if the network or laptop fails on the day, or send it ahead to the panel. Figures are
read off the screen; with the nightly checks paused (`demo-pause-checks.js --pause`) they hold
still between takes.

## Before you record (10 minutes)

| ✔ | Check |
| --- | --- |
| | Production build running: in `web-platform\web` run `npm.cmd run demo`; record from **http://localhost:3001**. |
| | Nightly checks paused: in `web-platform\tools\db`, `node demo-pause-checks.js` says "paused". |
| | Phone reports fresh: `node seed-demo-sync-status.js`; data requests reset: `node seed-demo-download-requests.js`. |
| | Chrome signed in as **Super Admin**, zoom 100 %, window about 1440 × 900 (maximised on a 1920 × 1080 screen is fine), bookmarks bar hidden (Ctrl+Shift+B), one tab. |
| | Windows **Do not disturb** on (Settings → System → Notifications); close chat and email apps. |
| | Open every screen below once first, so each loads straight away during the take. |
| | Microphone checked; a quiet room. Speak slowly — about 130 words a minute. |

**Recording on Windows 11:** press **Win + Alt + R** (Xbox Game Bar) to start and stop recording the
Chrome window; **Win + Alt + M** turns the microphone on or off. The file goes to
`Videos\Captures`. Alternative: Snipping Tool → the video-camera icon → **New**, select the Chrome
window. If one take goes wrong, stop and start that shot again; the shots can be joined in
Clipchamp (built into Windows) afterwards.

Move the mouse slowly and let each screen settle for a second before you speak about it.
**Don't press Approve or Reject** on Data Access Requests (or re-run the seed script afterwards).

---

## Shot list

| # | Time | Screen and action | Narration |
| --- | --- | --- | --- |
| 1 | 0:00–0:15 | **Landing page** `localhost:3001`. Hold on the hero for 3 s, then scroll slowly to **How it works**. | "This is RUTF-DTAP, a digital traceability and accountability platform for Ready-to-Use Therapeutic Food. It follows every sachet through the government supply chain — State store, LGA stores, OTP sites — with a record at every hand-over." |
| 2 | 0:15–0:35 | Sign-in already done: open **Overview Dashboard**. Point at **Needs attention**, then the stock row (State store, LGA stores, OTP sites). | "Each month starts here. The platform turns the figures into actions, most serious first: critical Findings, expired stock, Findings past the 30-day target, OTP sites running low. Each button goes straight to where it's fixed." |
| 3 | 0:35–0:55 | **Stock Ledger**: click the tile **Under 1 month of stock**, then open **Dutsi LGA Nutrition Store**. Point at **Month by month** and the **Ledger integrity** line. | "Balances are computed from entries by lot and expiry, never typed in. Month by month, the store's count is checked against the ledger — and no entry is ever edited or deleted; a mistake is voided with a reason and stays visible." |
| 4 | 0:55–1:10 | **Transfers**: point at **Delivered in full**, click **Received with a discrepancy**, then click a **Finding** link in the list. | "Every shipment has a traceable ID. The sender records the issue, the receiver confirms what arrived, and a short delivery raises a Finding automatically. It can't hide." |
| 5 | 1:10–1:25 | **Finding detail** (opened from shot 4): point at **Automatic check · Transfer mismatch**, the gap, and **Activity History**. | "Here is one: raised by the nightly check, with the evidence — issued, received, the gap — approved by the State Coordinator and assigned to a named person." |
| 6 | 1:25–1:45 | **Corrective Action Tracker**: point at the four coloured stages. Choose **LGA = Daura**, tick **Past target only**, press **Apply**. | "Every approved Finding moves through four stages: assigned, being addressed, action recorded, and verified and closed by a supervisor. Filter to one LGA and what's past target, and you have the agenda for Monday's meeting." |
| 7 | 1:45–2:00 | **Accountability Scorecard**: point at the score, the **6-month trend**, then scroll to the **LGA league table**. | "Accountability you can measure: a simple score — half closure, half timeliness — for the State and every LGA, so each team knows exactly how to improve it. Findings are for review, not accusation." |
| 8 | 2:00–2:15 | **Last-Mile Dispensing** (3 s on the top tiles), then **DHIS2 Triangulation** (point at **Reports agreeing with the ledger**). | "At the last mile, sachets dispensed are set against prescribed and checked against the OTP register — aggregate figures only, never a child's name. And the national DHIS2 reports are set beside the ledger, report by report." |
| 9 | 2:15–2:30 | **Programme Reporting** → **Open the September 2026 report**. Scroll once; point at **Print / save as PDF** (don't print). | "Every month, a one-page programme report is written from live data — ready to print for the State, the LGAs and UNICEF. No spreadsheets to compile." |
| 10 | 2:30–2:50 | **Data Access Requests** (point at the two waiting requests — don't approve), then **Programme Administrators** → **Bringing another state on**. | "Data leaves the platform only with approval, scoped and downloadable once. And it's ready to scale: another state comes on in five steps, with no new software. From the store shelf to the child — every sachet accounted for." |

**Optional phone clip (15 s, recorded on the phone):** Android's screen recorder (swipe down →
**Screen record**) on the RUTF-DTAP app: Home showing **Everything is synced**, turn on airplane
mode, record a **Daily Dispensing** entry, show **1 entry is on this phone, waiting to sync**, turn
airplane mode off. Insert after shot 2 with: "Facility staff record on a phone that works without a
signal; entries wait safely and sync by themselves."

## After recording

- Watch it through once at normal speed: every figure readable, no notifications, no pauses over
  10 s.
- Trim the start and end in Clipchamp; export at 1080p. Name it `RUTF-DTAP-demo.mp4`.
- If a data request was approved by mistake, re-run `node seed-demo-download-requests.js`.
