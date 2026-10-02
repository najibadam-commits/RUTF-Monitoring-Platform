"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";

export interface MapPoint {
  lat: number;
  lng: number;
  color: string;
}

// Non-interactive preview map (mirrors the design prototype's tryInitDashMap:
// zoom/drag/scroll all disabled — this is a glanceable thumbnail, the full
// interactive map lives at /gis).
export function DashboardMapInner({ points }: { points: MapPoint[] }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!nodeRef.current || mapRef.current) return;
    const map = L.map(nodeRef.current, {
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      attributionControl: false,
    }).setView([9.08, 8.68], 5.6);
    L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { subdomains: "abc", maxZoom: 17 }).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 150);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!markersRef.current) return;
    markersRef.current.clearLayers();
    points.forEach((p) => {
      L.circleMarker([p.lat, p.lng], { radius: 4, color: "#161826", weight: 1, fillColor: p.color, fillOpacity: 0.9 }).addTo(
        markersRef.current!,
      );
    });
  }, [points]);

  return <div ref={nodeRef} style={{ position: "absolute", inset: 0 }} />;
}
