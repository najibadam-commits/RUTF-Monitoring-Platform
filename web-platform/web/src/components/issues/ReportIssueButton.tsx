"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { PRIORITY_LABEL } from "@/lib/constants";
import type { IssuePriority } from "@/lib/types/database";
import { createIssueAction } from "@/lib/actions/issues";

interface Lookup {
  id: string;
  name: string;
}

export function ReportIssueButton({ categories, states }: { categories: Lookup[]; states: Lookup[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [lgas, setLgas] = useState<Lookup[]>([]);
  const [form, setForm] = useState({
    categoryId: categories[0]?.id ?? "",
    description: "",
    stateId: "",
    lgaId: "",
    wardId: null as string | null,
    ward: "",
    lat: null as number | null,
    lng: null as number | null,
    priority: "medium" as IssuePriority,
  });

  async function loadLgas(stateId: string) {
    const supabase = createClient();
    const { data } = await supabase.from("lgas").select("id, name").eq("state_id", stateId).order("name");
    setLgas(data ?? []);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setLocationNote("Geolocation isn't available in this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const supabase = createClient();
        const { data, error } = await supabase.rpc("resolve_administrative_location", { p_lat: latitude, p_lng: longitude });
        setLocating(false);
        if (error || !data || data.length === 0 || !data[0].state_id) {
          setLocationNote("Captured GPS, but couldn't match it to a known state/LGA/ward boundary — select manually below.");
          setForm((f) => ({ ...f, lat: latitude, lng: longitude }));
          return;
        }
        const match = data[0];
        setLocationNote(null);
        await loadLgas(match.state_id!);
        setForm((f) => ({
          ...f,
          lat: latitude,
          lng: longitude,
          stateId: match.state_id!,
          lgaId: match.lga_id ?? "",
          wardId: match.ward_id,
          ward: match.ward_name ?? "",
        }));
      },
      () => {
        setLocating(false);
        setLocationNote("Couldn't get your location — select the state/LGA manually below.");
      },
    );
  }

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <i className="ph ph-plus" /> Report Issue
      </button>
      {open && (
        <Modal
          title="Report New Issue"
          confirmLabel="Submit"
          confirmDisabled={!form.categoryId || !form.description.trim() || !form.stateId || !form.lgaId}
          onClose={() => setOpen(false)}
          onConfirm={async () => {
            const result = await createIssueAction(form);
            if (!result.error && result.id) router.push(`/issues/${result.id}`);
            return result;
          }}
        >
          <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={useMyLocation} disabled={locating}>
              <i className="ph ph-map-pin" /> {locating ? "Locating…" : "Use My GPS Location"}
            </button>
            {locationNote && (
              <div className="text-muted" style={{ fontSize: 11.5 }}>
                {locationNote}
              </div>
            )}
            {form.lat && form.lng && (
              <div className="text-muted" style={{ fontSize: 11.5 }}>
                GPS {form.lat.toFixed(4)}, {form.lng.toFixed(4)}
              </div>
            )}
            <div className="field">
              <label>Sector</label>
              <select className="input" value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Priority</label>
              <select className="input" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as IssuePriority }))}>
                {(["critical", "high", "medium", "low"] as IssuePriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>State</label>
              <select
                className="input"
                value={form.stateId}
                onChange={(e) => {
                  setForm((f) => ({ ...f, stateId: e.target.value, lgaId: "" }));
                  loadLgas(e.target.value);
                }}
              >
                <option value="">Select a state…</option>
                {states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>LGA</label>
              <select className="input" value={form.lgaId} onChange={(e) => setForm((f) => ({ ...f, lgaId: e.target.value }))} disabled={!form.stateId}>
                <option value="">Select an LGA…</option>
                {lgas.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Ward (optional)</label>
              <input className="input" value={form.ward} onChange={(e) => setForm((f) => ({ ...f, ward: e.target.value }))} />
            </div>
            <div className="field">
              <label>Description</label>
              <textarea className="input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Describe the issue…" />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
