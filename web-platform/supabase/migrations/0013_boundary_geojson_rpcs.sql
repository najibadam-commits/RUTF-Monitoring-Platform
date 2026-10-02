-- TPM Monitoring Platform — schema migration 13
-- PostgREST/Supabase returns raw `geometry` columns as hex-encoded WKB, not
-- GeoJSON, when selected directly. These RPCs return ready-to-render GeoJSON
-- instead, using the pre-computed `geom_simplified` column so the GIS map's
-- boundary layers stay light. LGA/ward boundaries are loaded lazily (by
-- parent id) rather than all at once — 774 LGAs and 9.4k wards of geometry
-- is too much to ship on every map load.

create or replace function get_state_boundaries()
returns table (id uuid, name text, code text, geojson json)
language sql stable as $$
  select id, name, code, ST_AsGeoJSON(geom_simplified)::json
  from states
  where geom_simplified is not null;
$$;

create or replace function get_lga_boundaries(p_state_id uuid default null)
returns table (id uuid, state_id uuid, name text, code text, geojson json)
language sql stable as $$
  select id, state_id, name, code, ST_AsGeoJSON(geom_simplified)::json
  from lgas
  where geom_simplified is not null
    and (p_state_id is null or state_id = p_state_id);
$$;

create or replace function get_ward_boundaries(p_lga_id uuid)
returns table (id uuid, lga_id uuid, name text, code text, geojson json)
language sql stable as $$
  select id, lga_id, name, code, ST_AsGeoJSON(geom_simplified)::json
  from wards
  where lga_id = p_lga_id and geom_simplified is not null;
$$;

comment on function get_state_boundaries() is
  'Returns all 37 state boundaries as GeoJSON (simplified geometry) for the GIS map base layer.';
comment on function get_lga_boundaries(uuid) is
  'Returns LGA boundaries as GeoJSON, optionally filtered to one state — call when a state is selected/zoomed into.';
comment on function get_ward_boundaries(uuid) is
  'Returns ward boundaries as GeoJSON for one LGA — call on further zoom/selection, never for the whole country at once.';
