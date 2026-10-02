-- TPM Monitoring Platform — schema migration 12/12
-- Point-in-polygon lookup: given a GPS coordinate, resolve the containing
-- state/LGA/ward via the real boundary geometry. This is the "seamless
-- interaction" between the boundary layers and issue reporting — a TPM
-- dropping a pin or capturing GPS gets state/LGA/ward auto-filled instead
-- of picking three dropdowns by hand (the dropdowns remain as a manual
-- override/fallback for GPS-denied environments).

create or replace function resolve_administrative_location(p_lat numeric, p_lng numeric)
returns table (state_id uuid, state_name text, lga_id uuid, lga_name text, ward_id uuid, ward_name text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, l.id, l.name, w.id, w.name
  from states s
  join lgas l on l.state_id = s.id
  left join wards w on w.lga_id = l.id
    and st_contains(w.geom, st_setsrid(st_makepoint(p_lng, p_lat), 4326))
  where st_contains(s.geom, st_setsrid(st_makepoint(p_lng, p_lat), 4326))
    and st_contains(l.geom, st_setsrid(st_makepoint(p_lng, p_lat), 4326))
  limit 1;
$$;

comment on function resolve_administrative_location(numeric, numeric) is
  'Given (lat, lng), returns the containing state/LGA/ward by real boundary '
  'geometry. Called from the issue-report form to auto-fill location fields; '
  'a null result (point outside all known boundaries, or off Nigeria) falls '
  'back to manual dropdown selection.';
