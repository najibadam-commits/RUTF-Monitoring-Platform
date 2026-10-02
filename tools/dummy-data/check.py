"""Replay the dummy ledger and compute what the auto-Finding rules (brief §6) should raise.

These hand-calculated numbers are the reference values for M3 (Findings) and M5 (KPIs) tests.
Run from the repo root:  python tools/dummy-data/check.py
"""
import csv
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

D = Path(__file__).resolve().parents[2] / "data" / "dummy"


def load(name):
    return list(csv.DictReader(open(D / name, encoding="utf-8")))


fac = {f["id"]: f for f in load("facilities.csv")}
th = {r["key"]: float(r["value"]) for r in load("rutf_thresholds.csv")}
lots = {l["id"]: date.fromisoformat(l["expiry_date"]) for l in load("product_lots.csv")}
# Replayed in date order (file order within a day) — the generator writes a transfer's receipt row
# when the transfer is issued but dates it days later, and the ledger counts it from its date
# (RUTF DECISIONS R30).
txns = sorted(load("stock_transactions.csv"), key=lambda t: t["txn_date"])
MOVE = {"receipt": 1, "issue": -1, "dispensed": -1, "loss_damaged": -1, "loss_expired": -1,
        "loss_other": -1, "adjustment": 1}
END = date(2026, 9, 30)

# ---- ledger replay (by date)
bal = defaultdict(int)
lot_bal = defaultdict(lambda: defaultdict(int))
variance, stockout_days = [], defaultdict(set)
for t in txns:
    f, q = t["facility_id"], int(t["quantity_sachets"])
    if t["txn_type"] == "physical_count":
        if t["reason"] == "opening balance":
            bal[f] = q
            continue
        ledger = bal[f]
        if ledger:
            pct = abs(ledger - q) / ledger * 100
            limit = th["variance_pct_max_remote"] if fac[f]["is_hard_to_reach"] == "True" else th["variance_pct_max"]
            if pct > limit:
                variance.append((f, t["txn_date"], round(pct, 1)))
        continue
    bal[f] += MOVE[t["txn_type"]] * q
    if t["lot_id"]:
        lot_bal[f][t["lot_id"]] += MOVE[t["txn_type"]] * q
    if t["txn_type"] in ("dispensed", "issue") and bal[f] <= 0:
        stockout_days[f].add(t["txn_date"])

transfers = load("transfers.csv")
mismatch = [t for t in transfers if t["status"] == "discrepancy"]
unconfirmed = [t for t in transfers if t["status"] == "in_transit"
               and (END - date.fromisoformat(t["issued_date"])).days > th["receipt_confirm_days"]]
expired = [f for f, lb in lot_bal.items() if any(q > 0 and lots[l] < END for l, q in lb.items())]

disp = load("otp_daily_dispensing.csv")
by_month = defaultdict(lambda: [0, 0])
last_day = defaultdict(str)
for r in disp:
    k = (r["facility_id"], r["dispense_date"][:7])
    by_month[k][0] += int(r["sachets_prescribed"])
    by_month[k][1] += int(r["sachets_dispensed"])
    last_day[r["facility_id"]] = max(last_day[r["facility_id"]], r["dispense_date"])
short = [(k, round((p - d) / p * 100, 1)) for k, (p, d) in by_month.items()
         if p and (p - d) / p * 100 > th["short_dispense_pct"]]

# late reporting: OTP-weeks (Apr–Sep) with no dispensing row
weeks = defaultdict(set)
for r in disp:
    weeks[r["facility_id"]].add(date.fromisoformat(r["dispense_date"]).isocalendar()[1])
all_weeks = {date(2026, 4, 1) + timedelta(days=7 * i) for i in range(26)}
all_weeks = {d.isocalendar()[1] for d in all_weeks}
otps = [f for f in fac.values() if f["is_otp_site"] == "True"]
late = {o["id"]: len(all_weeks - weeks[o["id"]]) for o in otps if len(all_weeks - weeks[o["id"]]) > 1}

vers = load("otp_verifications.csv")
vf_out = [v for v in vers if v["sachets_dispensed_counted"] and int(v["sachets_dispensed_recorded"])
          and not th["vf_min"] <= int(v["sachets_dispensed_counted"]) / int(v["sachets_dispensed_recorded"]) <= th["vf_max"]]
reg_missing = [v for v in vers if v["register_present"] == "False"]
visits = load("monitoring_visits.csv")
far = [v for v in visits if int(v["distance_to_facility_m"]) > th["geofence_m"]]
sc = load("store_checks.csv")
poor = [s for s in sc if s["storage_dry"] == "False" or s["storage_off_floor"] == "False" or s["pests_seen"] == "True"]
nocard = [s for s in sc if s["stock_card_present"] == "False" or s["stock_card_up_to_date"] == "False"]
lines = load("stock_check_lines.csv")
sup_var = defaultdict(lambda: [0, 0])
for l in lines:
    sup_var[l["visit_id"]][0] += int(l["system_balance"])
    sup_var[l["visit_id"]][1] += int(l["physical_count"])
sup_variance = [v for v, (s, p) in sup_var.items() if s and abs(s - p) / s * 100 > th["variance_pct_max"]]
adjust = [t for t in txns if t["txn_type"] == "adjustment"]

print("Expected auto-Findings on the dummy data (brief §6):")
for k, v in [
    ("stock_variance (month-end counts)", len(variance)),
    ("stock_variance (supervisor counts)", len(sup_variance)),
    ("transfer_mismatch", len(mismatch)),
    ("receipt_not_confirmed", len(unconfirmed)),
    ("stockout (facilities with >=1 day)", len(stockout_days)),
    ("expired_stock (facilities holding expired lots at 30 Sep)", len(expired)),
    ("short_dispensing (OTP-months)", len(short)),
    ("late_reporting (OTPs missing >1 week)", len(late)),
    ("dispensing_gap (VF outside range)", len(vf_out)),
    ("register_missing", len(reg_missing)),
    ("poor_storage", len(poor)),
    ("no_stock_card", len(nocard)),
    ("visits outside geofence", len(far)),
    ("adjustments recorded (pending supervisor confirmation)", len(adjust)),
]:
    print(f"  {k:58s} {v:5d}")
