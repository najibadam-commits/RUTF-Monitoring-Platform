-- TPM Monitoring Platform — schema migration 2/11
-- Lookup/reference data: states, LGAs, wards, categories. Read by everyone
-- authenticated; written by Super Admin only (see 0008 RLS migration).
--
-- Real Nigeria administrative boundaries (37 states, 774 LGAs, 9,411 wards)
-- sourced from the user-supplied SpatiaLite layers (state.sqlite, LGA.sqlite,
-- Ward.sqlite) replace the design prototype's approximate x/y grid — see
-- tools/gis-import. Each level stores a full-precision `geom` (accurate
-- point-in-polygon lookups) and a `geom_simplified` (fast map rendering).

create extension if not exists postgis;

create table states (
  id uuid primary key default gen_random_uuid(),
  code text unique,            -- source statecode, e.g. 'LA', 'KN'
  name text not null unique,   -- statename
  geozone text,                -- source geopolitical zone, e.g. 'SWZ'
  capital text,
  geom geometry(MultiPolygon, 4326),
  geom_simplified geometry(MultiPolygon, 4326),
  created_at timestamptz not null default now()
);
create index states_geom_gix on states using gist (geom);
create index states_geom_simplified_gix on states using gist (geom_simplified);

create table lgas (
  id uuid primary key default gen_random_uuid(),
  state_id uuid not null references states(id) on delete cascade,
  code text unique,            -- source lgacode
  name text not null,          -- lganame
  geom geometry(MultiPolygon, 4326),
  geom_simplified geometry(MultiPolygon, 4326),
  created_at timestamptz not null default now(),
  unique (state_id, name)
);
create index lgas_state_id_idx on lgas(state_id);
create index lgas_geom_gix on lgas using gist (geom);
create index lgas_geom_simplified_gix on lgas using gist (geom_simplified);

create table wards (
  id uuid primary key default gen_random_uuid(),
  lga_id uuid not null references lgas(id) on delete cascade,
  code text unique,            -- source wardcode
  name text not null,          -- wardname
  urban boolean,
  geom geometry(MultiPolygon, 4326),
  geom_simplified geometry(MultiPolygon, 4326),
  created_at timestamptz not null default now(),
  unique (lga_id, name)
);
create index wards_lga_id_idx on wards(lga_id);
create index wards_geom_gix on wards using gist (geom);
create index wards_geom_simplified_gix on wards using gist (geom_simplified);

create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0
);
