import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, FacilityType, TxnType } from "@/lib/types/database";

// Reads behind the Stock Ledger and Transfers pages (migration 0101). Everything goes through the
// caller's own client, so RLS decides the scope — a facility user only ever gets their facility.

type Client = SupabaseClient<Database>;
type Txn = Database["public"]["Tables"]["stock_transactions"]["Row"];
const PAGE = 1000; // PostgREST's per-request row cap

/** Pages through a query builder factory until a short page comes back. */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

export const TXN_LABEL: Record<TxnType, string> = {
  receipt: "Receipt",
  issue: "Issue",
  dispensed: "Dispensed",
  loss_damaged: "Loss — damaged",
  loss_expired: "Loss — expired",
  loss_other: "Loss — other",
  adjustment: "Adjustment",
  physical_count: "Physical count",
};

/** Ledger sign, as ledger_signed_quantity() in migration 0101. */
export function signedQuantity(t: Pick<Txn, "txn_type" | "quantity_sachets">) {
  if (t.txn_type === "receipt" || t.txn_type === "adjustment") return t.quantity_sachets;
  if (t.txn_type === "physical_count") return 0;
  return -t.quantity_sachets;
}

export type FacilitySummary = {
  id: string;
  name: string;
  facility_type: FacilityType;
  lga_id: string;
  is_otp_site: boolean;
  balance: number;
  expiredBalance: number;
  nextExpiry: string | null;
  lastTxnDate: string | null;
};

/** Stores and OTP sites with their stock position, for the Stock Ledger list. */
export async function getFacilitySummaries(supabase: Client, today: string): Promise<FacilitySummary[]> {
  const [facilities, balances] = await Promise.all([
    all((from, to) =>
      supabase
        .from("facilities")
        .select("id, name, facility_type, lga_id, is_otp_site")
        .eq("status", "approved")
        .or("facility_type.neq.health_facility,is_otp_site.eq.true")
        .order("id")
        .range(from, to),
    ),
    all((from, to) => supabase.from("stock_balances").select("*").order("facility_id").order("lot_id").range(from, to)),
  ]);

  const byFacility = new Map<string, Omit<FacilitySummary, "id" | "name" | "facility_type" | "lga_id" | "is_otp_site">>();
  for (const b of balances) {
    const s = byFacility.get(b.facility_id) ?? { balance: 0, expiredBalance: 0, nextExpiry: null, lastTxnDate: null };
    s.balance += b.balance;
    if (b.expiry_date && b.balance > 0) {
      if (b.expiry_date < today) s.expiredBalance += b.balance;
      else if (!s.nextExpiry || b.expiry_date < s.nextExpiry) s.nextExpiry = b.expiry_date;
    }
    if (!s.lastTxnDate || b.last_txn_date > s.lastTxnDate) s.lastTxnDate = b.last_txn_date;
    byFacility.set(b.facility_id, s);
  }
  return facilities.map((f) => ({
    ...f,
    ...(byFacility.get(f.id) ?? { balance: 0, expiredBalance: 0, nextExpiry: null, lastTxnDate: null }),
  }));
}

export type LedgerRow = Txn & { runningBalance: number; lotNo: string | null; expiry: string | null };

/** Every ledger row of one facility, oldest first, with the running balance after each row. */
export async function getFacilityLedger(supabase: Client, facilityId: string) {
  const [txns, lots] = await Promise.all([
    all((from, to) =>
      supabase
        .from("stock_transactions")
        .select("*")
        .eq("facility_id", facilityId)
        .order("txn_date")
        .order("created_at")
        .order("local_id")
        .range(from, to),
    ),
    all((from, to) => supabase.from("product_lots").select("id, lot_no, expiry_date").order("id").range(from, to)),
  ]);
  const lotById = new Map(lots.map((l) => [l.id, l]));
  let running = 0;
  const rows: LedgerRow[] = txns.map((t) => {
    if (t.status !== "voided") running += signedQuantity(t);
    const lot = t.lot_id ? lotById.get(t.lot_id) : undefined;
    return { ...t, runningBalance: running, lotNo: lot?.lot_no ?? t.lot_no_seen, expiry: lot?.expiry_date ?? t.expiry_seen };
  });
  return rows;
}

/** id -> name for the facilities a page mentions (only the ones the caller may see resolve). */
export async function facilityNames(supabase: Client, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const names: Record<string, string> = {};
  for (let i = 0; i < unique.length; i += 300) {
    const { data } = await supabase.from("facilities").select("id, name").in("id", unique.slice(i, i + 300));
    for (const f of data ?? []) names[f.id] = f.name;
  }
  return names;
}
