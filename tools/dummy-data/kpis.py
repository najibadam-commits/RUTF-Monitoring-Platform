"""Hand-calculated headline KPIs (brief §9) on the dummy data, straight from the CSV files.

These are the reference values for M5 ("KPIs match hand-calculated values on seed data"):
web-platform/tools/db/test-kpis.js compares them with the database's rutf_kpis().
Definitions match DECISIONS R38. Run from the repo root:

    python tools/dummy-data/kpis.py [YYYY-MM]        # default 2026-09; prints JSON
"""
import csv
import json
import statistics
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

D = Path(__file__).resolve().parents[2] / "data" / "dummy"
MOVE = {"receipt": 1, "issue": -1, "dispensed": -1, "loss_damaged": -1, "loss_expired": -1, "loss_other": -1, "adjustment": 1}


def load(name):
    return list(csv.DictReader(open(D / name, encoding="utf-8")))


month = sys.argv[1] if len(sys.argv) > 1 else "2026-09"
START = date.fromisoformat(month + "-01")
END = (START.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
Q_START = date(START.year, 3 * ((START.month - 1) // 3) + 1, 1)          # quarter of the period
MOS_FROM = (START.replace(day=1) - timedelta(days=1)).replace(day=1)       # three months ending END
MOS_FROM = (MOS_FROM - timedelta(days=1)).replace(day=1)

fac = {f["id"]: f for f in load("facilities.csv")}
th = {r["key"]: float(r["value"]) for r in load("rutf_thresholds.csv")}
txns = sorted(load("stock_transactions.csv"), key=lambda t: t["txn_date"])
transfers = load("transfers.csv")
disp = load("otp_daily_dispensing.csv")
visits = {v["id"]: v for v in load("monitoring_visits.csv")}
vers = load("otp_verifications.csv")

level = {fid: ("state_store" if f["facility_type"] == "state_store" else "lga_store" if f["facility_type"] == "lga_store"
               else "otp") for fid, f in fac.items() if f["facility_type"] != "health_facility" or f["is_otp_site"] == "True"}
d = lambda s: date.fromisoformat(s)

# Active = a store or OTP site with a receipt on or before END.
first_receipt = {}
for t in txns:
    if t["txn_type"] == "receipt" and t["facility_id"] in level:
        first_receipt.setdefault(t["facility_id"], d(t["txn_date"]))
active = {f for f, r in first_receipt.items() if r <= END}

# ---- stock on hand and months of stock, by level
balance = defaultdict(int)
outflow = defaultdict(int)
for t in txns:
    if t["txn_type"] == "physical_count" or d(t["txn_date"]) > END:
        continue
    q = MOVE[t["txn_type"]] * int(t["quantity_sachets"])
    balance[t["facility_id"]] += q
    if t["txn_type"] in ("issue", "dispensed") and d(t["txn_date"]) >= MOS_FROM:
        outflow[t["facility_id"]] += int(t["quantity_sachets"])
soh = {lv: sum(balance[f] for f in active if level[f] == lv) for lv in ("state_store", "lga_store", "otp")}
mos = {}
for lv in soh:
    monthly = sum(outflow[f] for f in active if level[f] == lv) / 3
    mos[lv] = round(soh[lv] / monthly, 2) if monthly else None

# ---- stockout rate: active facilities with a day ending at <= 0 in the period (from first receipt)
daily = defaultdict(lambda: defaultdict(int))
for t in txns:
    if t["txn_type"] != "physical_count" and t["facility_id"] in active:
        daily[t["facility_id"]][d(t["txn_date"])] += MOVE[t["txn_type"]] * int(t["quantity_sachets"])
stocked_out = 0
for f in active:
    running = sum(q for day, q in daily[f].items() if day < START)
    day, out = START, False
    while day <= END:
        running += daily[f].get(day, 0)
        if day >= first_receipt[f] and running <= 0:
            out = True
        day += timedelta(days=1)
    stocked_out += out
stockout_rate = round(stocked_out / len(active) * 100, 1)

# ---- mean stock variance over the period's count events: each count against the end-of-day
# ledger, i.e. every movement dated on or before it except that count's own adjustment (R38).
by_day = defaultdict(list)
for t in txns:
    by_day[t["txn_date"]].append(t)
running = defaultdict(int)
variances = []
for day in sorted(by_day):
    rows = by_day[day]
    is_count_adj = lambda t: t["txn_type"] == "adjustment" and "count" in (t["reason"] or "")
    for t in rows:
        if t["txn_type"] != "physical_count" and not is_count_adj(t):
            running[t["facility_id"]] += MOVE[t["txn_type"]] * int(t["quantity_sachets"])
    for t in rows:
        f = t["facility_id"]
        if t["txn_type"] == "physical_count" and START <= d(day) <= END and f in active and running[f] > 0                 and t["reason"] != "opening balance":
            variances.append(abs(running[f] - int(t["quantity_sachets"])) / running[f] * 100)
    for t in rows:
        if is_count_adj(t):
            running[t["facility_id"]] += MOVE[t["txn_type"]] * int(t["quantity_sachets"])
mean_variance = round(statistics.mean(variances), 2) if variances else None

# ---- transfers
in_transit = sum(1 for t in transfers if d(t["issued_date"]) <= END and (not t["received_date"] or d(t["received_date"]) > END))
discrepancies = sum(1 for t in transfers if t["status"] == "discrepancy" and START <= d(t["received_date"]) <= END)

# ---- short dispensing, completeness
p_sum = sum(int(r["sachets_prescribed"]) for r in disp if START <= d(r["dispense_date"]) <= END)
d_sum = sum(int(r["sachets_dispensed"]) for r in disp if START <= d(r["dispense_date"]) <= END)
short_pct = round((p_sum - d_sum) / p_sum * 100, 2) if p_sum else None

otps = [f for f in active if level[f] == "otp"]
blocks = (END - START).days + 1
blocks //= 7
seen = defaultdict(set)
for r in disp:
    day = d(r["dispense_date"])
    if START <= day < START + timedelta(days=7 * blocks):
        seen[r["facility_id"]].add((day - START).days // 7)
dispensing_completeness = round(sum(len(seen[o]) for o in otps) / (len(otps) * blocks) * 100, 1) if otps and blocks else None

due = int(th.get("count_due_day", 5))
counted = {t["facility_id"] for t in txns if t["txn_type"] == "physical_count" and t["reason"] != "opening balance"
           and END - timedelta(days=2) <= d(t["txn_date"]) <= END + timedelta(days=due)}
count_on_time = round(len([f for f in active if f in counted]) / len(active) * 100, 1)

# ---- losses
losses = defaultdict(int)
for t in txns:
    if t["txn_type"].startswith("loss_") and START <= d(t["txn_date"]) <= END:
        losses[t["txn_type"]] += int(t["quantity_sachets"])

# ---- OTP VF for the period's verifications
vfs = []
for v in vers:
    visit = visits[v["visit_id"]]
    if START <= d(visit["visit_date"]) <= END and v["register_present"] == "True" and v["sachets_dispensed_counted"] \
            and int(v["sachets_dispensed_recorded"]) > 0:
        vfs.append(round(int(v["sachets_dispensed_counted"]) / int(v["sachets_dispensed_recorded"]), 2))
vf_median = statistics.median(vfs) if vfs else None
vf_outside = round(sum(1 for x in vfs if not th["vf_min"] <= x <= th["vf_max"]) / len(vfs) * 100, 1) if vfs else None

# ---- supervision coverage in the quarter: stores + OTP sites visited / to visit
visited = {v["facility_id"] for v in visits.values() if Q_START <= d(v["visit_date"]) <= END}
to_visit = [f for f in active if level[f] in ("lga_store", "otp", "state_store")]
coverage = {"visited": len([f for f in to_visit if f in visited]), "to_visit": len(to_visit)}

print(json.dumps({
    "period": [START.isoformat(), END.isoformat()],
    "stock_on_hand": soh,
    "months_of_stock": mos,
    "stockout_rate_pct": stockout_rate,
    "mean_stock_variance_pct": mean_variance,
    "transfers_in_transit": in_transit,
    "transfers_with_discrepancy": discrepancies,
    "short_dispensing_pct": short_pct,
    "otp_vf_median": vf_median,
    "otp_vf_outside_pct": vf_outside,
    "dispensing_completeness_pct": dispensing_completeness,
    "count_on_time_pct": count_on_time,
    "losses": {k: losses.get(k, 0) for k in ("loss_damaged", "loss_expired", "loss_other")},
    "supervision_quarter": coverage,
}, indent=2))
