# Dummy data (proposal / demo only)

Everything here is **fictitious** except facility names and coordinates, which come from
`../reference/katsina_health_facilities.csv`. Names, emails and codes are tagged `DUMMY` so they
can't be mistaken for programme data. Replace each file with real data during implementation; the
loaders should treat these files as the expected format.

Model (brief v0.3): facility staff record receipts, issues, daily OTP dispensing, losses and
month-end counts; LGA/State nutrition officers verify on supervision visits.

```bash
python tools/dummy-data/generate.py   # deterministic, seed 20261002
python tools/dummy-data/check.py      # expected auto-Findings = reference values for M3/M5 tests
```

| File | Rows | Contents |
| --- | --- | --- |
| `facilities.csv` | 2,455 | 2,420 real facilities + 1 State store + 34 LGA stores (each placed at its LGA's general hospital or biggest PHC). 272 OTP sites (8 functional public facilities per LGA, random), linked to their LGA store; 68 flagged hard-to-reach |
| `people.csv` | 348 | Emails `@rutf-demo.example` (not real mailboxes). Facility users (`dri`): 1 State store, 34 LGA stores, 272 OTPs. Supervisors: 34 LGA Nutrition Officers (OTPs), 3 State officers (LGA stores). Plus programme manager, 2 Findings reviewers, 1 viewer |
| `products.csv`, `product_lots.csv` | 1 / 6 | 92 g sachet, 150/carton. Lot 1 expires Aug 2026 |
| `protocol_rules.csv`, `rutf_thresholds.csv` | 10 / 14 | Brief §12.3–12.4 defaults |
| `stock_transactions.csv` | ~16,700 | The ledger, Apr–Sep 2026: supplier deliveries, State → LGA monthly, LGA → OTP fortnightly, weekly OTP dispensing, losses, month-end counts, count adjustments |
| `transfers.csv` | ~3,100 | Every shipment with issued vs received and status |
| `otp_daily_dispensing.csv` | ~7,000 | One row per OTP session day: admissions, children seen, sachets prescribed / dispensed (aggregate, no child rows) |
| `monitoring_visits.csv` + `stock_check_lines.csv`, `store_checks.csv`, `otp_verifications.csv` | 306 visits | Jul–Sep 2026: each LGA store and each OTP supervised once in the quarter |
| `dhis2_monthly.csv` | 1,632 | Monthly per-OTP figures as reported to DHIS2; ~5% mis-keyed |

Planted problems and what `check.py` expects the rules to raise (current seed):
stock variance at 137 facility-months and 18 supervision counts, 68 transfer mismatches, 12
receipts never confirmed, 6 facilities with stockouts, 13 holding expired stock, 108 OTP-months of
short-dispensing, 13 OTPs with reporting gaps, 15 OTP verification factors out of range, 9
registers missing at visit, 7 poor-storage and 6 stock-card findings, 7 visits outside the geofence.

Not dummied (can't be): the DPIA, and the Supabase database password / secret key.
