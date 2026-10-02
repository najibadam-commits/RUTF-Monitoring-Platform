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
  tpmName: string;
  driName: string | null;
}

interface Props {
  issues: GisIssue[];
  states: { id: string; name: string }[];
  lgas: { id: string; stateId: string; name: string }[];
  categories: string[];
  statuses: { value: string; label: string; color: string }[];
  tpmNames: string[];
  driNames: string[];
}

const ALL = "All";
const DEFAULT_CENTER: [number, number] = [9.08, 8.68];
const DEFAULT_ZOOM = 6;

export function GisMapInner({ issues, states, lgas, categories, statuses, tpmNames, driNames }: Props) {
  const [filters, setFilters] = useState({ state: ALL, lga: ALL, category: ALL, status: ALL, tpm: ALL, dri: ALL });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLga, setSelectedLga] = useState<{ id: string; name: string } | null>(null);
  const [wardsUnavailable, setWardsUnavailable] = useState(false);

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
          (filters.tpm === ALL || i.tpmName === filters.tpm) &&
          (filters.dri === ALL || i.driName === filters.dri),
      ),
    [issues, filters],
  );

  // Only State (or no filter at all) is active — the existing state-boundary effect below already
  // zooms to the whole state's (or the whole country's) extent, which reads better than fitting
  // tightly to wherever the state's issues happen to cluster. Every other filter (alone or combined
  // with State) fits to the actual matching markers instead — see the effect further down.
  const onlyGeographicFilterActive = filters.lga === ALL && filters.category === ALL && filters.status === ALL && filters.tpm === ALL && filters.dri === ALL;

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
    mapRef.current = map;

    const layersControl = L.control
      .layers(
        { "Topographic": openTopoMap, "Streets": streets, "Satellite": satellite },
        { "Issue Markers": clusterGroup },
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
      layersControlRef.current.addOverlay(boundaryLayerRef.current, "State Boundaries");
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
  }, []);

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
        layersControlRef.current?.addOverlay(lgaLayerRef.current, "LGA Boundaries");
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
        layersControlRef.current?.addOverlay(wardLayerRef.current, "Ward Boundaries");
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

  function resetFilters() {
    setFilters({ state: ALL, lga: ALL, category: ALL, status: ALL, tpm: ALL, dri: ALL });
    setSelectedLga(null);
    setSelectedId(null);
    mapRef.current?.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
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
          <label>Sector</label>
          <select className="input" value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}>
            <option value={ALL}>All Sectors</option>
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
            <option value={ALL}>All Status</option>
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>TPM / Monitor</label>
          <select className="input" value={filters.tpm} onChange={(e) => setFilters((f) => ({ ...f, tpm: e.target.value }))}>
            <option value={ALL}>All Monitors</option>
            {tpmNames.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Direct Responsible Individual (DRI)</label>
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
          Reset Filters
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
        <h6 style={{ marginBottom: 6 }}>Legend</h6>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {statuses.map((s) => (
            <div key={s.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.color, flex: "none" }} />
              {s.label}
            </div>
          ))}
        </div>
        <div className="hr" style={{ margin: "4px 0" }} />
        <div style={{ fontSize: 12 }} className="text-muted">
          {filtered.length} of {issues.length} issues shown
        </div>
      </div>

      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <div ref={mapNodeRef} style={{ position: "absolute", inset: 0 }} />

        {noResults && (
          <div
            className="card elev-lg text-muted"
            style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", padding: "10px 16px", fontSize: 13, zIndex: 500 }}
          >
            No matching records found.
          </div>
        )}

        {selected && (
          <div className="card elev-lg" style={{ position: "absolute", top: 16, right: 16, width: 300, padding: 14, gap: 10 }}>
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
              View Full Details
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
