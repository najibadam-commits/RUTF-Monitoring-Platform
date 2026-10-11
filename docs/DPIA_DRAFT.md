# Data Protection Impact Assessment — draft for the DPO

**System:** RUTF-DTAP Monitoring Platform (web + Android), Katsina RUTF pilot
**Law:** Nigeria Data Protection Act 2023 (NDPA) and the NDPC's implementing guidance (the General
Application and Implementation Directive) [DPO: confirm the current instruments and section numbers]
**Status:** DRAFT, revision 2 (10 Oct 2026), prepared from the system as built (migrations up to
0130). Revision 1 (3 Oct) described an aggregate-only platform; since the **Digital OTP Admission
Card** (DECISIONS R142–R157) the platform holds **child-level health data**, so this revision
replaces it. Items marked **[DPO]** need the Data Protection Officer's decision; **[PROG]** the
programme lead's. This draft describes what the system actually stores, who can see it and how it
is protected, so the DPO can assess it — it is not itself the assessment, and the platform should
not hold real children's data until it is signed off (§11).

---

## 1. Why a DPIA is required

The NDPA requires an impact assessment before processing that is likely to result in a high risk
to data subjects [DPO: confirm the section]. This processing is high risk because it involves:

- **children** (6–59 months) — data subjects who cannot consent for themselves;
- **health data** (malnutrition status, measurements, oedema, medication, referrals, outcomes) —
  sensitive personal data under the NDPA;
- **identifying details** of children and their caregivers (names, address, mobile number);
- a programme population that is **vulnerable** (households with severely malnourished children);
- storage **outside Nigeria** (§7).

## 2. The processing in brief

The platform tracks RUTF (ready-to-use therapeutic food) from the State store to OTP sites and to
each child, so that RUTF reaches malnourished children and loss or diversion is detected early.

| Part | What it does | Personal data |
| --- | --- | --- |
| Supply chain (since M1) | Receipts, issues, dispensing totals, stock counts, losses, transfers, supervision visits, Findings | Staff only (§4.1) |
| **Digital OTP Admission Card** (0124) | Screening, registration with a Child ID, admission, routine medication, outcome | **Children and caregivers** (§4.2) |
| **Follow-up** (0128–0130) | Weekly visits compared with the admission and the previous visit, RUTF recommended and given, next-visit scheduling, referrals, a photo of the RUTF given | Children (clinical); photos of sachets only |
| **Weekly OTP Site Report** (0126) | A weekly summary per OTP site, reviewed by the OTP Officer and approved by the State Coordinator | Aggregates by site, sex and age group (§6, risk R5) |

## 3. Data subjects

| Who | Roughly how many (pilot) | Relationship |
| --- | --- | --- |
| Children 6–59 months screened at OTP sites | All screened; only those **admitted** are identified | Beneficiaries |
| Caregivers of admitted children | One per admitted child | Beneficiaries' representatives |
| Programme and government staff (OTP Officers, LGA and State Nutrition Officers, supervisors, State Coordinators, administrators) | Several hundred accounts | Users |

A child who is screened but **not admitted** is recorded only as an anonymous screening (sex, age
in months, measurements, result), with no name and no Child ID.

## 4. Personal data processed

### 4.1 Staff

| Data | Where | Why |
| --- | --- | --- |
| Name, email, phone (optional), role, facility / LGA / state assignment | `profiles`, Supabase Auth | Sign-in, access control, notifications |
| Initials | Finding IDs | Finding reference numbers |
| GPS of a supervision visit (lat/lng, accuracy, distance) | `monitoring_visits` | Evidence the visit took place |
| **Selfie at the facility** | `visit-evidence` bucket | Evidence of presence — **[DPO]: facial image; is it necessary, or do GPS and stock photos suffice?** |
| Attendance selfies, GPS, device id captured before their removal (R50, R51) | `field_monitor_attendance`, `attendance-evidence` | No new data; kept until the retention decision |
| Device identifier, model, OS and app version | ledger, dispensing, visits, `device_sync_status` | Idempotent sync, sync monitoring |
| Sync error messages (first line, ≤ 300 characters, tokens stripped) | `sync_failures` | Support |
| Who did what and when | `audit_log`, `issue_history`, `recorded_by` | Accountability |
| Photos of waybills, stock cards, stock (incidental signatures) | `ledger-evidence`, `visit-evidence` | Evidence for receipts, counts and losses |

### 4.2 Children and caregivers

| Data | Where | Sensitive? | Why |
| --- | --- | --- | --- |
| **Child ID** (DTAP-KTS-MTZ-0001245), written on the caregiver's paper card | `otp_children` | Pseudonym | Finds the record at each visit without a name search |
| Child's **name**; caregiver's **name**, **physical address**, **mobile number** | `otp_child_identity` (a separate table) | Identifying | Identify the child; home visits and tracing defaulters (card C1) |
| Sex, date of birth (if known), age at registration, OTP site, LGA, state | `otp_children` | — | Eligibility (6–59 months), reporting by sex and age group |
| Screening and admission measurements: weight, height/length, MUAC, oedema grade, WFH, medical complications, appetite test; admission type and source, readmission / relapse, walking distance | `otp_screenings`, `otp_admissions` | **Health** | Pathway decision (booklet G1–G5) |
| Visit records: measurements, illness history (days of diarrhoea, vomiting, fever, cough), temperature, respiratory rate, dehydration, pallor, infection, actions, RUTF recommended and given, the reason when they differ, alerts, the comparison with earlier visits | `otp_visits` | **Health** | Treatment, ration, recovery monitoring (G6, C2) |
| Routine medication given (as entered; doses not calculated) | `otp_medications` | **Health** | Card G6 |
| Referrals: date, reason, rule that prompted it, destination, status and note | `otp_referrals` | **Health** | Stabilisation care or a doctor (G4; Q23) |
| Appointments: due dates, attended / missed / rescheduled with the reason | `otp_appointments` | — | Weekly follow-up, defaulter tracing |
| Outcome: cured, defaulted, died, non-recovered, transferred, refused inpatient care, with the reason | `otp_admissions` | **Health** | Programme outcomes |
| **Photo of the RUTF given** — sachets only; the officer confirms no child or caregiver is in it | `otp-rutf-evidence` bucket, `otp_visit_photos` | Not intended to be personal (risk R4) | Evidence the RUTF was handed over |
| Access log: who opened which child's record, registered, transferred or referred, and each view of the visits list | `otp_access_log` | — | Accountability for access to child data |

**Not recorded:** HIV test or ART status (the paper card has fields for them; the app has none —
RULEBOOK G2, **[DPO][PROG] confirm they stay off**), photos of children, ethnicity, religion,
household income, GPS of homes.

## 5. Lawful basis [DPO]

| Data | Proposed basis | Note |
| --- | --- | --- |
| Staff data | Public interest / exercise of official authority — staff acting in their official role | Consent not proposed for staff |
| Children's and caregivers' personal data | Public interest in health — the State's nutrition programme (CMAM) | [DPO] confirm |
| Children's **health** data | The NDPA condition for health care and public health processing by health professionals under a duty of confidentiality [DPO: confirm the section and whether the OTP Officer's professional duty meets it] | Sensitive personal data |
| Children (under 18) | Processing through the **caregiver** as the person with parental responsibility; the caregiver is told and may object (§9) | [DPO] decide whether **consent** of the caregiver is also required, or a **notice** suffices with the public-health basis |

**Proposed caregiver notice** (to be read out at registration and printed on the back of the paper
card; Hausa translation needed) [PROG]:

> "To treat your child, the OTP Officer records your child's name, age, measurements and treatment,
> and your name, address and phone number, in the State nutrition programme's secure system. Only
> the OTP Officer at this clinic can see your child's details, using the number on this card. Others
> in the programme see only totals, never names. The record is kept for [retention, §8]. You can ask
> the OTP Officer to see or correct it, or to stop being contacted by phone. Treatment does not
> depend on agreeing to phone contact."

## 6. Who can see what

Enforced **in the database**, not only in the screens: the child tables have row-level security
with no policies and every API privilege revoked, so they can be reached only through checked
functions; tests (`tools/db/test-otp-registry.js` 56 checks, `test-otp-followup.js` 108,
`test-mobile-role-access.js` 208) confirm each refusal.

| Who | Child's and caregiver's details | Clinical record of a child | Aggregates |
| --- | --- | --- | --- |
| **OTP Officer** at the child's current OTP site | **Yes, only by entering the Child ID**; each opening logged | Yes, same way | Yes |
| OTP Officer at another site | No (only after a transfer to their site) | No | Yes |
| OTP Officer's **visits and tasks list** | **Child IDs only** — no names, caregivers, addresses or phones; each view logged | Due dates, visit numbers, referral status | — |
| LGA / State Nutrition Officers, supervisors | No | No | Yes |
| **State Coordinator** | No | No | Yes, including the weekly site reports (R5) and counts of visits waiting for a photo; cannot correct report figures or clinical records |
| Project Admin, Super Admin (in the app) | No | No | Yes; the super administrator may view RUTF photos (sachets) for audit |
| **Holders of the database service key** (platform maintainers) | Technically yes, outside the app | Technically yes | — (risk R7) |

Other controls:

- **Aggregates** hide counts of 1–4 (`otp_min_cell_count`, default 5) with complementary
  suppression, and give no totals for split figures from which a hidden count could be worked out.
- The **Audit Trail** records which child fields changed, never the values.
- **On the phone:** child details are shown on screen only and never stored (no local database,
  cache or sync queue); screenshots and screen recording are blocked on these screens
  (FLAG_SECURE); the RUTF photo is deleted from the phone once sent. The OTP screens work only
  online (the user's decision, 10 Oct).
- **Photos** are in private buckets, uploaded only to an own-site visit waiting for its photo,
  shown only through short-lived signed links, and can't be changed or deleted by users.
- Nothing is callable without signing in (`tools/db/audit-permissions.js`).

## 7. Storage, security, transfers

| Item | Current state | Action |
| --- | --- | --- |
| Hosting | Supabase (managed Postgres and storage), **region eu-central-1 (Frankfurt, Germany)**; web on Vercel | **[DPO] cross-border transfer:** health data of Nigerian children is stored in the EU. Confirm the NDPA transfer basis (adequacy of the destination, or appropriate safeguards / the provider's data processing agreement), or **[PROG]** move to a region the DPO approves before real children are registered |
| Processor agreements | Supabase, Vercel, Resend (email) | **[PROG]** sign / file each provider's DPA; list them as processors |
| Encryption | TLS in transit; provider encryption at rest | — |
| Phones | No child data stored; supply-chain records wait in the app's private storage until synced | **[PROG]** screen lock required on programme phones; sign out when a phone changes hands |
| Backups | Provider daily backups (plan-dependent) | **[PROG]** confirm point-in-time recovery; backups contain child data and follow the same retention |
| Keys | Service keys only on the server and administrators' workstations, never in the app or repository | **[PROG]** name the key holders; rotate on staff change |
| Email | Notifications contain text only, never child data | Verified sender domain before go-live |
| Demo data | DUMMY accounts and DUMMY children (names end "(DUMMY)") exist in the same database for the demo | **[PROG]** remove them before real children are registered (`seed-demo-*.js --remove`) |

## 8. Retention [DPO]

Nothing is deleted automatically today; **automatic deletion is not built yet [PROG]**.

| Data | Proposed retention |
| --- | --- |
| Child's and caregiver's **identifying details** (`otp_child_identity`) | **2 years after the last discharge**, then deleted; the Child ID and the clinical record remain, no longer identifiable to the programme |
| Clinical record, appointments, referrals, outcomes (pseudonymous after the above) | Life of the programme + 5 years (programme evaluation, audit) |
| RUTF photos | 1 year after the visit |
| Access log | 2 years |
| Anonymous screenings | Life of the programme |
| Weekly reports (aggregates) | Life of the programme + 5 years |
| Ledger, transfers, dispensing totals, supervision visits, Findings, audit trail | Life of the programme + 5 years |
| Evidence photos (waybills, stock cards, register pages, stock) | 2 years |
| Selfies (visit; attendance records from before their removal) | 90 days |
| Sync error messages | 180 days after resolution |
| Accounts of people who leave | Deactivated on departure; names stay on the records they made |

## 9. Rights of data subjects

| Right | How it would work | Gap |
| --- | --- | --- |
| Be informed | The caregiver notice (§5) at registration | **[PROG]** approve the text and translation |
| Access | The caregiver asks the OTP Officer, who opens the record with the Child ID and reads it out or prints it | No print/export of one child's record yet |
| Correction | The OTP Officer corrects a wrong measurement through a new visit; **identity details (name, address, phone) cannot yet be corrected in the app** | **[PROG]** build a correction function (logged, value-free audit) before go-live |
| Object / restrict (e.g. no phone contact) | The officer removes the mobile number | Needs the correction function above |
| Erasure | Limited while the programme must keep treatment records; the identity details go at the end of retention (§8) | **[DPO]** decide how an erasure request during treatment is handled |
| Complaint | To the programme, then the NDPC | **[PROG]** name the contact on the notice |

## 10. Risks and mitigations

| # | Risk | Likelihood / impact | In place | Further action |
| --- | --- | --- | --- | --- |
| R1 | An OTP Officer opens records without need, or shares a child's details | Medium / High | Only own site; only by Child ID; every opening logged | **[PROG]** monthly review of `otp_access_log` by the State Nutrition Officer; confidentiality undertaking in training |
| R2 | A signed-in phone is lost or left unattended and someone opens records with a Child ID from a card | Low / High | Nothing stored; screenshots blocked; account deactivated centrally | Screen lock; automatic sign-out after 15 minutes without use, with a one-minute warning **[PROG] — built 11 Oct (DECISIONS R168)** |
| R3 | The paper card (Child ID) is lost or seen by others | Medium / Low | The Child ID alone reveals nothing without an OTP Officer's account at that site | Tell caregivers the card number is private |
| R4 | A person appears in an RUTF photo | Low / Medium | Sachets only; officer confirms no people; private bucket; only the site and the super administrator can view | Periodic spot-check by the super administrator; delete and retrain if found |
| R5 | **Small numbers in a site's weekly report** (e.g. "1 girl cured") let a coordinator identify a child in a small community | Medium / Medium | Only the State Coordinator and administrators see site reports; no names | **[DPO]** accept as necessary for programme management, or suppress small cells in the State view |
| R6 | Names or health details typed into free text (reasons, notes, referral notes, report comments) | Medium / Medium | Prompts ask for facts, not names | Training; periodic review |
| R7 | Database service-key holders can read everything outside the app | Low / High | Keys only with named maintainers, never in the app | Name the holders, rotate on staff change, log their access |
| R8 | Health data stored outside Nigeria | Certain / Medium | Provider security | §7 decision before real data |
| R9 | Identity details kept longer than needed | Certain (no deletion yet) / Medium | — | Build the §8 deletion before the first retention date |
| R10 | Wrong clinical rules harm a child (e.g. a missed referral) | Low / High | Rules from the approved booklet only; unclear cases go to clinical review; the rule set stays a draft until signed off | Clinical sign-off of the rule set (RULEBOOK Q22) |
| R11 | DUMMY demo data mixed with real data | Medium / Low | DUMMY names and accounts are labelled | Remove before go-live (§7) |
| R12 | Over-broad access by a future change | Low / High | Database-enforced access; automated tests | Re-run the three test suites after every migration |
| R13 | Supervisor location or facial images used beyond purpose | Low / Medium | GPS only at submission; selfies private | §4.1 selfie decision |

## 11. Before real children are registered (checklist)

1. **[DPO]** Decide the lawful basis and whether caregiver consent is needed (§5).
2. **[PROG]** Approve the caregiver notice and its Hausa translation (§5).
3. **[DPO]** Decide the cross-border transfer, or move the hosting region (§7).
4. **[PROG]** File the processors' DPAs (§7).
5. **[DPO]** Approve retention (§8); **[PROG]** build automatic deletion of identity details.
6. **[PROG]** Build identity correction in the app (§9).
7. **[PROG] — done 11 Oct (R168)** Build automatic sign-out on the OTP screens after inactivity (R2). Built for the whole app: 15 minutes, one-minute warning, not resumed after the app is closed.
8. **[PROG]** Set up the monthly access-log review (R1) and name the service-key holders (R7).
9. **[DPO]** Decide on small numbers in the State Coordinator's site reports (R5).
10. **[PROG]** Remove the DUMMY demo data (R11).
11. **[DPO][PROG]** Confirm HIV / ART status stays off the app (§4.2).
12. Clinical sign-off of the rule set (RULEBOOK Q22).

## 12. Breach handling [DPO]

Proposed: anyone who suspects a breach (a lost phone, a shared screen, a photo with a person, an
unexpected access in the log) reports it to the Project Admin the same day. The Project Admin
deactivates affected accounts and rotates keys if needed, records the incident, and informs the DPO.
The DPO decides on notification to the NDPC within **72 hours** of becoming aware [DPO: confirm]
and, where the breach is likely to put children or caregivers at high risk, informs the caregivers
through their OTP Officer. The access log, audit trail and provider logs support the investigation.

## 13. Sign-off

| Role | Name | Decision | Date |
| --- | --- | --- | --- |
| Data Protection Officer | | | |
| Programme lead | | | |
| Clinical authority (rule set) | | | |
