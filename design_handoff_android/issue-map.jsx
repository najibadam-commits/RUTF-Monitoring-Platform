function loadLeaflet() {
  return new Promise((resolve) => {
    if (window.L) { resolve(window.L); return; }
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.integrity = 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H';
      link.crossOrigin = 'anonymous';
      link.setAttribute('data-leaflet', '1');
      document.head.appendChild(link);
    }
    const existing = document.querySelector('script[data-leaflet]');
    if (existing) { existing.addEventListener('load', () => resolve(window.L)); return; }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.integrity = 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH';
    script.crossOrigin = 'anonymous';
    script.setAttribute('data-leaflet', '1');
    script.onload = () => resolve(window.L);
    document.head.appendChild(script);
  });
}

function severityColor(sev) {
  if (sev === 'High') return '#2c455d';
  if (sev === 'Medium') return '#5980a6';
  return '#98989b';
}

function IssueMap(props) {
  const ref = React.useRef(null);
  const mapRef = React.useRef(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => { loadLeaflet().then(() => setReady(true)); }, []);

  React.useEffect(() => {
    if (!ready || !ref.current) return;
    if (!mapRef.current) {
      mapRef.current = window.L.map(ref.current, { zoomControl: true }).setView([9.082, 8.6753], 6);
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(mapRef.current);
    }
    const map = mapRef.current;
    if (map._issueMarkers) map._issueMarkers.forEach((m) => map.removeLayer(m));
    const issues = props.issues || [];
    map._issueMarkers = issues.map((issue) => {
      const color = severityColor(issue.severity);
      const marker = window.L.circleMarker([issue.lat, issue.lng], {
        radius: issue.overdue ? 10 : 8,
        color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: issue.overdue ? 3 : 1.5,
      }).addTo(map);
      marker.bindTooltip(issue.id + ' · ' + issue.status + (issue.severity ? ' · ' + issue.severity : ''), { direction: 'top' });
      marker.on('click', () => { if (props.onSelect) props.onSelect(issue.id); });
      return marker;
    });
    if (issues.length) {
      const bounds = window.L.latLngBounds(issues.map((i) => [i.lat, i.lng]));
      map.fitBounds(bounds.pad(0.3));
    }
    setTimeout(() => map.invalidateSize(), 50);
  }, [ready, props.issues]);

  return React.createElement('div', { ref, style: { width: '100%', height: '100%', minHeight: 280, background: '#e7e7ea' } });
}

window.IssueMap = IssueMap;
