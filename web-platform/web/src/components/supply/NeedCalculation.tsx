// How a supply request's quantity is worked out (migration 0138, DECISIONS R173), following the
// programme's "RUTF allocation from State to OTP centre": need over the cover period (the average
// of today's patients and the projected patients at the end, × each patient's ration a week ×
// weeks) minus usable stock, rounded up to whole cartons. Shown on the request form and, as saved
// with the request, to the reviewer. Server-rendered; no state.

export type SiteNeed = {
  facility_id: string; facility: string; facility_code: string | null; apex: boolean; source: string;
  patients: number; new_per_week: number; discharges_per_week: number; projected_patients_end: number; ration_per_patient_week: number;
  cover_days: number; need: number; usable_stock: number; gap: number;
};
export type MonthFigures = {
  month: string; weeks_reported: number; sites_reporting: number; otp_sites: number; patients_start: number; new_admissions: number; transfers_in: number;
  discharged_cured: number; defaulted: number; died: number; transferred_or_other: number; patients_end: number; otp_stock_end: number; store_stock_end: number | null; source: string;
};
export type Calculation = {
  level: "otp_to_lga" | "lga_to_state"; cover_days: number; buffer_pct: number; need: number; usable_total: number; gap: number; suggested_qty: number; calculated_at: string;
  site?: SiteNeed; sites?: SiteNeed[]; patients?: number; usable_at_sites?: number; usable_at_store?: number; month?: MonthFigures;
};

const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-GB"));
const cartons = (s: number, per = 150) => (s / per).toLocaleString("en-GB", { maximumFractionDigits: 1 });
const SOURCE: Record<string, string> = {
  registry: "Admission cards", "dispensing register": "Dispensing register", "last accepted weekly report": "Last weekly report", "no data": "No data",
};

export function MonthFiguresTable({ m, title }: { m: MonthFigures; title?: string }) {
  const month = new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const rows: [string, number | null][] = [
    ["Patients at the start of the month", m.patients_start], ["New admissions", m.new_admissions], ["Transfers in", m.transfers_in],
    ["Discharged cured", m.discharged_cured], ["Defaulted", m.defaulted], ["Died", m.died], ["Transferred, non-recovered or other", m.transferred_or_other],
    ["Patients at the end of the month", m.patients_end], ["RUTF at the OTP centres at the end (sachets)", m.otp_stock_end], ["RUTF at the LGA store at the end (sachets)", m.store_stock_end],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="card-title">{title ?? `Monthly figures · ${month}`}</div>
      <table className="table"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td style={{ textAlign: "right" }}><b>{n(v)}</b></td></tr>)}</tbody></table>
      <div className="kpi-sub">From {m.weeks_reported} accepted weekly OTP report{m.weeks_reported === 1 ? "" : "s"} ({m.sites_reporting} of {m.otp_sites} centres reporting).
        {m.weeks_reported === 0 ? " No accepted report for this month: the figures are empty." : ""}</div>
    </div>
  );
}

export function NeedCalculation({ calc, asked }: { calc: Calculation; asked?: number }) {
  const weeks = (calc.cover_days / 7).toLocaleString("en-GB", { maximumFractionDigits: 1 });
  const sites = calc.sites ?? (calc.site ? [calc.site] : []);
  return (
    <div className="card elev-sm" style={{ gap: 10 }}>
      <div className="card-title">How the quantity is worked out · {calc.cover_days} days ({weeks} weeks)</div>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        Need = the average of today&apos;s patients and the patients expected at the end of the period (today&apos;s + new admissions − discharges, at
        the recent weekly rate) × each patient&apos;s ration a week × {weeks} weeks. Then minus the usable stock{calc.level === "lga_to_state" ? " at the OTP centres and the LGA store" : ""},
        {calc.buffer_pct ? ` plus ${calc.buffer_pct}% safety stock,` : ""} rounded up to whole cartons.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead><tr><th>OTP centre</th><th>Figures from</th><th style={{ textAlign: "right" }}>Patients</th><th style={{ textAlign: "right" }}>New / week</th>
            <th style={{ textAlign: "right" }}>Discharged / week</th><th style={{ textAlign: "right" }}>Sachets / patient / week</th><th style={{ textAlign: "right" }}>Need</th>
            <th style={{ textAlign: "right" }}>Usable stock</th><th style={{ textAlign: "right" }}>Gap</th></tr></thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.facility_id}>
                <td>{s.facility}{s.apex ? <span className="tag tag-accent" style={{ marginLeft: 6 }}>Apex</span> : null}</td>
                <td className="text-muted" style={{ fontSize: 12.5 }}>{SOURCE[s.source] ?? s.source}</td>
                <td style={{ textAlign: "right" }}>{n(s.patients)}</td><td style={{ textAlign: "right" }}>{n(s.new_per_week)}</td>
                <td style={{ textAlign: "right" }}>{n(s.discharges_per_week)}</td><td style={{ textAlign: "right" }}>{n(s.ration_per_patient_week)}</td>
                <td style={{ textAlign: "right" }}>{n(s.need)}</td><td style={{ textAlign: "right" }}>{n(s.usable_stock)}</td><td style={{ textAlign: "right" }}>{n(s.gap)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <table className="table" style={{ maxWidth: 520 }}>
        <tbody>
          {calc.patients !== undefined && <tr><td>Patients under treatment (all centres)</td><td style={{ textAlign: "right" }}>{n(calc.patients)}</td></tr>}
          <tr><td>Need over {calc.cover_days} days</td><td style={{ textAlign: "right" }}>{n(calc.need)} sachets</td></tr>
          {calc.level === "lga_to_state"
            ? <>
                <tr><td>− usable stock at the OTP centres</td><td style={{ textAlign: "right" }}>{n(calc.usable_at_sites)}</td></tr>
                <tr><td>− usable stock at the LGA store</td><td style={{ textAlign: "right" }}>{n(calc.usable_at_store)}</td></tr>
              </>
            : <tr><td>− usable stock at the centre</td><td style={{ textAlign: "right" }}>{n(calc.usable_total)}</td></tr>}
          <tr><td><b>Suggested</b></td><td style={{ textAlign: "right" }}><b>{n(calc.suggested_qty)} sachets ({cartons(calc.suggested_qty)} cartons)</b></td></tr>
          {asked !== undefined && asked !== calc.suggested_qty && (
            <tr><td style={{ color: "var(--priority-high)" }}>Asked instead</td><td style={{ textAlign: "right", color: "var(--priority-high)" }}>{n(asked)} sachets ({cartons(asked)} cartons)</td></tr>
          )}
        </tbody>
      </table>
      {calc.month && <MonthFiguresTable m={calc.month} />}
    </div>
  );
}
