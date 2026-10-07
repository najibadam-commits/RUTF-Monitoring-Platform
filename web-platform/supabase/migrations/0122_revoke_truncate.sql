-- RUTF Monitoring Platform — migration 0122 (defence in depth, docs/PERMISSIONS_REVIEW.md P8)
-- Supabase's default grants give the API roles TRUNCATE, TRIGGER and REFERENCES on every table in
-- public. TRUNCATE bypasses row-level security, so a role holding it could empty audit_log or the
-- ledger outright. PostgREST cannot issue TRUNCATE, so it is not reachable through the API today,
-- but the API roles have no use for these privileges: take them away now and for future tables.
-- SELECT / INSERT / UPDATE / DELETE stay as they are — the RLS policies rely on them.
-- PostGIS's spatial_ref_sys, geometry_columns and geography_columns are owned by supabase_admin,
-- so postgres cannot revoke on them (Postgres reports a notice and skips them); spatial_ref_sys is
-- a public catalogue of coordinate systems, the other two are views. The default-privileges
-- change covers tables created by postgres, which is the role every migration runs as.

revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;
