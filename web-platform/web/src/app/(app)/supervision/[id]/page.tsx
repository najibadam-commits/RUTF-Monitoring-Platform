import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { Flag, fmt } from "@/components/reports/ReportShell";
import { StatusTag, PriorityTag } from "@/components/ui/Tags";
import type { IssuePriority, IssueStatus } from "@/lib/types/database";

// One supervision visit (brief §9): the supervisor's count against the ledger, the checklist or
// register recount, evidence photos (signed links to the private visit-evidence bucket) and the
// Findings it raised.

const yes = (v: boolean | null | undefined) => (v === null || v === undefined ? "—" : v ? "Yes" : "No");

export default async function VisitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await getCurrentProfile();
  const { id } = await params;
  const supabase = await createClient();
  const { data: v } = await supabase.from("monitoring_visits").select("*, facility:facilities(id, name)").eq("id", id).maybeSingle();
  if (!v) notFound();
  const facility = v.facility as unknown as { id: string; name: string } | null;

  const [{ data: lines }, { data: store }, { data: otp }, { data: photos }, { data: findings }, { data: sup }] = await Promise.all([
    supabase.from("stock_check_lines").select("*, lot:product_lots(lot_no, expiry_date)").eq("visit_id", id),
    supabase.from("store_checks").select("*").eq("visit_id", id).maybeSingle(),
    supabase.from("otp_verifications").select("*").eq("visit_id", id).maybeSingle(),
    supabase.from("visit_photos").select("*").eq("visit_id", id),
    supabase.from("issues").select("id, code, status, priority, description, finding:finding_types(label)").eq("visit_id", id),
    supabase.from("profiles").select("name").eq("id", v.supervisor_id).maybeSingle(),
  ]);
  const signed = await Promise.all((photos ?? []).map(async (p) => ({
    ...p, url: (await supabase.storage.from("visit-evidence").createSignedUrl(p.storage_path, 3600)).data?.signedUrl ?? null,
  })));
  const vf = otp?.register_present && otp.sachets_dispensed_recorded && otp.sachets_dispensed_counted !== null
    ? otp.sachets_dispensed_counted / otp.sachets_dispensed_recorded : null;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100 }}>
      <div>
        <Link href="/supervision" style={{ fontSize: 13 }}><i className="ph ph-arrow-left" /> All visits</Link>
        <h2 style={{ margin: "6px 0 2px" }}>{v.code} · {v.visit_type === "store_check" ? "Store check" : "OTP verification"}</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          {facility ? <Link href={`/stock-ledger?facility=${facility.id}`}>{facility.name}</Link> : "—"} · {v.visit_date} · {sup?.name ?? "Supervisor"}
          {v.period_start && <> · period {v.period_start} to {v.period_end}</>}
        </p>
      </div>

      <div className="card elev-sm" style={{ padding: 14 }}>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", fontSize: 13 }}>
          <div><span className="text-muted">GPS</span><br />{Number(v.lat).toFixed(5)}, {Number(v.lng).toFixed(5)} (±{fmt(v.gps_accuracy_m)} m)</div>
          <div><span className="text-muted">Distance from the facility point</span><br />
            {v.distance_to_facility_m === null ? "Facility has no recorded location" : v.outside_geofence ? <Flag level="warning">{fmt(v.distance_to_facility_m)} m — outside the geofence</Flag> : `${fmt(v.distance_to_facility_m)} m`}
          </div>
        </div>
      </div>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "12px 16px", fontWeight: 600 }}>Count by lot</div>
        <table className="table">
          <thead><tr><th>Lot</th><th style={{ textAlign: "right" }}>Counted</th><th style={{ textAlign: "right" }}>Ledger</th><th style={{ textAlign: "right" }}>Stock card</th><th style={{ textAlign: "right" }}>Expired</th><th style={{ textAlign: "right" }}>Difference</th></tr></thead>
          <tbody>
            {(lines ?? []).map((l) => {
              const lot = l.lot as unknown as { lot_no: string; expiry_date: string } | null;
              const diff = l.system_balance === null ? null : l.physical_count - l.system_balance;
              return (
                <tr key={l.id}>
                  <td>{lot ? `${lot.lot_no} · exp. ${lot.expiry_date}` : l.lot_no_seen ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>{fmt(l.physical_count)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(l.system_balance)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(l.stock_card_balance)}</td>
                  <td style={{ textAlign: "right" }}>{l.expired_count > 0 ? <Flag level="critical">{fmt(l.expired_count)}</Flag> : 0}</td>
                  <td style={{ textAlign: "right" }}>{diff === null ? "—" : `${diff > 0 ? "+" : ""}${fmt(diff)}`}</td>
                </tr>
              );
            })}
            {(lines ?? []).length === 0 && <tr><td colSpan={6} className="text-muted" style={{ textAlign: "center", padding: 16 }}>No lots counted.</td></tr>}
          </tbody>
        </table>
      </div>

      {store && (
        <div className="card elev-sm" style={{ padding: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Store checklist</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, fontSize: 13 }}>
            <div>Stock card present: <strong>{yes(store.stock_card_present)}</strong></div>
            <div>Stock card up to date: <strong>{yes(store.stock_card_up_to_date)}</strong></div>
            <div>Store dry: <strong>{yes(store.storage_dry)}</strong></div>
            <div>Stock off the floor: <strong>{yes(store.storage_off_floor)}</strong></div>
            <div>Ventilated: <strong>{yes(store.storage_ventilated)}</strong></div>
            <div>Signs of pests: <strong>{yes(store.pests_seen)}</strong></div>
            <div>First-expiry-first-out: <strong>{yes(store.fefo_followed)}</strong></div>
          </div>
          {store.notes && <p style={{ margin: "8px 0 0", fontSize: 13 }}>{store.notes}</p>}
        </div>
      )}

      {otp && (
        <div className="card elev-sm" style={{ padding: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Register recount</div>
          {!otp.register_present ? <Flag level="critical">The register was not available</Flag> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, fontSize: 13 }}>
              <div>Admissions — register / app: <strong>{fmt(otp.admissions_counted)} / {fmt(otp.admissions_recorded)}</strong></div>
              <div>Sachets dispensed — register / app: <strong>{fmt(otp.sachets_dispensed_counted)} / {fmt(otp.sachets_dispensed_recorded)}</strong></div>
              <div>Verification factor: <strong>{vf === null ? "—" : vf.toFixed(2)}</strong></div>
            </div>
          )}
          {otp.notes && <p style={{ margin: "8px 0 0", fontSize: 13 }}>{otp.notes}</p>}
        </div>
      )}

      <div className="card elev-sm" style={{ padding: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Evidence</div>
        {signed.length === 0 ? <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>No photos.</p> : (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {signed.map((p) => p.url && (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, textAlign: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from a private bucket */}
                <img src={p.url} alt={p.kind.replace("_", " ")} style={{ width: 160, height: 120, objectFit: "cover", borderRadius: 8, border: "1px solid var(--color-divider)" }} />
                {p.kind.replace("_", " ")}
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="card elev-sm" style={{ padding: 0 }}>
        <div style={{ padding: "12px 16px", fontWeight: 600 }}>Findings raised</div>
        <table className="table">
          <tbody>
            {(findings ?? []).map((f) => (
              <tr key={f.id}>
                <td><Link href={`/issues/${f.id}`} style={{ fontWeight: 500 }}>{f.code}</Link><div className="text-muted" style={{ fontSize: 12 }}>{(f.finding as unknown as { label: string } | null)?.label}</div></td>
                <td style={{ fontSize: 13 }}>{f.description}</td>
                <td><PriorityTag priority={f.priority as IssuePriority} /></td>
                <td><StatusTag status={f.status as IssueStatus} /></td>
              </tr>
            ))}
            {(findings ?? []).length === 0 && <tr><td className="text-muted" style={{ padding: 16 }}>None — everything was within the limits.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
