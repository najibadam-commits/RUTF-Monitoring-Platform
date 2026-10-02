"""Generate DUMMY reference and demo data for the Katsina RUTF platform proposal (brief v0.3).

Model: facility staff record receipts, issues, daily OTP dispensing, losses and month-end counts
(the stock ledger); LGA/State nutrition officers verify on supervision visits.

Everything this script writes is fictitious except facility names/coordinates, which come from
data/reference/katsina_health_facilities.csv. Replace with programme data during implementation
(see data/dummy/README.md).

Run from the repo root:  python tools/dummy-data/generate.py
Deterministic: the same SEED always produces the same files.
"""
import csv
import math
import random
import uuid
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

SEED = 20261002
ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "reference" / "katsina_health_facilities.csv"
OUT = ROOT / "data" / "dummy"

OTP_PER_LGA = 8
STATE_SUPERVISORS = 3
EMAIL_DOMAIN = "rutf-demo.example"          # reserved TLD: never a real mailbox
STATE_STORE = ("Katsina State Central Medical Store (DUMMY)", 12.9855, 7.6171)
LGA_FIXES = {"Danmusa": "Dan Musa"}
START, END = date(2026, 4, 1), date(2026, 9, 30)      # ledger period
SUPERVISION_MONTHS = [date(2026, 7, 1), date(2026, 8, 1), date(2026, 9, 1)]
UNITS_PER_CARTON = 150
SACHETS_PER_CHILD_WEEK = 17                 # mean of the dosing table for a typical caseload

rng = random.Random(SEED)
ns = uuid.UUID("6f1c1f43-6d1a-4a51-9f8e-2b7a0c3e9d10")


def uid(*parts):
    return str(uuid.uuid5(ns, "|".join(map(str, parts))))


def km(a_lat, a_lng, b_lat, b_lng):
    p = math.pi / 180
    h = (math.sin((b_lat - a_lat) * p / 2) ** 2
         + math.cos(a_lat * p) * math.cos(b_lat * p) * math.sin((b_lng - a_lng) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(h))


def jitter(lat, lng, metres):
    d = rng.uniform(0, metres) / 111_320
    a = rng.uniform(0, 2 * math.pi)
    return round(lat + d * math.cos(a), 6), round(lng + d * math.sin(a) / math.cos(lat * math.pi / 180), 6)


def days(a, b):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


def month_end(d):
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def write(name, rows):
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / name, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"{name:32s} {len(rows):6d} rows")


FIRST = ["Abubakar", "Aisha", "Bello", "Fatima", "Garba", "Hadiza", "Ibrahim", "Halima", "Kabir",
         "Zainab", "Lawal", "Maryam", "Musa", "Hauwa", "Nasiru", "Rabi", "Sani", "Safiya", "Umar",
         "Amina", "Yusuf", "Binta", "Aminu", "Asma'u", "Haruna", "Khadija", "Salisu", "Rukayya"]
LAST = ["Abdullahi", "Aliyu", "Bala", "Dauda", "Danjuma", "Gambo", "Hassan", "Idris", "Isa",
        "Jibrin", "Kankia", "Lawal", "Mahmud", "Mohammed", "Nuhu", "Rabiu", "Shehu", "Sule",
        "Tukur", "Usman", "Yakubu", "Zubairu"]
used_emails = set()


def person(role, level, title, lga="", facility_id=""):
    while True:
        fn, ln = rng.choice(FIRST), rng.choice(LAST)
        email = f"{fn}.{ln}".lower().replace("'", "") + f"@{EMAIL_DOMAIN}"
        if email not in used_emails:
            used_emails.add(email)
            break
    return {"id": uid("person", email), "full_name": f"{fn} {ln} (DUMMY)", "email": email,
            "role": role, "level_abbr": level, "job_title": title, "state": "Katsina", "lga": lga,
            "facility_id": facility_id}


# ================================================================ facilities
src = list(csv.DictReader(open(SRC, encoding="utf-8-sig")))
by_lga = defaultdict(list)
for r in src:
    r["lganame"] = LGA_FIXES.get(r["lganame"], r["lganame"])
    by_lga[r["lganame"]].append(r)

state_store_id = uid("facility", "state_store")
facilities = [{
    "id": state_store_id, "facility_type": "state_store", "name": STATE_STORE[0],
    "national_code": "", "state": "Katsina", "lga": "Katsina", "ward_name_source": "",
    "lat": STATE_STORE[1], "lng": STATE_STORE[2], "geocode_source": "manual",
    "supplied_by_facility_id": "", "is_otp_site": False, "is_hard_to_reach": False,
    "functional_status": "Functional", "category": "Medical Store", "dummy_fields": "all",
}]
lga_store = {}
otps = []
for lga in sorted(by_lga):
    rows = by_lga[lga]
    # LGA store co-located with the LGA's biggest facility (GH > Comprehensive > PHC).
    rank = {"General Hospital": 0, "Comprehensive Health Center": 1, "Comprehensive Health Centre": 1}
    hub = sorted(rows, key=lambda r: (rank.get(r["category"], 2), r["functional_status"] != "Functional",
                                      r["primary_name"]))[0]
    sid = uid("facility", "lga_store", lga)
    store = {
        "id": sid, "facility_type": "lga_store", "name": f"{lga} LGA Nutrition Store (DUMMY)",
        "national_code": "", "state": "Katsina", "lga": lga, "ward_name_source": hub["wardname"],
        "lat": round(float(hub["latitude"]), 6), "lng": round(float(hub["longitude"]), 6),
        "geocode_source": "manual", "supplied_by_facility_id": state_store_id, "is_otp_site": False,
        "is_hard_to_reach": False, "functional_status": "Functional", "category": "Medical Store",
        "dummy_fields": "all (located at " + hub["primary_name"] + ")",
    }
    lga_store[lga] = store
    facilities.append(store)
    pool = [r for r in rows if r["functional_status"] == "Functional"
            and r["category"] not in ("Maternity Home", "Educational Clinic", "Private Non Profit")
            and r["ownership"] != "Private"]
    chosen = {r["globalid"] for r in rng.sample(pool, min(OTP_PER_LGA, len(pool)))}
    dists = []
    for r in rows:
        is_otp = r["globalid"] in chosen
        rec = {
            "id": uid("facility", r["globalid"]), "facility_type": "health_facility",
            "name": r["primary_name"], "national_code": r["globalid"], "state": "Katsina", "lga": lga,
            "ward_name_source": r["wardname"], "lat": round(float(r["latitude"]), 6),
            "lng": round(float(r["longitude"]), 6), "geocode_source": "registry",
            "supplied_by_facility_id": sid if is_otp else "", "is_otp_site": is_otp,
            "is_hard_to_reach": False, "functional_status": r["functional_status"],
            "category": r["category"], "dummy_fields": "is_otp_site,supplied_by" if is_otp else "",
        }
        facilities.append(rec)
        if is_otp:
            otps.append(rec)
            dists.append((km(rec["lat"], rec["lng"], store["lat"], store["lng"]), rec))
    # Furthest 2 OTPs per LGA from the LGA store are flagged hard-to-reach.
    for _, rec in sorted(dists, key=lambda x: -x[0])[:2]:
        rec["is_hard_to_reach"] = True
        rec["dummy_fields"] += ",is_hard_to_reach"
write("facilities.csv", facilities)
lgas = sorted(lga_store)
fac_by_id = {f["id"]: f for f in facilities}

# ================================================================ people
people = [person("project_admin", "", "Nutrition Programme Manager (implementing partner)"),
          person("state_coordinator", "SST", "State Nutrition Officer's office reviewer"),
          person("state_coordinator", "SST", "UNICEF Nutrition / Supply Officer"),
          person("dri", "SST", "State store officer", facility_id=state_store_id)]
user_of = {state_store_id: people[-1]}
state_sups = [person("tpm_supervisor", "SST", "State nutrition / SMoH M&E supervisor (stores)")
              for _ in range(STATE_SUPERVISORS)]
people += state_sups
lga_sup = {}
for lga in lgas:
    s = lga_store[lga]
    user_of[s["id"]] = person("dri", "LST", "LGA store officer", lga=lga, facility_id=s["id"])
    lga_sup[lga] = person("tpm_supervisor", "OTP", "LGA Nutrition Officer (supervises OTPs)", lga=lga)
    people += [user_of[s["id"]], lga_sup[lga]]
for o in otps:
    user_of[o["id"]] = person("dri", "OTP", "OTP in-charge / nutrition focal person", lga=o["lga"],
                              facility_id=o["id"])
    people.append(user_of[o["id"]])
for i, sup in enumerate(state_sups):     # each State supervisor covers a third of the LGA stores
    sup["lga"] = ";".join(lgas[i::STATE_SUPERVISORS])
people.append(person("viewer", "", "UNICEF / SMoH read-only"))
write("people.csv", people)

# ================================================================ products, lots, rules, thresholds
product_id = uid("product", "rutf92")
write("products.csv", [{"id": product_id, "name": "RUTF paste 92 g sachet", "unit": "sachet",
                        "units_per_carton": UNITS_PER_CARTON, "shelf_life_months": 24}])
lots = []
for i, exp in enumerate([date(2026, 8, 31), date(2026, 12, 31), date(2027, 3, 31), date(2027, 6, 30),
                         date(2027, 11, 30), date(2028, 4, 30)]):
    lots.append({"id": uid("lot", i), "product_id": product_id, "lot_no": f"DUMMY-RUTF-{2401 + i * 37}",
                 "expiry_date": exp})
write("product_lots.csv", [{**l, "expiry_date": l["expiry_date"].isoformat()} for l in lots])

bands = [(3.5, 3.9, 10), (4.0, 4.4, 11), (4.5, 4.9, 12), (5.0, 5.9, 14), (6.0, 6.9, 17), (7.0, 7.9, 20),
         (8.0, 8.9, 23), (9.0, 9.9, 26), (10.0, 11.9, 28), (12.0, 99, 35)]
write("protocol_rules.csv", [{"protocol_version": "CMAM-175kcal-generic", "weight_min_kg": a,
                              "weight_max_kg": b, "sachets_per_week": s, "effective_from": "2026-01-01",
                              "effective_to": ""} for a, b, s in bands])
write("rutf_thresholds.csv", [{"key": k, "value": v} for k, v in [
    ("variance_pct_max", 5), ("variance_pct_max_remote", 10), ("vf_min", 0.90), ("vf_max", 1.10),
    ("geofence_m", 150), ("short_dispense_pct", 5), ("receipt_confirm_days", 7),
    ("reporting_gap_days", 7), ("adjustment_pct_max", 2), ("month_end_count_due_day", 5),
    ("routine_visit_interval_days", 90), ("high_risk_visit_interval_days", 30),
    ("supervisor_facilities_per_month", 8), ("min_cell_size", 5)]])

# ================================================================ planted problems
otp_ids = [o["id"] for o in otps]
shuffled = otp_ids[:]
rng.shuffle(shuffled)
n = len(otp_ids)
LEAKY = set(shuffled[: round(n * 0.06)])                 # app dispensing > register (VF < 0.9)
SHORT = set(shuffled[round(n * 0.06): round(n * 0.12)])  # dispensed < prescribed
LATE = set(shuffled[round(n * 0.12): round(n * 0.17)])   # gaps in daily reporting
MISCOUNT = set(shuffled[round(n * 0.17): round(n * 0.22)])  # month-end count below ledger
SLOW_RESUPPLY = set(shuffled[round(n * 0.22): round(n * 0.26)])  # stockouts
BAD_STORES = set(rng.sample([lga_store[l]["id"] for l in lgas], 4))  # store-level variance

# ================================================================ stock ledger simulation
txns, transfers, dispensing = [], [], []
bal = defaultdict(lambda: defaultdict(int))     # facility -> lot index -> sachets
seq = defaultdict(int)


def code(prefix, lga):
    seq[prefix] += 1
    return f"{prefix}-DUMMY-26-{seq[prefix]:06d}"


def txn(fac_id, ttype, d, lot_i, qty, recorder=None, **kw):
    t = {"id": uid("txn", len(txns)), "facility_id": fac_id, "txn_type": ttype, "txn_date": d.isoformat(),
         "lot_id": lots[lot_i]["id"] if lot_i is not None else "", "quantity_sachets": qty,
         "counterparty_facility_id": kw.get("cp", ""), "transfer_id": kw.get("transfer", ""),
         "document_no": kw.get("doc", ""), "reason": kw.get("reason", ""),
         "recorded_by_email": (recorder or user_of[fac_id])["email"],
         "device_id": f"DUMMY-DEVICE-{uuid.UUID(fac_id).int % 900 + 100}",
         "local_id": uid("local", "txn", len(txns)), "status": kw.get("status", "recorded")}
    txns.append(t)
    return t


def take_fefo(fac_id, qty, d):
    """Remove qty sachets earliest-expiry-first from unexpired lots; returns [(lot_i, qty)]."""
    out = []
    for i in sorted(bal[fac_id]):
        if qty <= 0:
            break
        if lots[i]["expiry_date"] < d or bal[fac_id][i] <= 0:
            continue
        q = min(qty, bal[fac_id][i])
        bal[fac_id][i] -= q
        qty -= q
        out.append((i, q))
    return out


def total(fac_id, d=None):
    return sum(q for i, q in bal[fac_id].items() if d is None or lots[i]["expiry_date"] >= d)


def ship(src_id, dst_id, d, qty, short=0, confirm_lag=None):
    """Issue from src, receipt at dst (unless unconfirmed). Returns the transfer row."""
    parts = take_fefo(src_id, qty, d)
    sent = sum(q for _, q in parts)
    if not sent:
        return None
    dst_lga = fac_by_id[dst_id]["lga"]
    tr = {"id": uid("transfer", len(transfers)), "code": code("TRF", dst_lga), "from_facility_id": src_id,
          "to_facility_id": dst_id, "issued_date": d.isoformat(), "received_date": "",
          "sachets_issued": sent, "sachets_received": "", "status": "in_transit"}
    transfers.append(tr)
    voucher = f"IV-{seq['TRF']:05d}"
    for i, q in parts:
        txn(src_id, "issue", d, i, q, cp=dst_id, transfer=tr["id"], doc=voucher)
    lag = rng.randint(1, 4) if confirm_lag is None else confirm_lag
    rd = d + timedelta(days=lag)
    if rd > END:
        return tr                                   # still in transit at period end
    received = 0
    for k, (i, q) in enumerate(parts):
        q_in = q - (short if k == 0 else 0)
        bal[dst_id][i] += q_in
        received += q_in
        txn(dst_id, "receipt", rd, i, q_in, cp=src_id, transfer=tr["id"], doc=voucher)
    tr.update(received_date=rd.isoformat(), sachets_received=received,
              status="received" if received == sent else "discrepancy")
    return tr


# Opening balances and supplier deliveries to the State store.
for i in (0, 1):
    q = 8000 * UNITS_PER_CARTON
    bal[state_store_id][i] += q
    txn(state_store_id, "receipt", START, i, q, doc=f"SUPPLIER-GRN-{i + 1:03d}", reason="opening delivery")
supplier = {date(2026, 4, 25): 2, date(2026, 5, 25): 2, date(2026, 6, 25): 3, date(2026, 7, 25): 3,
            date(2026, 8, 25): 4}
# Opening stock goes into the ledger as one receipt per lot (a physical_count moves no stock, so
# recording it that way left every store and OTP short in the ledger — RUTF DECISIONS R23).
def opening(fid, q):
    for i, qi in ((0, q // 2 if fid in lga_store_ids else q // 3), (1, q - (q // 2 if fid in lga_store_ids else q // 3))):
        bal[fid][i] += qi
        txn(fid, "receipt", START - timedelta(days=1), i, qi, doc="OPENING-BALANCE", reason="opening balance")


lga_store_ids = {s["id"] for s in lga_store.values()}
for s in lga_store.values():
    opening(s["id"], rng.randint(250, 400) * UNITS_PER_CARTON)

caseload = {o: rng.randint(15, 70) for o in otp_ids}
otp_day = {o: rng.randint(0, 4) for o in otp_ids}       # weekday the OTP runs (Mon–Fri)
for o in otp_ids:
    opening(o, rng.randint(8, 16) * UNITS_PER_CARTON)

lga_otps = defaultdict(list)
for o in otps:
    lga_otps[o["lga"]].append(o["id"])
count_rows = []          # month-end counts: (facility, date, ledger, counted)
snap = {}                # 'YYYY-MM' -> facility -> lot -> balance on the 20th (supervision visits)

for d in days(START, END):
    if d in supplier:
        q = 7000 * UNITS_PER_CARTON
        bal[state_store_id][supplier[d]] += q
        txn(state_store_id, "receipt", d, supplier[d], q, doc=f"SUPPLIER-GRN-{supplier[d] + 1:03d}")
    # State → LGA stores: monthly, on the 3rd, topping up to ~8 weeks of OTP need.
    if d.day == 3:
        for lga in lgas:
            s = lga_store[lga]["id"]
            need = sum(caseload[o] for o in lga_otps[lga]) * SACHETS_PER_CHILD_WEEK * 8
            gap = max(0, need - total(s, d))
            qty = round(gap / UNITS_PER_CARTON) * UNITS_PER_CARTON
            if qty:
                short = rng.choice([UNITS_PER_CARTON, 2 * UNITS_PER_CARTON]) if rng.random() < 0.05 else 0
                lag = 60 if (d.month == 9 and rng.random() < 0.1) else None   # never confirmed
                ship(state_store_id, s, d, qty, short=short, confirm_lag=lag)
    # LGA store → OTPs: fortnightly (1st and 15th), top up to ~5 weeks of use.
    if d.day in (1, 15):
        for lga in lgas:
            s = lga_store[lga]["id"]
            for o in lga_otps[lga]:
                if o in SLOW_RESUPPLY and d.day == 15 and d.month in (6, 8):
                    continue                                    # missed resupply → stockout
                need = caseload[o] * SACHETS_PER_CHILD_WEEK * 5
                gap = max(0, need - total(o, d))
                qty = math.ceil(gap / UNITS_PER_CARTON) * UNITS_PER_CARTON
                if qty:
                    short = rng.randint(10, 60) if rng.random() < 0.02 else 0
                    lag = 30 if (d.month == 9 and d.day == 15 and rng.random() < 0.03) else None
                    ship(s, o, d, qty, short=short, confirm_lag=lag)
    # OTP sessions: one service day per week.
    if d.weekday() < 5:
        for o in otp_ids:
            if d.weekday() != otp_day[o]:
                continue
            cl = max(5, caseload[o] + rng.randint(-3, 3))
            caseload[o] = cl
            new = max(0, round(cl * rng.uniform(0.08, 0.15)))
            prescribed = round(cl * SACHETS_PER_CHILD_WEEK * rng.uniform(0.95, 1.05))
            dispensed = prescribed
            if o in SHORT:
                dispensed = round(prescribed * rng.uniform(0.78, 0.9))
            available = total(o, d)
            dispensed = min(dispensed, available)
            recorded = dispensed
            if o in LEAKY:
                recorded = min(available, round(dispensed * rng.uniform(1.15, 1.3)))
            if o in LATE and rng.random() < 0.35:
                # Not recorded in the app — but sachets still leave the shelf.
                take_fefo(o, dispensed, d)
                continue
            parts = take_fefo(o, recorded, d)
            row = {"id": uid("disp", o, d), "facility_id": o, "dispense_date": d.isoformat(),
                   "new_admissions": new, "children_seen": cl, "sachets_prescribed": prescribed,
                   "sachets_dispensed": recorded, "sachets_dispensed_register": dispensed,
                   "recorded_by_email": user_of[o]["email"], "local_id": uid("local", "disp", o, d)}
            dispensing.append(row)
            for i, q in parts:
                txn(o, "dispensed", d, i, q, doc=f"OTP-REG-{d.isoformat()}")
    if d.day == 20:
        snap[d.strftime("%Y-%m")] = {f: dict(b) for f, b in bal.items()}
    # Month end: expire lot 0, then facility counts (by day 5 of next month).
    if d == month_end(d):
        for fid in list(bal):
            for i in list(bal[fid]):
                if lots[i]["expiry_date"] <= d and bal[fid][i] > 0:
                    q = bal[fid][i]
                    if rng.random() < 0.7:                         # most record the expiry loss
                        bal[fid][i] = 0
                        txn(fid, "loss_expired", d, i, q, reason="lot expired")
        for fid in [state_store_id] + [lga_store[l]["id"] for l in lgas] + otp_ids:
            if fid in LATE and rng.random() < 0.5:
                continue                                           # no month-end count
            ledger = total(fid)
            counted = ledger
            if fid in MISCOUNT or fid in BAD_STORES:
                counted = round(ledger * rng.uniform(0.86, 0.94))
            elif rng.random() < 0.15:
                counted = max(0, ledger - rng.randint(1, 8))       # small, under threshold
            txn(fid, "physical_count", d, None, counted)       # count "as at" month end
            count_rows.append((fid, d, ledger, counted))
            if counted != ledger:          # stock card adjusted to the shelf, pending supervisor OK
                diff = ledger - counted
                for i, q in take_fefo(fid, diff, d):
                    txn(fid, "adjustment", d, i, -q, reason="month-end count shortfall")
        # Damaged-in-store losses here and there.
        for fid in rng.sample(otp_ids, 6):
            q = rng.randint(2, 20)
            parts = take_fefo(fid, q, d)
            for i, q2 in parts:
                txn(fid, "loss_damaged", d, i, q2, reason="sachets torn / rodent damage")

write("transfers.csv", transfers)
write("stock_transactions.csv", txns)
write("otp_daily_dispensing.csv", [{k: v for k, v in r.items() if k != "sachets_dispensed_register"}
                                   for r in dispensing])

# ================================================================ supervision visits (Jul–Sep)
visits, lines, store_checks, otp_vers = [], [], [], []
reg = defaultdict(int)          # (otp, month) -> register dispensing (truth)
rec = defaultdict(int)          # (otp, month) -> app-recorded dispensing
adm = defaultdict(int)
for r in dispensing:
    k = (r["facility_id"], r["dispense_date"][:7])
    reg[k] += r["sachets_dispensed_register"]
    rec[k] += r["sachets_dispensed"]
    adm[k] += r["new_admissions"]
vseq = 0


def visit(vtype, fac, sup, vdate, far=False):
    global vseq
    vseq += 1
    lat, lng = jitter(fac["lat"], fac["lng"], rng.choice([250, 400, 900]) if far else 80)
    v = {"id": uid("visit", vseq), "code": f"VIS-DUMMY-26-{vseq:06d}", "visit_type": vtype,
         "facility_id": fac["id"], "supervisor_email": sup["email"], "visit_date": vdate.isoformat(),
         "period_start": "", "period_end": "", "lat": lat, "lng": lng, "gps_accuracy_m": rng.randint(4, 25),
         "distance_to_facility_m": round(km(lat, lng, fac["lat"], fac["lng"]) * 1000),
         "device_id": f"DUMMY-DEVICE-S{people.index(sup):03d}", "local_id": uid("local", "visit", vseq),
         "status": "submitted"}
    visits.append(v)
    return v


def count_lines(v, fid, problem):
    # Ledger balance by lot as of the 20th of the visit month (visits fall around then).
    for i, q in sorted(snap[v["visit_date"][:7]].get(fid, {}).items()):
        if q <= 0:
            continue
        phys = round(q * rng.uniform(0.85, 0.93)) if problem else q
        expired = q if lots[i]["expiry_date"] < date.fromisoformat(v["visit_date"]) else 0
        lines.append({"visit_id": v["id"], "lot_id": lots[i]["id"], "lot_no_seen": lots[i]["lot_no"],
                      "expiry_seen": lots[i]["expiry_date"].isoformat(),
                      "stock_card_balance": q if rng.random() > 0.1 else q + rng.randint(-30, 30),
                      "system_balance": q, "physical_count": phys,
                      "damaged_count": rng.choice([0, 0, 0, rng.randint(1, 10)]), "expired_count": expired})


for mi, m in enumerate(SUPERVISION_MONTHS):
    vd = lambda: m + timedelta(days=rng.randint(4, 27))
    # LGA stores: each once per quarter, by the State supervisor covering that LGA.
    for li, lga in enumerate(lgas):
        if li % 3 != mi:
            continue
        s = lga_store[lga]
        sup = state_sups[li % STATE_SUPERVISORS]
        v = visit("store_check", s, sup, vd(), far=rng.random() < 0.06)
        count_lines(v, s["id"], s["id"] in BAD_STORES)
        store_checks.append({"visit_id": v["id"], "stock_card_present": rng.random() > 0.05,
                             "stock_card_up_to_date": rng.random() > 0.15, "storage_dry": rng.random() > 0.1,
                             "storage_off_floor": rng.random() > 0.15, "storage_ventilated": rng.random() > 0.1,
                             "pests_seen": rng.random() < 0.08, "fefo_followed": rng.random() > 0.2,
                             "notes": "DUMMY"})
    # OTPs: each once per quarter by its LGA Nutrition Officer, verifying the previous month.
    for lga in lgas:
        for o in lga_otps[lga][mi::3]:
            fac = fac_by_id[o]
            v = visit("otp_verification", fac, lga_sup[lga], vd(), far=rng.random() < 0.05)
            prev = (m - timedelta(days=1)).replace(day=1)
            v["period_start"], v["period_end"] = prev.isoformat(), month_end(prev).isoformat()
            k = (o, prev.strftime("%Y-%m"))
            present = rng.random() > 0.04
            otp_vers.append({"visit_id": v["id"], "register_present": present,
                             "admissions_counted": adm[k] if present else "",
                             "sachets_dispensed_counted": reg[k] if present else "",
                             "admissions_recorded": adm[k], "sachets_dispensed_recorded": rec[k],
                             "notes": "DUMMY"})
            count_lines(v, o, o in MISCOUNT)

write("monitoring_visits.csv", visits)
write("stock_check_lines.csv", lines)
write("store_checks.csv", store_checks)
write("otp_verifications.csv", otp_vers)

# ================================================================ DHIS2 monthly (from the ledger)
# Facilities report to DHIS2 from their own registers; a few figures are mis-keyed on purpose.
agg = defaultdict(lambda: defaultdict(int))
for t in txns:
    if t["facility_id"] in fac_by_id and fac_by_id[t["facility_id"]]["is_otp_site"]:
        agg[(t["facility_id"], t["txn_date"][:7])][t["txn_type"]] += int(t["quantity_sachets"])
dhis2 = []
for (o, mon), a in sorted(agg.items()):
    if not START.strftime("%Y-%m") <= mon <= END.strftime("%Y-%m"):
        continue
    distributed = reg[(o, mon)]
    if rng.random() < 0.05:
        distributed = round(distributed * rng.uniform(1.1, 1.4))
    dhis2.append({"facility_id": o, "facility_name": fac_by_id[o]["name"], "lga": fac_by_id[o]["lga"],
                  "period": mon.replace("-", ""), "otp_admissions": adm[(o, mon)],
                  "rutf_sachets_received": a["receipt"], "rutf_sachets_distributed": distributed,
                  "rutf_sachets_wasted": a["loss_damaged"] + a["loss_expired"],
                  "rutf_stockout_days": 0})
write("dhis2_monthly.csv", dhis2)

# ================================================================ summary of planted problems
print("\nPlanted:", {"leaky_otps": len(LEAKY), "short_dispensing_otps": len(SHORT), "late_reporting_otps": len(LATE),
                     "miscount_otps": len(MISCOUNT), "slow_resupply_otps": len(SLOW_RESUPPLY),
                     "bad_lga_stores": len(BAD_STORES),
                     "transfers_discrepancy": sum(t["status"] == "discrepancy" for t in transfers),
                     "transfers_in_transit": sum(t["status"] == "in_transit" for t in transfers)})
