-- TPM Monitoring Platform — reference/lookup seed data.
--
-- states/lgas/wards are NOT seeded here — they're loaded from real Nigeria
-- administrative boundary data (37 states / 774 LGAs / 9,411 wards) via
-- tools/gis-import/import.js, which reads the user-supplied SpatiaLite
-- layers and bulk-inserts geometry rows directly over a DB connection
-- (too much data — ~10k polygon rows — to run through this file/SQL Editor).
-- Run that script once after this migration, before anything that expects
-- states/lgas/wards to be populated (issue creation, the GIS map, etc.).

insert into categories (name, sort_order) values
  ('Water & Sanitation Failure', 0),
  ('Supply Chain / Stockout', 1),
  ('Infrastructure Damage', 2),
  ('Safety Incident', 3),
  ('Service Quality Complaint', 4),
  ('Data Discrepancy', 5),
  ('Staff Absenteeism', 6),
  ('Equipment Malfunction', 7),
  ('Environmental Hazard', 8),
  ('Community Grievance', 9)
on conflict (name) do nothing;
