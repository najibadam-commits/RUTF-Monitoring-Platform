# Digital OTP Admission Card — rulebook and questions for the clinical authority

**Status: draft for clinical sign-off (10 Oct 2026).** The rules marked Ready are built into the database (migration 0124, rule set `2026-10-draft`, status draft); the rules marked NEEDS DECISION are not applied: the engine sends those cases for clinical review. Tests: `web-platform/tools/db/test-otp-registry.js`.

This is step 1 of the enhancement brief (§9): every rule the app will apply, extracted from the
approved reference documents, each with its source, how it would be digitised, and the questions
the designated clinical authority must answer before any rule is built. Where the documents are
silent, ambiguous or hand-corrected, the rule is marked **NEEDS DECISION**: the app will not guess
those (brief §3.6, §4.2, final requirement).

**Sources** (in `Resources/`):

| Ref | Document | Pages |
| --- | --- | --- |
| **G** | *Plan of admission and Rate of Distribution RUTF* (UNICEF / FMOH booklet, scanned) | G1 Classification and screening outcomes · G2 How to measure MUAC · G3 Bilateral pitting oedema · G4 Criteria for outpatient or stabilisation care · G5 Criteria and types of admission (6–59 months) · G6 Routine medication and RUTF ration table · G7 Discharge as cured |
| **C** | *RUTP OTP Admission Card* (scanned paper card, 2 pages; digitised in `docs/forms/`) | C1 Admission details · C2 Follow-up (12 visits, outcome codes) |
| **A** | *RUTF Allocation from State to OTP Centre* (4 pages) | A1 LGA request · A2 Admission and discharge reporting · A3 OTP centres report to the LGA · A4 State allocation · A5 LGA to Apex / satellite centres · A6 Distribution period |

---

## 1. Screening outcome (children 6–59 months) — source G1, G5

| ID | Rule as written | Digitised as | Status |
| --- | --- | --- | --- |
| S1 | **SAM** if MUAC < 11.5 cm (red) **or** WFH < −3 Z **or** bilateral pitting oedema. Any one is sufficient (G5 note). | Classification `SAM`; each criterion recorded separately | Ready |
| S2 | **MAM** if MUAC > 11.5 and < 12.5 cm (yellow) **or** WFH > −3 and < −2 Z, and no oedema. | Classification `MAM` → "Give nutritional advice or refer to SFP if available" (G1). Not admitted to OTP. | **NEEDS DECISION (Q1)** |
| S3 | **Normal** if MUAC > 12.5 cm (green), WFH > −2 Z, no oedema. | Classification `Normal` → "Praise caregiver and give advice" (G1). Not admitted. | **NEEDS DECISION (Q1)** |
| S4 | SAM: assess for severe oedema +++, marasmic kwashiorkor, medical complications, appetite for RUTF (G1). | Mandatory checks before any admission decision | Ready, but see Q6, Q7 |
| S5 | WFH is optional: "all centres will use MUAC and oedema; if sufficient capacity… WFH can also be used" (G5). | Per-centre setting *WFH in use: yes / no* | Ready, see Q5 |

## 2. Measurement rules — source G2, G3

| ID | Rule as written | Digitised as | Status |
| --- | --- | --- | --- |
| M1 | MUAC on the **left** arm at the shoulder–elbow mid-point, arm relaxed, read **to the nearest 0.1 cm** (G2). | Numeric, 1 decimal, cm; guidance text shown at entry | Ready; plausible range in Q4 |
| M2 | Oedema: thumb pressure on both feet for 3 seconds; if pitting remains on both feet → bilateral oedema; then check shins/hands, then around the eyes (G3). | Guided steps; grade recorded | Ready |
| M3 | Grades: Absent · **+** mild (both feet/ankles) · **++** moderate (feet + lower legs) · **+++** severe (generalised: feet, legs, hands, arms, face) (G3). | Enum `absent / + / ++ / +++` | Ready (the booklet prints the third row as "Grade ++"; the description is +++, so +++ is used) |
| M4 | Weight (kg), height/length (cm) on the card (C1); no precision or range is stated. | Numeric | **NEEDS DECISION (Q4)** |

## 3. Pathway decision — source G4, G5, G1

| ID | Rule as written | Digitised as | Status |
| --- | --- | --- | --- |
| P1 | **OTP** if: SAM by MUAC < 11.5 / WFH < −3 Z **or** oedema +/++; **free of medical complications**; **good appetite for RUTF / passes appetite test** (G4, G5). | Pathway `OTP` only when every condition is recorded and met | Ready, but complications and appetite test need Q6, Q7 |
| P2 | **Stabilisation care** if any of: marasmic kwashiorkor; oedema +++; **< 6 months**; **> 6 months and < 3.5 kg**; SAM with medical complications; lack of appetite for RUTF (G4). | Pathway `Stabilisation` → red alert, routine OTP actions blocked, referral recorded | **NEEDS DECISION (Q2, Q3)** |
| P3 | Marasmic kwashiorkor = SAM by MUAC/WFH **and** oedema (standard definition; the booklet names it without defining it). | Derived when both are present | **NEEDS DECISION (Q3)** |
| P4 | MAM with medical complications → inpatient paediatric care; SAM complicated → stabilisation; SAM uncomplicated → OTP; MAM uncomplicated → nutrition advice / SFP (G1 tree). | Pathway outcomes | Ready |

## 4. Types of admission to OTP (6–59 months) — source G5, C1

| ID | Type | Definition (G5) | Status |
| --- | --- | --- | --- |
| T1 | **New case** | Children 6–59 months with SAM who meet the criteria in Table 4.1 (= P1) | Ready |
| T2 | **Old case: referred from stabilisation care** | Stabilised in stabilisation care and transferred to continue treatment as outpatients | Ready; medication rule R-note applies |
| T3 | **Old case: transfer from another OTP site** | Under treatment in one OTP site, transferring to another | Ready; keeps the same Child ID and history |
| T4 | **Old case: returned defaulter** | Defaulted before recovery and returns to continue treatment | Ready; see Q9 for "defaulter" |
| T5 | The card (C1) also lists **Readmission** and **Relapse** as admission criteria and **Referral from community / Self-referral / From other centre / From inpatient** as admission sources. | Recorded as on the card | **NEEDS DECISION (Q8)** — how these map to G5's types |

## 5. Routine medication — source G6

The app records each medication and **recommends when it is due**; it does **not** calculate doses,
because the booklet gives no doses. An authorised officer confirms each administration.

| ID | Medication (G6) | When (G6) | Digitised as | Status |
| --- | --- | --- | --- | --- |
| R1 | Antibiotic: **Amoxicillin** | At admission | Due at admission; dose, route and duration entered by the officer | **NEEDS DECISION (Q10)** dose |
| R2 | ~~Vitamin A~~ — *at admission if no oedema and not given within the last month* | **Struck through by hand in the booklet** | Not implemented until confirmed | **NEEDS DECISION (Q11)** |
| R3 | Anti-malaria (refer to National Malaria Treatment Guide) | Test at admission; give if positive | Malaria test result required (card: Paracheck +ve/−ve); treatment recorded only if positive | Ready (dose per national guide, Q10) |
| R4 | Measles vaccination (if not already given at 9 months) | At admission | Due at admission unless already given | Ready |
| R5 | Deworming (Albendazole or Mebendazole) | Single dose at the 2nd visit | Due at visit 2 | Ready (dose Q10) |
| R-note | Children transferred from hospital-based SAM management should not receive routine medications already given during the hospital stay (G6). | For T2: each medication asks "already given in stabilisation care?"; if yes, not due | Ready |

## 6. RUTF ration — source G6 (92 g packets)

The ration is read **directly from the table**: no formula, no rounding by the app. Weekly
quantities are the booklet's own figures (for example 2½ a day → 18 a week).

| ID | Weight (kg) | Packets per day | Packets per week | Status |
| --- | --- | --- | --- | --- |
| X0 | ~~3.5 – 3.9~~ | ~~1½~~ | ~~11~~ | Struck through by hand; Q2 answered — threshold stays < 3.5 kg and **the row stays out** (11 Oct): 3.5–3.9 kg → clinical review |
| X1 | 4.0 – 5.4 | 2 | 14 | Ready |
| X2 | 5.5 – 6.9 | 2½ | 18 | Ready |
| X3 | 7.0 – 8.4 | 3 | 21 | Ready |
| X4 | 8.5 – 9.4 | 3½ | 25 | Ready |
| X5 | 9.5 – 10.4 | 4 | 28 | Ready |
| X6 | 10.5 – 11.9 | 4½ | 32 | Ready |
| X7 | ≥ 12 | 5 | 35 | Ready |

Rules around the table: a valid, confirmed weight is required before any ration is shown (brief
§3.2); the band and table version are displayed with the result; prescribed and dispensed packets
are both recorded and any difference flagged; the ration is recalculated at each visit's new
weight. **Open:** weight precision at band edges (Q4), visit interval and so the packets per visit
(Q12), and the stated weekly figure vs. per-day × 7 (Q13).

## 7. Follow-up checks — source C2

| ID | Rule as written (card footnotes) | Digitised as | Status |
| --- | --- | --- | --- |
| F1 | Weight below admission weight → arrange home visit or refer to inpatient care. | Alert at the visit; action recorded | Ready |
| F2 | Weight does not change by the 4th visit → arrange home visit or refer to inpatient care. | Alert at visit 4; action recorded | Ready (Q14: weight is not a discharge criterion) |
| F3 | Each visit records weight, weight loss Y/N, no change Y/N, height, WFH, MUAC, oedema, diarrhoea/vomiting/fever/cough days, appetite (RUTF test good/poor/refused), temperature, respiratory rate, dehydration, pallor/anaemia, superficial infection, action/medication, RUTF packets, outcome, examiner initials. | Visit form = card page 2 | Ready |
| F4 | *(follow-up, migration 0128)* Each visit is compared with the previous visit and the admission: weight, MUAC, WFH, oedema grade — better / same / worse. | Shown to the officer; counted in the weekly report (section L) | Ready — **direction only**; "sustained weight gain" / "no change" await Q14 |
| F5 | *(G4 applied at follow-up)* Severe oedema (+++) or a poor / refused appetite test at a visit → stabilisation care. | No RUTF recommended; referral prompted; RUTF only with the reason and the authorising clinician; no routine visit scheduled | Ready |
| F6 | *(follow-up)* Next visit a week after each visit; none while a referral is open, when discharge criteria are met, or at the defaulter count. | Appointment scheduled automatically; rescheduling needs a reason | Ready (interval: Q12) |
| F7 | *(programme decision, 10 Oct — replaces the 3/4-visit answer to Q23)* **Weekly follow-up up to 12 weeks until the child recovers**; not recovered after 12 weeks → refer the child to see a doctor. | `visit_interval_days` 7, `max_weeks` 12 (migration 0132; the visit-count settings are off): each visit shows "week N of up to 12"; after 12 weeks without recovery the next step is a referral to a doctor and no routine visit is scheduled; a later visit is flagged "refer" (a suggestion: RUTF stays recommended). The booklet's 8-week minimum for MUAC admissions now fits. | Ready |
| F8 | *(programme decision, 10 Oct — W6)* **MNP**: a child whose MUAC is **yellow** (MAM, no complications) receives **3 boxes (90 sachets) at once, for 3 months**, and comes back after 3 months. Pack: 150 sachets a carton, 5 boxes of 30. | The screening result says so (with the follow-up date); the officer records children started (90 sachets go out of stock automatically) and children back for follow-up; counts only, no names (the user's choice) | Ready |

## 8. Discharge as cured (6–59 months) — source G7

Each criterion is shown as met / not met / pending; "cured" is never set automatically, and needs
an authorised confirmation.

| ID | Admitted on | Cured when (G7) | Status |
| --- | --- | --- | --- |
| D1 | MUAC < 11.5 cm | Minimum stay 8 weeks **and** MUAC **≥ 13.5 cm** **and** no clinical concern (Q14, Q15, Q17 answered 11 Oct) | Ready — Q16 (minimum stay) still open |
| D2 | Bilateral oedema | MUAC **≥ 13.5 cm** **and** no oedema for 2 consecutive visits **and** no clinical concern | Ready (Q15, Q17 answered) |
| D3 | WFH < −3 Z (if used) | MUAC **≥ 13.5 cm** **and** no clinical concern — WFH is not a discharge criterion (Q14) | Ready (Q14, Q15, Q17 answered) |
| D4 | Other outcomes (C2): **A** absent · **D** defaulter (3 consecutive absences) · **T** transfer to inpatient · **R** refused inpatient care · **X** died · **R** recovered · **NR** non-recovered | Outcome codes | **NEEDS DECISION (Q9, Q18)** |

## 9. Reporting and allocation — source A1–A6

| ID | Rule as written | Digitised as | Status |
| --- | --- | --- | --- |
| A1 | Each OTP centre reports admissions, discharges, current patient load and RUTF stock to its LGA; the LGA combines them (A3). | Generated from the registry, per centre and LGA | Ready |
| A2 | Monthly figures: patients at start, new admissions, discharged, defaulted / died / transferred / other, remaining at end, RUTF stock (A2). Closing = opening + admissions − discharges − other exits. | Monthly OTP report, computed, with the check | Ready |
| A3 | LGA requests RUTF on current patients, new and expected admissions, discharges and available stock — not last month's figures alone (A1, A6). Example: need 60 cartons, have 15 → request 45. | Requirement = expected consumption (sum of each child's ration) − usable stock | **Built (R173)**: suggested quantity = need − usable stock; no buffer (Q19) |
| A4 | Each LGA has an **Apex** OTP centre and **satellite** centres; RUTF goes to OTP sites **weekly**, to LGAs **monthly** (A3, A5, A6). | Apex / satellite per OTP site; LGA allocation plan | **Built (R173)** |

---

## 10. Questions for the clinical authority (none of these will be guessed)

| # | Question | Why it matters |
| --- | --- | --- |
| Q1 | MUAC exactly **11.5 cm** and exactly **12.5 cm**: the booklet uses "< 11.5", "> 11.5 and < 12.5", "> 12.5", so both values fall in no class. Which class do they belong to? | Classification and admission |
| ~~Q2~~ | **Answered (11 Oct): No** — the stabilisation threshold is **not** changed to 4 kg; it stays **< 3.5 kg** (migration 0139). The struck-through 3.5–3.9 kg ration row **stays out** (confirmed 11 Oct): a child of 3.5–3.9 kg gets "no ration rule — refer for clinical review" (see X0). Original: is the stabilisation threshold now < 4 kg? | Who is admitted; the ration table |
| Q3 | Confirm **marasmic kwashiorkor** = (MUAC < 11.5 or WFH < −3 Z) **and** bilateral oedema (any grade) → stabilisation. | Pathway P2 |
| Q4 | Precision and plausible ranges: weight to **0.1 kg**? height/length to 0.1 cm? MUAC range (e.g. 7–20 cm)? How is a weight between bands handled (e.g. 5.45 kg)? Height or length by age? | Validation and band edges |
| Q5 | Which centres use **WFH**? WFH needs the **WHO weight-for-height tables** (by sex and height), which are not in the documents: may the app use the official WHO 2006 tables, or will officers enter the Z-score from the chart? | WFH criteria |
| Q6 | The list of **medical complications** that send a child to stabilisation (e.g. IMCI danger signs: not able to drink, vomits everything, convulsions, lethargy, chest indrawing, hypothermia, high fever, severe dehydration, severe anaemia…). Which card fields trigger it, and at what values (respiratory rate thresholds by age are on the card)? | Pathway P1 / P2 |
| Q7 | The **appetite test**: how much RUTF, over how long, and what counts as pass / fail (by weight)? | Pathway P1 / P2 |
| Q8 | How do the card's **Readmission** and **Relapse** relate to G5's types (new case, from stabilisation, transfer, returned defaulter)? Is a relapse a **new case** with a new episode on the same Child ID? | Admission type |
| Q9 | **Defaulter**: the card says 3 consecutive absences. Absent from what schedule (weekly visits?)? When does a returned defaulter resume vs. restart? | Outcomes, returned defaulter |
| Q10 | **Doses**: amoxicillin (by weight?), anti-malarial (national guide), albendazole / mebendazole (by age?), measles. Should the app only record what the officer gives, or calculate doses from an approved table you will supply? | Medication: no dose is calculated without an approved table |
| Q11 | **Vitamin A** is struck through by hand. Removed from routine OTP medication? | Medication R2 |
| ~~Q12~~ | **Answered (10 Oct): weekly, up to 12 weeks until the child recovers** (F7); the ration is the table's weekly packets. Original: **Visit interval**: weekly? Is the ration always issued for one week (packets per week), or for the days until the next visit? | Packets per visit |
| Q13 | Use the table's **packets per week** as printed (18, 25, 32 — i.e. halves rounded up), confirmed? | Ration quantity |
| ~~Q14~~ | **Answered (11 Oct): discharge is decided on MUAC, not weight** — weight differs by age. The "sustained weight gain" and weight-for-height discharge criteria are removed (0139); weight still sets the ration and the card's "no weight change by visit 4" alert (F2). | Alerts F2, discharge D1 |
| ~~Q15~~ | **Answered (11 Oct): admission at MUAC < 11.5 cm; discharge at MUAC 13.5 cm or more** (0139: `discharge_muac_at_least` 13.5). | Discharge |
| Q16 | **Minimum stay 8 weeks** applies to MUAC admissions only (as printed), not to oedema or WFH admissions? | Discharge |
| ~~Q17~~ | **Answered (11 Oct): Recovered = MUAC 13.5 cm or more with no clinical concern; Non-recovered = MUAC going up and down (e.g. 11.7 then 11.5) — likely an illness: refer to the clinic** (0139: the discharge check lists any concern recorded at the latest visit — oedema, poor appetite, fever, diarrhoea, vomiting, dehydration, pallor, an action required, a fall in MUAC — and the officer confirms; a fall in MUAC between visits is flagged and a referral to the clinic suggested). | Discharge |
| Q18 | **Non-recovered (NR)** and **non-response**: after how long in treatment? When is "transfer to inpatient" required? | Outcomes |
| ~~Q19~~ | **Answered (11 Oct): no buffer stock for now** (`supply_buffer_pct` 0, settable later; R173). | RUTF requirement |
| ~~Q20~~ | **Answered (11 Oct): one Apex OTP centre per LGA**, set by the LGA or State Nutrition Officer (`lga_apex_otp`, R173; DUMMY marks until the real ones are set). | Distribution and reporting |
| ~~Q21~~ | **Answered (10 Oct, W10): the Beneficiary Card's format, DTAP-KTS-MTZ-0001245, numbered per LGA** (migration 0130). Original: **Child ID format** per LGA (e.g. `KT-DAU-26-00042`: state, LGA, year, number) — and is the number per LGA or per OTP site? | Child ID |
| ~~Q22~~ | **Answered (10 Oct): the State Nutrition Officer sets the clinical rules** the OTP Officers follow and approves the rule set (web: Clinical Rules; `otp_rule_set_approve`, migration 0132); **the OTP Officer authorises at the site** (RUTF when none is recommended, with the reason; discharge and outcomes). |
| ~~Q23~~ | **Superseded (10 Oct)** by "weekly up to 12 weeks until recovered" (F7): the 3-visit / exceptional-4th rule is switched off. |

## 11. Decisions outside the clinical rules

| # | Decision | Why it matters |
| --- | --- | --- |
| G1 | **Child-level data**: the platform currently promises *no child-level data* (landing page, slides, leave-behind, Settings, DPIA draft). A child registry with names, caregivers, addresses, phones and HIV status reverses that. Needs: an updated **DPIA**, caregiver **consent** wording, **retention** period, and who may see identifiable data (OTP Officer: own site only? supervisors? State?). | NDPA 2023 compliance; public claims must change |
| G2 | **Sensitive fields**: should HIV test / ART status be recorded in the app at all, or stay on paper? | Data minimisation |
| G3 | **Offline**: the app works offline. Child IDs must be unique across devices: issue them from the server only (registration needs signal), or pre-allocate a block of IDs to each phone? | Child ID uniqueness |
| G4 | **Timing**: you said the Android field app is completed after the stakeholder review. Should this work start now or after the review? | Plan |
