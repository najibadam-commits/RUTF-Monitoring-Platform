-- TPM Monitoring Platform — schema migration 29
-- Supports the Data Sets screen's move to real server-side pagination/search
-- (see DECISIONS.md #18, closing the loop opened in #17). settlements has
-- 354,148 rows and activity_sites has 32,201 — the screen used to
-- unconditionally select("*") both, which PostgREST silently capped at its
-- configured max-rows (observed 1000 here), so the admin never saw the real
-- data. That's now replaced with .range() pagination plus a search/filter UI
-- (name/state/LGA substring search, status filter), which needs real index
-- support at this scale rather than a sequential scan per request.
--
-- NOTE: these are plain (non-concurrent) CREATE INDEX statements, matching
-- every other migration in this repo — building the trigram indexes below
-- will briefly hold a lock against writes on these two tables. Run this in a
-- low-traffic window.

create extension if not exists pg_trgm;

-- Equality filters (State / LGA dropdowns in the new filter bar).
create index settlements_statename_lganame_idx on settlements (statename, lganame);
create index activity_sites_statename_lganame_idx on activity_sites (statename, lganame);

-- Substring search (the "Search…" box, `ilike '%term%'` across name/state/LGA)
-- — a leading wildcard can't use a btree index, so these are trigram GIN
-- indexes instead. One per column so Postgres can bitmap-OR across them for
-- the .or(name.ilike...,statename.ilike...,lganame.ilike...) query.
create index settlements_settlementname_trgm_idx on settlements using gin (settlementname gin_trgm_ops);
create index settlements_statename_trgm_idx on settlements using gin (statename gin_trgm_ops);
create index settlements_lganame_trgm_idx on settlements using gin (lganame gin_trgm_ops);

create index activity_sites_activitysitename_trgm_idx on activity_sites using gin (activitysitename gin_trgm_ops);
create index activity_sites_statename_trgm_idx on activity_sites using gin (statename gin_trgm_ops);
create index activity_sites_lganame_trgm_idx on activity_sites using gin (lganame gin_trgm_ops);
