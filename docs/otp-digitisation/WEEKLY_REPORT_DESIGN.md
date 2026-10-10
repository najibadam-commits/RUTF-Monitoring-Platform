# Weekly OTP Site Report — design, source of every figure, and open questions

**Status: draft (10 Oct 2026).** Built from the enhancement brief *Automated Weekly OTP Site
Reporting and State Coordinator Approval Workflow*. The brief's sample (MPHC Mazoji) was a manual WhatsApp report, not a document (W1 resolved): the brief's sections are the structure.

**Principle (brief §1, §4, final instruction):** every figure comes from records already in the
platform; nothing is re-typed; a figure that cannot be computed is shown as **missing**, **not
applicable** or **pending** — never as 0.

## 1. Where each section comes from

| Section | Figure | Source in the platform | Status |
| --- | --- | --- | --- |
| A | State, LGA, facility, OTP site, officer, week, generated / submitted, coordinator, status | facilities, profiles, the report itself | **Ready** |
| B | Opening caseload, SAM, by sex | `otp_admissions` active at the start of the week (Digital OTP Admission Card, 0124) | **Ready** |
| B | Opening caseload, HR MAM | — the guidelines have no HR MAM admission to OTP (MAM → nutrition advice / SFP, G1) | **Not applicable** until W4 |
| C | New enrollment, SAM, by sex × 6–23 / 24–59 months | `otp_admissions`, type *new case*, admitted in the week; age on the admission date | **Ready** |
| D | Transfer in / out, by sex | `otp_admissions` type *transfer from OTP* (in) and outcome *transferred to another OTP site* (out) | **Ready** |
| E | Cured, non-recovered, death, defaulter (SAM), by sex | `otp_admissions` outcome recorded in the week | **Ready** |
| E | Absentees (SAM), by sex | `otp_visits` with *absent* in the week, unique children | **Ready** |
| E | Transfer to inpatient, refused inpatient care | `otp_admissions` outcome (on the card, C2) | **Ready**, shown as "other exits" (W5) |
| F | Closing caseload, SAM, by sex | **calculated** = opening + new + transfer-in − transfer-out − exits; **compared with** the active records at the end of the week; any difference is an issue that blocks approval | **Ready** |
| G | RUTF: opening, received, dispensed, issued, losses, adjustments, expected closing, physical count, discrepancy (cartons and sachets) | `stock_transactions` for the site in the week; 150 sachets a carton (`products.units_per_carton`) | **Ready** |
| H | MNP stock and doses 1st / 2nd / 3rd | **nothing recorded today** → new minimal forms: *MNP stock movement* and *MNP doses given* | **New form**; pack size W6 |
| I | MUAC screening by colour (green / yellow / red) and sex | `otp_screenings` in the week (the colour band the engine computed) | **Ready**; unique-person rule W7 |
| J | IYCF and health education: pregnant, breastfeeding, other women; sessions | **nothing recorded today** → new minimal form: *IYCF / health education session* | **New form**; categories W8 |
| K | Comments | the report; **required** when an issue is flagged or the coordinator asks | **Ready** |

## 2. Reporting week and workflow

- **Week:** Monday 00:00 to Sunday 23:59 (configurable: `otp_report_week_start_dow`). The
  report date is never taken as the period.
- **Deadline:** configurable (`otp_report_due_days_after`, default 2: due Tuesday); reminders the
  day before and when overdue.
- **Statuses:** *draft* (system-generated, the officer may save comments) → *submitted* (locked,
  in the coordinator's queue) → *approved* or *returned* → (returned) revised and *submitted*
  again → *approved*. An approved report can only change by an **amendment**, which creates a
  new version for approval. **Every version is kept**: figures, issues, comments, who and when.
- **Who:** the OTP Officer of the site prepares and submits (cannot approve); the State
  Coordinator of the site's state approves or returns, with comments. Approval is recorded against
  the coordinator's account with date and time. Notifications at each step.
- **Blocking issues:** a submission needs every *blocking* issue explained in a comment; approval
  needs the caseload reconciled (or the difference documented) and stock discrepancies
  explained.

## 3. Privacy

The weekly report is **aggregate** (counts by sex, age group and category): no child is named and
no Child ID appears in it, so it follows the platform's rule (child records: OTP Officer only).
Two choices to confirm (W9):
- the report shows **exact counts**, including 1–4, to the OTP Officer and the State Coordinator,
  because a caseload can't be reconciled with hidden cells (the OTP Caseload page, seen by
  everyone, keeps hiding small counts);
- "view the underlying records" shows the **OTP Officer** the Child IDs behind each figure (opened
  only by entering the ID, as now); the **State Coordinator** drills down by day and category,
  never to a child.

## 4. Questions

| # | Question |
| --- | --- |
| W1 | ~~Sample report~~ **Resolved (10 Oct):** there is no written sample — the weekly report was compiled by hand and sent by WhatsApp. The user's direction: a **live, automatically calculated summary** of the site's records with a **review screen** before submission, so the officer verifies rather than compiles and the coordinator focuses on data quality, performance and corrective action. The section list in the brief is the structure. |
| W2 | **Answered (10 Oct): yes** — Monday–Sunday, due 2 days after the week ends (Tuesday), as built. Question: Is the week **Monday–Sunday**? When is the report **due**? |
| W3 | **Answered (10 Oct): no, the list was not complete** — added relapse, readmission, referral to stabilisation and others. Section C now shows the admissions by category (new case, relapse, readmission, returned defaulter, from stabilisation care, others; each counted once; they add up to the week's admissions) and section E the referrals made in the week (to stabilisation care, elsewhere), by sex (migration 0131). |
| W4 | **Answered (10 Oct): yes** — HR MAM shows *not applicable* until it is defined. Question: **HR MAM**: which children are HR MAM (criteria), are they admitted to OTP, and on what ration? Until defined, HR MAM rows show *not applicable*. |
| W5 | **Answered (10 Oct): yes to both** — transfer to inpatient and refused inpatient care are exits; absentees stay in the caseload until the third consecutive absence. As built. Question: Do *transfer to inpatient* and *refused inpatient care* reduce the active caseload? (Proposed: yes, as exits, shown separately.) Do **absentees** stay in the active caseload? (Proposed: yes, until the third consecutive absence makes them defaulters.) |
| W6 | **MNP**: product and pack (sachets per carton or box); is the 1st / 2nd / 3rd dose a monthly distribution of a box of N sachets? Who receives MNP (age group)? |
| W7 | **Answered (10 Oct): yes** — screening events, children 6–59 months only (other ages counted apart); a child screened twice counts twice (children not admitted have no Child ID). Migration 0130. Question: **MUAC screening**: count each child once per week (unique) or every screening event? (Proposed: both shown; the total counts events, as screened.) Only 6–59 months? |
| W8 | **Answered (10 Oct): yes; attendance** — the groups do not overlap and the total is the attendance (their sum; a woman attending twice counts twice). Migration 0130 checks it; the app works it out. Question: **IYCF**: are pregnant, breastfeeding and other women mutually exclusive? Is "total" participants or contacts? Does the same woman attending twice count twice? |
| W9 | **Answered (10 Oct): yes** — privacy choices confirmed. Question: Confirm the privacy choices in §3. |
| W10 | **Answered (10 Oct): switch to the Beneficiary Card's format** — new Child IDs are DTAP-<state>-<LGA>-<7 digits> (DTAP-KTS-MTZ-0001245), numbered per LGA (migration 0130); the DUMMY demo children were renumbered; a real child's ID never changes. Question: **Child ID format**: the RUTF-DTAP Beneficiary Card shows **DTAP-KTS-MTZ-0001245** (DTAP, state, LGA, 7 digits). The platform currently issues **KT-MTZ-26-00042** (state, LGA, year, 5 digits). Switch to the card's format? |
