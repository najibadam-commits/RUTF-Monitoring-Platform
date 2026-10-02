import { redirect } from "next/navigation";
import { DEVICES } from "@/lib/mock/devices";
import { tagBg } from "@/lib/constants";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessDevices } from "@/lib/rbac";

const DEVICE_STATUS_META: Record<string, { label: string; color: string }> = {
  active: { label: "Active", color: "var(--status-resolved)" },
  needs_sync: { label: "Needs Sync", color: "var(--priority-high)" },
  inactive: { label: "Inactive", color: "var(--color-neutral-500)" },
};

export default async function DevicesPage() {
  const profile = await getCurrentProfile();
  if (!canAccessDevices(profile.role)) redirect("/dashboard");

  const totalDevices = DEVICES.length;
  const activeCount = DEVICES.filter((d) => d.status === "active").length;
  const needsSyncCount = DEVICES.filter((d) => d.status === "needs_sync").length;
  const unassignedCount = DEVICES.filter((d) => d.assignedTo === "Unassigned").length;

  const kpiCards = [
    { label: "Total Devices", value: totalDevices, sub: "Registered field devices", icon: "ph-device-mobile" },
    { label: "Active Devices", value: activeCount, sub: "Synced within 7 days", icon: "ph-check-circle" },
    { label: "Needs Sync", value: needsSyncCount, sub: "No sync in 7+ days", icon: "ph-warning" },
    { label: "Unassigned", value: unassignedCount, sub: "Not issued to a field officer", icon: "ph-question" },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <h2 style={{ margin: 0 }}>Devices &amp; IMEI Tracking</h2>
          <span className="tag tag-outline">Preview · Sample Data</span>
        </div>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Field devices issued for data collection, and their last sync status.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {kpiCards.map((card) => (
          <div className="card elev-sm" key={card.label} style={{ gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="card-kicker">{card.label}</span>
              <i className={`ph ${card.icon}`} style={{ color: "var(--color-accent)" }} />
            </div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 2 }}>{card.value}</div>
            <div className="card-meta">{card.sub}</div>
          </div>
        ))}
      </div>

      <div className="card elev-sm" style={{ padding: 0 }}>
        <div className="card-title" style={{ padding: "14px 16px 0" }}>
          Registered Devices
        </div>
        <table className="table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>IMEI</th>
              <th>Assigned To</th>
              <th>Model</th>
              <th>Last Sync</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {DEVICES.map((d) => {
              const meta = DEVICE_STATUS_META[d.status];
              return (
                <tr key={d.imei}>
                  <td style={{ fontFamily: "var(--font-heading)" }}>{d.imei}</td>
                  <td className={d.assignedTo === "Unassigned" ? "text-muted" : undefined}>{d.assignedTo}</td>
                  <td className="text-muted">{d.model}</td>
                  <td className="text-muted">{new Date(d.lastSyncAt).toLocaleString()}</td>
                  <td>
                    <span className="tag" style={{ background: tagBg(meta.color), color: meta.color }}>
                      {meta.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
