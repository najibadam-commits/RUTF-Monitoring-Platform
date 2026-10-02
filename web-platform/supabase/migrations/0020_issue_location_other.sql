-- Free-text fallback for the mobile app's merged Settlement/Activity Site picker.
--
-- The Android "Register New Issue" wizard now shows Settlements and Activity Sites for the
-- selected Ward together in a single picker (instead of two separate required dropdowns), plus
-- an "Other — not listed" option for field staff to type a name manually when the real place
-- isn't in the preloaded reference list yet.
--
-- Settlements and Activity Sites stay distinct tables/FKs (issues.settlement_id /
-- issues.activity_site_id, see migration 0019 and DECISIONS.md #8) — this column only covers the
-- unclassified manual-entry case, where neither FK can be set because there's no matching row to
-- point at. settlement_id/activity_site_id remain null when location_other is used; an admin can
-- later read this text on the issue and, if it should exist going forward, add it as a real
-- Settlement or Activity Site via the Data Sets approval workflow already built on the web app.
alter table issues add column location_other text;

comment on column issues.location_other is
  'Free-text location name captured on the mobile app when the field-reported Settlement/Activity Site was not found in the preloaded reference list. Null whenever settlement_id or activity_site_id is set.';
