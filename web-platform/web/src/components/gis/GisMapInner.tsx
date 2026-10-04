"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import L from "leaflet";
import "leaflet.markercluster";
import { createClient } from "@/lib/supabase/client";
import { PRIORITY_COLOR, PRIORITY_LABEL, STATUS_COLOR, STATUS_LABEL, tagBg } from "@/lib/constants";

export interface GisIssue {
  id: string;
  code: string;
  description: string;
  status: string;
  priority: string;
  lat: number;
  lng: number;
  reportedAt: string;
  category: string;
  stateId: string;
  stateName: string;
  lgaId: string;
  lgaName: string;
  ward: string;
  /** "Automatic checks", or the person who registered it (DECISIONS R74). */
  reportedBy: string;
  driName: string | null;
}

/** A store or OTP site for the facility layer (brief §9 map; migration 0105 metrics). */
export interface GisFacility {
  id: string;
  name: string;
  type: "state_store" | "lga_store" | "health_facility";
  lgaId: string;
  lat: number;
  lng: number;
  balance: number;
  monthsOfStock: number | null;
  risk: number | null;
}

type FacilityMeasure = "off" | "risk" | "mos";
type FacilityClass = { key: string; label: string; color: string };

const FACILITY_CLASSES: Record<Exclude<FacilityMeasure, "off">, FacilityClass[]> = {
  risk: [
    { key: "high", label: "High risk", color: "var(--priority-critical)" },
    { key: "medium", label: "Medium risk", color: "var(--priority-high)" },
    { key: "low", label: "Low risk", color: "var(--status-resolved)" },
    { key: "none", label: "No score", color: "var(--color-neutral-500)" },
  ],
  mos: [
    { key: "lt1", label: "Under 1 month", color: "var(--priority-critical)" },
    { key: "lt2", label: "1–2 months", color: "var(--priority-high)" },
    { key: "ok", label: "2–6 months", color: "var(--status-resolved)" },
    { key: "gt6", label: "Over 6 months", color: "var(--color-accent)" },
    { key: "none", label: "No outflow this month", color: "var(--color-neutral-500)" },
  ],
};

function classify(f: GisFacility, measure: Exclude<FacilityMeasure, "off">, riskHigh: number): FacilityClass {
  const c = FACILITY_CLASSES[measure];
  const pick = (key: string) => c.find((x) => x.key === key)!;
  if (measure === "risk") {
    if (f.risk === null) return pick("none");
    return pick(f.risk >= riskHigh ? "high" : f.risk >= riskHigh / 2 ? "medium" : "low");
  }
  if (f.monthsOfStock === null) return pick("none");
  return pick(f.monthsOfStock < 1 ? "lt1" : f.monthsOfStock < 2 ? "lt2" : f.monthsOfStock <= 6 ? "ok" : "gt6");
}

const LEVEL_NAME: Record<GisFacility["type"], string> = { state_store: "State store", lga_store: "LGA store", health_facility: "OTP site" };
const esc = (t: string) => t.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Store = square, OTP site = diamond — different from the round Finding pins. */
function facilityIconHtml(f: GisFacility, color: string) {
  const store = f.type !== "health_facility";
  const size = store ? 14 : 11;
  return `<div style="width:${size}px;height:${size}px;background:${color};border:2px solid #fff;border-radius:${store ? 3 : 2}px;box-shadow:0 0 0 1px rgba(0,0,0,.35);${store ? "" : "transform:rotate(45deg);"}"></div>`;
}

interface Props {
  issues: GisIssue[];
  facilities: GisFacility[];
  facilityMonth: string;
  riskHigh: number;
  states: { id: string; name: string }[];
  lgas: { id: string; stateId: string; name: string }[];
  categories: string[];
  statuses: { value: string; label: string; color: string }[];
  reporters: string[];
  driNames: string[];
  /** The state the map opens on (the pilot state); "All" when not given. */
  defaultStateId?: string;
}

/** Finding statuses that are still open (not yet verified and closed). */
const isOpen = (status: string) => status !== "verified_closed";

const ALL = "All";
const DEFAULT_CENTER: [number, number] = [9.08, 8.68];
const DEFAULT_ZOOM = 6;

export function GisMapInner({ issues, facilities, facilityMonth, riskHigh, states, lgas, categories, statuses, reporters, driNames, defaultStateId }: Props) {
  const homeState = defaultStateId && states.some((s) => s.id === defaultStateId) ? defaultStateId : ALL;
  const [filters, setFilters] = useState({ state: homeState, lga: ALL, category: ALL, status: ALL, reporter: ALL, dri: ALL });
  // The pilot state's extent from its Findings, so the map opens there at once; the LGA outlines
  // refine it when they load.
  const [homeBounds] = useState(() => {
    const pts = homeState === ALL ? [] : issues.filter((i) => i.stateId === homeState).map((i) => [i.lat, i.lng] as [number, number]);
    return pts.length ? L.latLngBounds(pts) : null;
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLga, setSelectedLga] = useState<{ id: string; name: string } | null>(null);
  const [wardsUnavailable, setWardsUnavailable] = useState(false);
  const [facilityMeasure, setFacilityMeasure] = useState<FacilityMeasure>("risk");
  const facilityLayerRef = useRef<L.LayerGroup | null>(null);

  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const boundaryLayerRef = useRef<L.GeoJSON | null>(null);
  const lgaLayerRef = useRef<L.GeoJSON | null>(null);
  const wardLayerRef = useRef<L.GeoJSON | null>(null);
  const layersControlRef = useRef<L.Control.Layers | null>(null);

  const filtered = useMemo(
    () =>
      issues.filter(
        (i) =>
          (filters.state === ALL || i.stateId === filters.state) &&
          (filters.lga === ALL || i.lgaId === filters.lga) &&
          (filters.category === ALL || i.category === filters.category) &&
          (filters.status === ALL || i.status === filters.status) &&
          (filters.reporter === ALL || i.reportedBy === filters.reporter) &&
          (filters.dri === ALL || i.driName === filters.dri),
      ),
    [issues, filters],
  );

  // Only State (or no filter at all) is active — the existing state-boundary effect below already
  // zooms to the whole state's (or the whole country's) extent, which reads better than fitting
  // tightly to wherever the state's issues happen to cluster. Every other filter (alone or combined
  // with State) fits to the actual matching markers instead — see the effect further down.
  const onlyGeographicFilterActive = filters.lga === ALL && filters.category === ALL && filters.status === ALL && filters.reporter === ALL && filters.dri === ALL;

  const lgaOptions = useMemo(
    () => (filters.state === ALL ? lgas : lgas.filter((l) => l.stateId === filters.state)),
    [lgas, filters.state],
  );

  const selected = filtered.find((i) => i.id === selectedId) ?? null;
  const noResults = filtered.length === 0;

  // init map + basemaps + layers control + cluster group + state boundary base layer once
  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return;
    // Guards the async boundary-load callback below against a stale invocation (e.g. React
    // Strict Mode's dev-only double-invoke of effects) outliving this particular mount and
    // registering a duplicate "State Boundaries" overlay on the map the second mount created.
    let cancelled = false;
    const map = L.map(mapNodeRef.current, { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    if (homeBounds) map.fitBounds(homeBounds, { padding: [24, 24] });

    const openTopoMap = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors, SRTM &copy; OpenTopoMap (CC-BY-SA)",
      subdomains: "abc",
      maxZoom: 17,
    }).addTo(map);
    const streets = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      subdomains: "abc",
      maxZoom: 19,
    });
    const satellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics", maxZoom: 19 },
    );

    const clusterGroup = L.markerClusterGroup({
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        const size = count < 10 ? "small" : count < 50 ? "medium" : "large";
        return L.divIcon({
          html: `<div><span>${count}</span></div>`,
          className: `marker-cluster marker-cluster-${size}`,
          iconSize: L.point(40, 40),
        });
      },
    }).addTo(map);
    clusterGroupRef.current = clusterGroup;
    const facilityGroup = L.layerGroup().addTo(map);
    facilityLayerRef.current = facilityGroup;
    mapRef.current = map;

    const layersControl = L.control
      .layers(
        { "Topographic": openTopoMap, "Streets": streets, "Satellite": satellite },
        { "Findings": clusterGroup, "Facilities": facilityGroup },
        { position: "topright", collapsed: true },
      )
      .addTo(map);
    layersControlRef.current = layersControl;

    const supabase = createClient();
    supabase.rpc("get_state_boundaries").then(({ data }) => {
      if (cancelled || !data || !mapRef.current || !layersControlRef.current) return;
      const fc = {
        type: "FeatureCollection" as const,
        features: data.map((s) => ({ type: "Feature" as const, properties: { name: s.name }, geometry: s.geojson })),
      };
      boundaryLayerRef.current = L.geoJSON(fc, {
        style: { color: "#595d6c", weight: 1, fillOpacity: 0, opacity: 0.6 },
      }).addTo(mapRef.current);
      boundaryLayerRef.current.bringToBack();
      layersControlRef.current.addOverlay(boundaryLayerRef.current, "State boundaries");
    });

    setTimeout(() => map.invalidateSize(), 150);
    return () => {
      cancelled = true;
      map.remove();
      mapRef.current = null;
      clusterGroupRef.current = null;
      boundaryLayerRef.current = null;
      layersControlRef.current = null;
    };
  }, [homeBounds]);

  // load LGA outlines for the selected state filter
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    // A ward drilldown belongs to one LGA in the *previous* state selection — changing (or
    // clearing) the state filter must clear it too, or a stale ward layer could linger. The LGA
    // filter dropdown is scoped to the selected state (see lgaOptions) so it must reset the same way.
    setSelectedLga(null);
    setFilters((f) => (f.lga === ALL ? f : { ...f, lga: ALL }));
    if (lgaLayerRef.current) {
      layersControlRef.current?.removeLayer(lgaLayerRef.current);
      map.removeLayer(lgaLayerRef.current);
      lgaLayerRef.current = null;
    }
    if (filters.state !== ALL) {
      const supabase = createClient();
      supabase.rpc("get_lga_boundaries", { p_state_id: filters.state }).then(({ data }) => {
        if (cancelled || !data || !mapRef.current) return;
        const fc = {
          type: "FeatureCollection" as const,
          features: data.map((l) => ({ type: "Feature" as const, properties: { id: l.id, name: l.name }, geometry: l.geojson })),
        };
        lgaLayerRef.current = L.geoJSON(fc, {
          style: { color: "#796cbf", weight: 1, fillOpacity: 0.03, opacity: 0.8 },
          onEachFeature: (feature, layer) => {
            // Click drills into ward boundaries for this LGA; hover gives the only visual cue
            // that a boundary-only (no-fill) outline is actually clickable.
            layer.on("mouseover", () => (layer as L.Path).setStyle({ weight: 3, opacity: 1 }));
            layer.on("mouseout", () => (layer as L.Path).setStyle({ weight: 1, opacity: 0.8 }));
            layer.on("click", () => setSelectedLga({ id: feature.properties.id, name: feature.properties.name }));
          },
        }).addTo(mapRef.current);
        layersControlRef.current?.addOverlay(lgaLayerRef.current, "LGA boundaries");
        const bounds = lgaLayerRef.current.getBounds();
        if (bounds.isValid()) mapRef.current.fitBounds(bounds, { padding: [24, 24] });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [filters.state]);

  // load ward outlines for the LGA drilled into by clicking an LGA polygon above
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    if (wardLayerRef.current) {
      layersControlRef.current?.removeLayer(wardLayerRef.current);
      map.removeLayer(wardLayerRef.current);
      wardLayerRef.current = null;
    }
    if (selectedLga) {
      setWardsUnavailable(false);
      const supabase = createClient();
      supabase.rpc("get_ward_boundaries", { p_lga_id: selectedLga.id }).then(({ data }) => {
        if (cancelled || !mapRef.current) return;
        if (!data || data.length === 0) {
          setWardsUnavailable(true);
          return;
        }
        const fc = {
          type: "FeatureCollection" as const,
          features: data.map((w) => ({ type: "Feature" as const, properties: { name: w.name }, geometry: w.geojson })),
        };
        wardLayerRef.current = L.geoJSON(fc, { style: { color: "#b45309", weight: 1, fillOpacity: 0.05, opacity: 0.9 } }).addTo(
          mapRef.current,
        );
        layersControlRef.current?.addOverlay(wardLayerRef.current, "Ward boundaries");
        const bounds = wardLayerRef.current.getBounds();
        if (bounds.isValid()) mapRef.current.fitBounds(bounds, { padding: [24, 24] });
      });
    } else {
      setWardsUnavailable(false);
    }
    return () => {
      cancelled = true;
    };
    // Depends on the LGA id, not the selectedLga object reference — a fresh {id,name} literal
    // is constructed on every polygon click (including re-clicking the same LGA), and object
    // identity alone shouldn't trigger a teardown/refetch/re-fit cycle when nothing changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLga?.id]);

  // fit the map to whatever Category/Status/TPM/DRI/LGA narrow the results to — State alone (or no
  // filter) keeps the "zoom to the whole state" behavior from the effect above instead. Doesn't fire
  // for a state-only change (onlyGeographicFilterActive only flips on a category/status/tpm/dri/lga
  // change), so it never fights that effect's own fitBounds call.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || noResults || onlyGeographicFilterActive) return;
    const bounds = L.latLngBounds(filtered.map((i) => [i.lat, i.lng] as [number, number]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
  }, [filtered, noResults, onlyGeographicFilterActive]);

  // markers — clustered colored pins, one per filtered issue
  useEffect(() => {
    const clusterGroup = clusterGroupRef.current;
    if (!clusterGroup) return;
    clusterGroup.clearLayers();
    const markers = filtered.map((i) => {
      const isSelected = selectedId === i.id;
      const color = STATUS_COLOR[i.status as keyof typeof STATUS_COLOR] ?? "#9397ab";
      const size = isSelected ? 22 : 16;
      const icon = L.divIcon({
        className: "",
        html: `<div class="gis-marker-pin${isSelected ? " selected" : ""}" style="background:${color}"></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      return L.marker([i.lat, i.lng], { icon }).on("click", () => setSelectedId(i.id));
    });
    clusterGroup.addLayers(markers);
  }, [filtered, selectedId]);

  const shownFacilities = useMemo(
    () => facilities.filter((f) => filters.lga === ALL || f.lgaId === filters.lga),
    [facilities, filters.lga],
  );

  // facility layer — one marker per store / OTP site, coloured by the chosen measure
  useEffect(() => {
    const group = facilityLayerRef.current;
    if (!group) return;
    group.clearLayers();
    if (facilityMeasure === "off") return;
    for (const f of shownFacilities) {
      const cls = classify(f, facilityMeasure, riskHigh);
      const icon = L.divIcon({ className: "", html: facilityIconHtml(f, cls.color), iconSize: [16, 16], iconAnchor: [8, 8] });
      const mos = f.monthsOfStock === null ? "no outflow" : `${f.monthsOfStock.toFixed(1)} months of stock`;
      L.marker([f.lat, f.lng], { icon, zIndexOffset: 500 })
        .bindTooltip(`${esc(f.name)} — ${cls.label}`)
        .bindPopup(
          `<strong>${esc(f.name)}</strong><br>${LEVEL_NAME[f.type]}<br>` +
            `Risk ${f.risk ?? "—"} · ${mos}<br>On hand ${f.balance.toLocaleString("en-GB")} sachets<br>` +
            `<a href="/stock-ledger?facility=${encodeURIComponent(f.id)}">Open stock ledger</a>`,
        )
        .addTo(group);
    }
  }, [shownFacilities, facilityMeasure, riskHigh]);

  // Situation summary over the map: what needs attention in the current selection.
  const summary = useMemo(() => {
    const open = filtered.filter((i) => isOpen(i.status));
    const lt1 = shownFacilities.filter((f) => f.monthsOfStock !== null && f.monthsOfStock < 1).length;
    const highRisk = shownFacilities.filter((f) => f.risk !== null && f.risk >= riskHigh).length;
    return { open: open.length, critical: open.filter((i) => i.priority === "critical").length, lt1, highRisk };
  }, [filtered, shownFacilities, riskHigh]);
  const statusCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of filtered) m.set(i.status, (m.get(i.status) ?? 0) + 1);
    return m;
  }, [filtered]);

  function resetFilters() {
    // Back to the home view: the pilot state's LGAs when they are already loaded, else the country.
    const lgaBounds = homeState !== ALL && filters.state === homeState ? lgaLayerRef.current?.getBounds() : null;
    setFilters({ state: homeState, lga: ALL, category: ALL, status: ALL, reporter: ALL, dri: ALL });
    setSelectedLga(null);
    setSelectedId(null);
    if (lgaBounds?.isValid()) mapRef.current?.fitBounds(lgaBounds, { padding: [24, 24] });
    else if (homeBounds && filters.state === homeState) mapRef.current?.fitBounds(homeBounds, { padding: [24, 24] });
    else if (homeState === ALL) mapRef.current?.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  }

  return (
    <>
      <div style={{ width: 250, flex: "none", padding: 18, borderRight: "1px solid var(--color-divider)", overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <h5 style={{ margin: 0 }}>Filters</h5>
        <div className="field">
          <label>State</label>
          <select className="input" value={filters.state} onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value }))}>
            <option value={ALL}>All States</option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>LGA</label>
          <select className="input" value={filters.lga} onChange={(e) => setFilters((f) => ({ ...f, lga: e.target.value }))}>
            <option value={ALL}>All LGAs</option>
            {lgaOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Facility level</label>
          <select className="input" value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}>
            <option value={ALL}>All levels</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Status</label>
          <select className="input" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value={ALL}>All statuses</option>
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Raised by</label>
          <select className="input" value={filters.reporter} onChange={(e) => setFilters((f) => ({ ...f, reporter: e.target.value }))}>
            <option value={ALL}>Anyone</option>
            {reporters.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Assigned to (DRI)</label>
          <select className="input" value={filters.dri} onChange={(e) => setFilters((f) => ({ ...f, dri: e.target.value }))}>
            <option value={ALL}>All DRIs</option>
            {driNames.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-secondary btn-block" onClick={resetFilters}>
          <i className="ph ph-arrow-counter-clockwise" />
          Reset filters
        </button>
        {selectedLga && (
          <div
            className="tag tag-outline"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, width: "100%" }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Wards: {selectedLga.name}
              {wardsUnavailable && <span className="text-muted"> (no boundary data)</span>}
            </span>
            <button
              className="btn btn-icon btn-ghost"
              style={{ padding: 0, minWidth: "auto" }}
              onClick={() => setSelectedLga(null)}
              title="Exit ward drilldown"
            >
              <i className="ph ph-x" />
            </button>
          </div>
        )}
        <div className="hr" style={{ margin: "4px 0" }} />
        <div className="field">
          <label>Facility layer</label>
          <select className="input" value={facilityMeasure} onChange={(e) => setFacilityMeasure(e.target.value as FacilityMeasure)}>
            <option value="risk">Risk score</option>
            <option value="mos">Months of stock</option>
            <option value="off">Hidden</option>
          </select>
        </div>
        {facilityMeasure !== "off" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {FACILITY_CLASSES[facilityMeasure].map((c) => {
              const n = shownFacilities.filter((f) => classify(f, facilityMeasure, riskHigh).key === c.key).length;
              return (
                <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: c.color, flex: "none" }} />
                  <span style={{ flex: 1 }}>{c.label}</span>
                  <span className="text-muted">{n}</span>
                </div>
              );
            })}
            <div className="text-muted" style={{ fontSize: 11.5 }}>
              {facilityMeasure === "risk" ? `High from ${riskHigh}; medium from ${Math.round(riskHigh / 2)}. ` : ""}
              Square = store, diamond = OTP site. {facilityMonth}. Click a facility for its ledger.
            </div>
          </div>
        )}
        <div className="hr" style={{ margin: "4px 0" }} />
        <h6 style={{ marginBottom: 6 }}>Findings</h6>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {statuses.map((s) => (
            <button key={s.value} type="button" onClick={() => setFilters((f) => ({ ...f, status: f.status === s.value ? ALL : s.value }))}
              title={filters.status === s.value ? "Show all statuses" : `Show only ${s.label}`}
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, background: filters.status === s.value ? "var(--color-accent-100)" : "none", border: "none", borderRadius: 4, padding: "1px 4px", margin: "0 -4px", cursor: "pointer", color: "inherit", textAlign: "left" }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.color, flex: "none" }} />
              <span style={{ flex: 1 }}>{s.label}</span>
              <span className="text-muted">{(statusCount.get(s.value) ?? 0).toLocaleString("en-GB")}</span>
            </button>
          ))}
        </div>
        <div className="hr" style={{ margin: "4px 0" }} />
        <div style={{ fontSize: 12 }} className="text-muted">
          {filtered.length} of {issues.length} Findings shown{facilityMeasure !== "off" ? ` · ${shownFacilities.length} facilities` : ""}
        </div>
      </div>

      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <div ref={mapNodeRef} style={{ position: "absolute", inset: 0 }} />

        <div className="card elev-lg" style={{ position: "absolute", left: 12, bottom: 24, zIndex: 500, padding: "10px 14px", gap: 6, maxWidth: "calc(100% - 24px)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-neutral-700)" }}>
            Situation · {filters.state === ALL ? "All states" : states.find((s) => s.id === filters.state)?.name}
            {filters.lga !== ALL ? ` · ${lgas.find((l) => l.id === filters.lga)?.name ?? ""}` : ""}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: 12.5 }}>
            <SummaryStat icon="ph-flag" value={summary.open} label="open Findings" />
            <SummaryStat icon="ph-warning-octagon" value={summary.critical} label="critical" alert="var(--priority-critical)" />
            {facilityMeasure !== "off" && <SummaryStat icon="ph-gauge" value={summary.highRisk} label="high-risk facilities" alert="var(--priority-critical)" />}
            {facilityMeasure !== "off" && <SummaryStat icon="ph-package" value={summary.lt1} label="under 1 month of stock" alert="var(--priority-high)" />}
          </div>
        </div>

        {noResults && (
          <div
            className="card elev-lg text-muted"
            style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", padding: "10px 16px", fontSize: 13, zIndex: 500 }}
          >
            No matching records found.
          </div>
        )}

        {selected && (
          <div className="card elev-lg" style={{ position: "absolute", top: 64, right: 12, width: 300, padding: 14, gap: 10, zIndex: 500 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="tag tag-outline">{selected.code}</span>
              <button className="btn btn-icon btn-ghost" onClick={() => setSelectedId(null)}>
                <i className="ph ph-x" />
              </button>
            </div>
            <div className="card-title" style={{ fontSize: 15 }}>
              {selected.category}
            </div>
            <div className="card-body" style={{ fontSize: 12.5 }}>
              {selected.description}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span className="tag" style={{ background: tagBg(STATUS_COLOR[selected.status as keyof typeof STATUS_COLOR]), color: STATUS_COLOR[selected.status as keyof typeof STATUS_COLOR] }}>
                {STATUS_LABEL[selected.status as keyof typeof STATUS_LABEL]}
              </span>
              <span className="tag" style={{ background: tagBg(PRIORITY_COLOR[selected.priority as keyof typeof PRIORITY_COLOR]), color: PRIORITY_COLOR[selected.priority as keyof typeof PRIORITY_COLOR] }}>
                {PRIORITY_LABEL[selected.priority as keyof typeof PRIORITY_LABEL]}
              </span>
            </div>
            <div className="text-muted" style={{ fontSize: 11.5 }}>
              {selected.stateName} · {selected.lgaName} · {selected.ward}
            </div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              GPS {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)} · {new Date(selected.reportedAt).toLocaleString()}
            </div>
            <Link href={`/issues/${selected.id}`} className="btn btn-primary btn-block">
              Open Finding
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

/** One figure in the map's situation summary; an alert colour only with its icon, and only when non-zero. */
function SummaryStat({ icon, value, label, alert }: { icon: string; value: number; label: string; alert?: string }) {
  const color = alert && value > 0 ? alert : "var(--color-neutral-700)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
      <i className={`ph-fill ${icon}`} aria-hidden="true" style={{ color, fontSize: 15 }} />
      <strong style={{ fontSize: 14 }}>{value.toLocaleString("en-GB")}</strong> {label}
    </span>
  );
}
