import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getProgrammeLgas } from "@/lib/queries/lookups";
import { getFacilityMetrics, reportMonth, type FacilityMetric } from "@/lib/queries/metrics";
import { monthOf } from "@/lib/queries/kpis";
import { FacilityLink, Flag, ReportShell, fmt, type SP } from "@/components/reports/ReportShell";

export const metadata: Metadata = { title: "Last-Mile Dispensing" };

// Last-Mile Dispensing (brief §9; DECISIONS R89): did the RUTF reach the children? From the OTP
// registers' daily totals — dispensed against prescribed, children seen and new admissions — and
// the register check (verification factor) at the latest supervision visit. One status per OTP site,
// status tiles that filter the list (?flag=), a 6-month trend and an LGA roll-up. Aggregate figures
// only — no child-level data (brief §10).

const TREND_MONTHS = 6;
/** A ration size this far from the state median is called unusual (DECISIONS R114) — [VALIDATE]. */
const RATION_BAND = 0.25;

type Flagged = "short" | "over" | "vf" | "novisit" | "ok";

export default async function OtpDispensingPage({ searchParams }: { searchParams: Promise<SP> }) {
  await getCurrentProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const month = await reportMonth(supabase, sp.month);
  const trendMonths = Array.from({ length: TREND_MONTHS }, (_, i) => {
    const d = new Date(Date.UTC(Number(month.key.slice(0, 4)), Number(month.key.slice(5, 7)) - 1 - (TREND_MONTHS - 1 - i), 1));
    return monthOf(d.toISOString().slice(0, 7));
  });
  const filters = { level: "health_facility", lga: sp.lga };
  const [rowsAll, lgas, { data: th }, ...history] = await Promise.all([
    getFacilityMetrics(supabase, month, filters),
    getProgrammeLgas(supabase),
    supabase.from("rutf_thresholds").select("key, value").in("key", ["short_dispense_pct", "vf_min", "vf_max"]),
    ...trendMonths.slice(0, -1).map((m) => getFacilityMetrics(supabase, m, filters)),
  ]);
  const rows = rowsAll.filter((r) => r.is_otp_site);
  const t = Object.fromEntries((th ?? []).map((r) => [r.key, Number(r.value)]));
  const shortLimit = t.short_dispense_pct ?? 5;
  const [vfMin, vfMax] = [t.vf_min ?? 0.9, t.vf_max ?? 1.1];
  const lgaName = Object.fromEntries(lgas.map((l) => [l.id, l.name]));

  const short = (r: FacilityMetric) => Number(r.short_pct ?? 0) > shortLimit;
  const overDispensed = (r: FacilityMetric) => Number(r.short_pct ?? 0) < -shortLimit;
  const vfOut = (r: FacilityMetric) => r.last_vf !== null && (Number(r.last_vf) < vfMin || Number(r.last_vf) > vfMax);
  const flagsOf = (r: FacilityMetric): Flagged[] => {
    const f: Flagged[] = [];
    if (short(r)) f.push("short");
    if (overDispensed(r)) f.push("over");
    if (vfOut(r)) f.push("vf");
    if (r.last_vf === null) f.push("novisit");
    return f.length ? f : ["ok"];
  };
  const STATUS: Record<Flagged, { label: string; level: "warning" | "info" | "good"; icon: string; sub: string }> = {
    short: { label: `Short-dispensing over ${shortLimit}%`, level: "warning", icon: "ph-hand-heart", sub: "Children got less than prescribed" },
    over: { label: `Over-dispensing beyond ${shortLimit}%`, level: "warning", icon: "ph-arrows-out", sub: "More dispensed than prescribed" },
    vf: { label: "Register check out of range", level: "warning", icon: "ph-clipboard-text", sub: `Register vs app outside ${vfMin.toFixed(2)}–${vfMax.toFixed(2)}` },
    novisit: { label: "No register check yet", level: "info", icon: "ph-clock", sub: "No supervision visit recorded" },
    ok: { label: "On track", level: "good", icon: "ph-check-circle", sub: "Dispensed as prescribed, register matches" },
  };
  const COLOR = { warning: "var(--priority-high)", info: "var(--color-neutral-600)", good: "var(--status-resolved)" } as const;
  const order: Flagged[] = ["short", "vf", "over", "novisit", "ok"];

  const flagged = rows.map((r) => ({ r, flags: flagsOf(r) }));
  const countOf = (k: Flagged) => flagged.filter((x) => x.flags.includes(k)).length;
  const filter = order.includes(sp.flag as Flagged) ? (sp.flag as Flagged) : null;
  const shown = flagged
    .filter((x) => !filter || x.flags.includes(filter))
    .sort((a, b) => order.indexOf(a.flags[0]) - order.indexOf(b.flags[0]) || Number(b.r.short_pct ?? -999) - Number(a.r.short_pct ?? -999));

  const sum = (rs: FacilityMetric[], k: "sachets_prescribed" | "sachets_dispensed" | "children_seen" | "new_admissions") => rs.reduce((n, r) => n + r[k], 0);
  const prescribed = sum(rows, "sachets_prescribed");
  const dispensed = sum(rows, "sachets_dispensed");
  const delivered = prescribed ? (dispensed * 100) / prescribed : null;

  const trend = [...history.map((h) => h.filter((r) => r.is_otp_site)), rows].map((rs, i) => {
    const p = sum(rs, "sachets_prescribed");
    return {
      label: new Date(`${trendMonths[i].key}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" }),
      seen: sum(rs, "children_seen"),
      admissions: sum(rs, "new_admissions"),
      delivered: p ? (sum(rs, "sachets_dispensed") * 100) / p : null,
    };
  });
  const trendMax = Math.max(1, ...trend.map((x) => x.seen));

  const byLga = new Map<string, FacilityMetric[]>();
  for (const r of rows) byLga.set(r.lga_id, [...(byLga.get(r.lga_id) ?? []), r]);
  const lgaRows = [...byLga]
    .map(([id, rs]) => {
      const p = sum(rs, "sachets_prescribed");
      return { id, sites: rs.length, seen: sum(rs, "children_seen"), delivered: p ? (sum(rs, "sachets_dispensed") * 100) / p : null, short: rs.filter(short).length, vf: rs.filter(vfOut).length };
    })
    .sort((a, b) => b.short + b.vf - (a.short + a.vf) || (a.delivered ?? 100) - (b.delivered ?? 100))
    .slice(0, 10);

  function hrefWith(changes: Record<string, string | null>) {
    const params = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1]));
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/otp-dispensing?${qs}` : "/otp-dispensing";
  }

  // Sachets per child visit: the ration actually handed out, and OTP sites far from the norm.
  const perVisit = (r: FacilityMetric) => (r.children_seen > 0 ? r.sachets_dispensed / r.children_seen : null);
  const rations = rows.map(perVisit).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const medianRation = rations.length ? rations[Math.floor((rations.length - 1) / 2)] : null;
  const unusual = (r: FacilityMetric) => {
    const v = perVisit(r);
    return v !== null && medianRation !== null && Math.abs(v - medianRation) > RATION_BAND * medianRation;
  };
  const unusualCount = rows.filter(unusual).length;

  // Register check results at the latest visit, in bands.
  const vfBands = [
    { key: "low", label: `Below ${vfMin.toFixed(2)}`, meaning: "The register shows fewer sachets than the app: possible over-reporting in the app", n: rows.filter((r) => r.last_vf !== null && Number(r.last_vf) < vfMin).length, color: "var(--priority-high)" },
    { key: "ok", label: `${vfMin.toFixed(2)}–${vfMax.toFixed(2)}`, meaning: "Register and app agree", n: rows.filter((r) => r.last_vf !== null && !vfOut(r)).length, color: "var(--status-resolved)" },
    { key: "high", label: `Above ${vfMax.toFixed(2)}`, meaning: "The register shows more than the app: under-reporting or a parallel supply", n: rows.filter((r) => r.last_vf !== null && Number(r.last_vf) > vfMax).length, color: "var(--priority-critical)" },
    { key: "none", label: "Not checked yet", meaning: "No supervision visit recorded", n: rows.filter((r) => r.last_vf === null).length, color: "var(--color-neutral-400)" },
  ];
  const vfTotal = Math.max(1, rows.length);

  const reach = [
    { label: "Children seen", value: fmt(sum(rows, "children_seen")), sub: "Child visits in the OTP registers", icon: "ph-baby" },
    { label: "New admissions", value: fmt(sum(rows, "new_admissions")), sub: "Children newly admitted for SAM treatment", icon: "ph-user-plus" },
    { label: "Sachets dispensed", value: fmt(dispensed), sub: `of ${fmt(prescribed)} prescribed`, icon: "ph-package" },
    { label: "Dispensed against prescribed", value: delivered === null ? "—" : `${fmt(delivered, 1)}%`, sub: `On track within ±${shortLimit}% of 100%`, icon: "ph-hand-heart" },
    { label: "Sachets per child visit", value: medianRation === null ? "—" : fmt(medianRation, 1), sub: unusualCount ? `${fmt(unusualCount)} OTP sites more than ${RATION_BAND * 100}% from it` : `Median across OTP sites; none unusual`, icon: "ph-scales" },
  ];
  const tiles: Flagged[] = ["ok", "short", "vf", "over", "novisit"];

  return (
    <ReportShell
      title="Last-Mile Dispensing"
      intro={<>Did the RUTF reach the children? From the OTP registers&apos; daily totals for {month.label}: sachets dispensed against prescribed, children seen and new admissions, and the supervisor&apos;s register check at the latest visit (register count ÷ app-recorded dispensing; 1.00 is a perfect match, accepted range {vfMin.toFixed(2)}–{vfMax.toFixed(2)}). Aggregate totals only, no child-level data.</>}
      monthKey={month.key} lgas={lgas} sp={sp} showLevel={false}
      extraFilters={sp.flag ? <input type="hidden" name="flag" value={sp.flag} /> : undefined}
    >
      <div className="kpi-row">
        {reach.map((x) => (
          <div key={x.label} className="card elev-sm kpi-card">
            <div className="kpi-label">
              <i className={`ph-fill ${x.icon}`} aria-hidden="true" style={{ color: "var(--color-accent-600)" }} /> {x.label}
            </div>
            <div className="kpi-value">{x.value}</div>
            <div className="kpi-sub">{x.sub}</div>
          </div>
        ))}
      </div>

      <div className="kpi-row">
        {tiles.map((k) => {
          const st = STATUS[k];
          const active = filter === k;
          return (
            <Link key={k} href={hrefWith({ flag: active ? null : k })} className="card elev-sm kpi-card" aria-pressed={active}
              title={active ? "Show all OTP sites" : `List: ${st.label.toLowerCase()}`}
              style={{ textDecoration: "none", color: "inherit", outline: active ? "2px solid var(--color-accent-600)" : undefined, outlineOffset: -2 }}>
              <div className="kpi-label">
                <i className={`ph-fill ${st.icon}`} aria-hidden="true" style={{ color: COLOR[st.level] }} /> {st.label}
              </div>
              <div className="kpi-value">
                {fmt(countOf(k))}<span className="kpi-unit" style={{ fontWeight: 500 }}> OTP sites</span>
              </div>
              <div className="kpi-sub">{active ? "Filtered · click to clear" : st.sub}</div>
            </Link>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 12, alignItems: "start" }}>
        <div className="card elev-sm" style={{ padding: "12px 14px", gap: 8 }}>
          <div className="card-title" style={{ fontSize: 14 }}>Register check results</div>
          <div className="kpi-sub">The supervisor&apos;s count of the paper register ÷ the app&apos;s dispensing, at each OTP site&apos;s latest visit.</div>
          <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", background: "var(--color-neutral-100)" }} aria-hidden="true">
            {vfBands.map((b) => b.n > 0 && <span key={b.key} style={{ width: `${(b.n * 100) / vfTotal}%`, background: b.color }} />)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {vfBands.map((b) => (
              <div key={b.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: b.color, flex: "none", marginTop: 4 }} />
                <span style={{ flex: 1 }}>
                  <strong style={{ fontWeight: 600 }}>{b.label}</strong> <span className="text-muted">· {b.meaning}</span>
                </span>
                <strong>{fmt(b.n)}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="card elev-sm">
          <div className="card-title">Children reached, last {TREND_MONTHS} months</div>
          <div className="text-muted" style={{ fontSize: 12 }}>Children seen each month; the figure under each month is the share of prescribed sachets dispensed.</div>
          <div role="img" aria-label={trend.map((x) => `${x.label}: ${x.seen} children seen, ${x.admissions} new admissions, ${x.delivered === null ? "no" : x.delivered.toFixed(1) + "%"} dispensed`).join("; ")}
            style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 180, marginTop: 10 }}>
            {trend.map((x) => (
              <div key={x.label} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 3 }}>
                <span style={{ fontSize: 10.5 }}>{fmt(x.seen)}</span>
                <div title={`${x.label}: ${fmt(x.seen)} children seen · ${fmt(x.admissions)} new admissions`}
                  style={{ width: "70%", height: `${(x.seen / trendMax) * 75}%`, minHeight: x.seen ? 2 : 0, background: "var(--color-accent-500)", borderRadius: "4px 4px 0 0" }} />
                <div className="text-muted" style={{ fontSize: 11 }}>{x.label}</div>
                <div style={{ fontSize: 10.5, color: x.delivered !== null && 100 - x.delivered > shortLimit ? "var(--priority-high)" : "var(--color-neutral-600)" }}>
                  {x.delivered === null ? "—" : `${fmt(x.delivered, 1)}%`}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
          <div style={{ padding: "14px 16px 0" }}>
            <div className="card-title">By LGA</div>
            <div className="text-muted" style={{ fontSize: 12 }}>Most OTP sites short-dispensing or failing the register check first. Click to filter.</div>
          </div>
          <table className="table" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>LGA</th><th style={{ textAlign: "right" }}>Children seen</th><th style={{ textAlign: "right" }}>Dispensed</th>
                <th style={{ textAlign: "right" }}>Short</th><th style={{ textAlign: "right" }}>Register check</th>
              </tr>
            </thead>
            <tbody>
              {lgaRows.map((l) => (
                <tr key={l.id}>
                  <td><Link href={hrefWith({ lga: l.id })}>{lgaName[l.id] ?? "—"}</Link></td>
                  <td style={{ textAlign: "right" }}>{fmt(l.seen)}</td>
                  <td style={{ textAlign: "right" }}>{l.delivered === null ? "—" : `${fmt(l.delivered, 1)}%`}</td>
                  <td style={{ textAlign: "right" }}>{l.short ? <Flag level="warning">{l.short}</Flag> : 0}</td>
                  <td style={{ textAlign: "right" }}>{l.vf ? <Flag level="warning">{l.vf}</Flag> : 0}</td>
                </tr>
              ))}
              {lgaRows.length === 0 && <tr><td colSpan={5} className="text-muted" style={{ textAlign: "center", padding: 16 }}>No OTP sites.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "14px 16px 0" }}>
          <div className="card-title">{filter ? STATUS[filter].label : "Every OTP site"}</div>
          <span className="text-muted" style={{ fontSize: 12 }}>{fmt(shown.length)} OTP sites · most serious first</span>
        </div>
        <table className="table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>OTP site</th><th>Status</th><th style={{ textAlign: "right" }}>Children seen</th><th style={{ textAlign: "right" }}>New admissions</th>
              <th style={{ textAlign: "right" }}>Prescribed</th><th style={{ textAlign: "right" }}>Dispensed</th><th style={{ textAlign: "right" }}>Per visit</th>
              <th style={{ textAlign: "right" }}>Short</th><th style={{ textAlign: "right" }}>Register check</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ r, flags }) => {
              const st = STATUS[flags[0]];
              return (
                <tr key={r.facility_id}>
                  <td>
                    <FacilityLink id={r.facility_id} name={r.facility_name} />
                    <div className="text-muted" style={{ fontSize: 11.5 }}>{lgaName[r.lga_id] ?? "—"}</div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span style={{ color: COLOR[st.level], fontWeight: 600, fontSize: 12.5 }}>
                      <i className={`ph-fill ${st.icon}`} aria-hidden="true" /> {st.label}
                    </span>
                    {flags.length > 1 && <div className="text-muted" style={{ fontSize: 11 }}>+{flags.length - 1} more</div>}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmt(r.children_seen)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(r.new_admissions)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(r.sachets_prescribed)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(r.sachets_dispensed)}</td>
                  <td style={{ textAlign: "right" }} title={unusual(r) ? `More than ${RATION_BAND * 100}% from the median of ${medianRation === null ? "—" : fmt(medianRation, 1)}` : undefined}>
                    {perVisit(r) === null ? "—" : unusual(r) ? <Flag level="warning">{fmt(perVisit(r), 1)}</Flag> : fmt(perVisit(r), 1)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {r.short_pct === null ? "—" : short(r) || overDispensed(r) ? <Flag level="warning">{fmt(r.short_pct, 1)}%</Flag> : `${fmt(r.short_pct, 1)}%`}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {r.last_vf === null ? <span className="text-muted">No visit</span> : vfOut(r) ? <Flag level="warning">{Number(r.last_vf).toFixed(2)}</Flag> : Number(r.last_vf).toFixed(2)}
                    {r.last_visit_date && <div className="text-muted" style={{ fontSize: 11 }}>{r.last_visit_date}</div>}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={9} className="text-muted" style={{ textAlign: "center", padding: 24 }}>No OTP sites for these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </ReportShell>
  );
}
