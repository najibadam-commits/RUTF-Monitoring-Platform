"use client";

import { useState } from "react";
import type { AttendanceRow } from "@/lib/queries/attendance";
import { findReusedDeviceIds } from "@/lib/attendanceDeviceReuse";

type Row = AttendanceRow & { selfieUrl: string | null; locationPhotoUrl: string | null };

export function AttendanceTable({ records }: { records: Row[] }) {
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null);
  const reusedDeviceIds = findReusedDeviceIds(records);

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>Field Monitor Attendance</h2>
        <p className="text-muted" style={{ fontSize: 13 }}>
          {records.length} record{records.length === 1 ? "" : "s"} — one per Field Monitor per day.
        </p>
      </div>

      {reusedDeviceIds.size > 0 && (
        <div className="card elev-sm" style={{ padding: "12px 16px", borderLeft: "3px solid var(--priority-high)" }}>
          <strong style={{ fontWeight: 600, fontSize: 13 }}>
            <i className="ph ph-warning" style={{ color: "var(--priority-high)" }} /> Device reuse detected
          </strong>
          <p className="text-muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>
            {reusedDeviceIds.size} device{reusedDeviceIds.size === 1 ? "" : "s"} submitted attendance under more than one Field Monitor account — flagged rows below. Not
            automatically blocked (a phone can legitimately change hands); review before acting on it.
          </p>
        </div>
      )}

      <div className="card elev-sm" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Field Monitor</th>
              <th>Date</th>
              <th>Time</th>
              <th>Location</th>
              <th>Selfie</th>
              <th>Assignment Location</th>
              <th>Device ID</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const flagged = reusedDeviceIds.has(r.device_id);
              return (
                <tr key={r.id} style={flagged ? { background: "color-mix(in srgb, var(--priority-high) 6%, transparent)" } : undefined}>
                  <td>{r.field_monitor?.name ?? "—"}</td>
                  <td className="text-muted">{r.attendance_date}</td>
                  <td className="text-muted">{new Date(r.captured_at).toLocaleTimeString()}</td>
                  <td className="text-muted" style={{ fontSize: 12 }}>
                    {r.state?.name ?? "—"}
                    {r.lga?.name ? ` · ${r.lga.name}` : ""}
                    <br />
                    {Number(r.lat).toFixed(4)}, {Number(r.lng).toFixed(4)}
                    {r.gps_accuracy_m != null ? ` (±${Math.round(r.gps_accuracy_m)}m)` : ""}
                  </td>
                  <td>
                    {r.selfieUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={r.selfieUrl}
                        alt="Selfie"
                        style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, cursor: "pointer" }}
                        onClick={() => setLightbox({ url: r.selfieUrl!, label: `${r.field_monitor?.name ?? "Selfie"} — ${r.attendance_date}` })}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {r.locationPhotoUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={r.locationPhotoUrl}
                        alt="Assignment location"
                        style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, cursor: "pointer" }}
                        onClick={() => setLightbox({ url: r.locationPhotoUrl!, label: `Assignment location — ${r.attendance_date}` })}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-muted" style={{ fontSize: 11.5, fontFamily: "monospace" }}>
                    {flagged && <i className="ph ph-warning" style={{ color: "var(--priority-high)", marginRight: 4 }} title="Used by more than one Field Monitor" />}
                    {r.device_id}
                  </td>
                  <td>
                    <span className="tag" style={{ background: "color-mix(in srgb, var(--status-resolved) 20%, transparent)", color: "var(--status-resolved)" }}>
                      Synced
                    </span>
                  </td>
                </tr>
              );
            })}
            {records.length === 0 && (
              <tr>
                <td colSpan={8} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                  No attendance records yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {lightbox && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onMouseDown={(e) => e.target === e.currentTarget && setLightbox(null)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", maxWidth: "90vw", maxHeight: "90vh" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox.url} alt={lightbox.label} style={{ maxWidth: "90vw", maxHeight: "80vh", borderRadius: 8 }} />
            <div style={{ color: "#fff", fontSize: 13, display: "flex", alignItems: "center", gap: 12 }}>
              <span>{lightbox.label}</span>
              <button className="btn btn-secondary" onClick={() => setLightbox(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
