-- Add "Warehouse" to the Sector list (Item 4 follow-up — user-requested addition after the
-- original 7-sector rollout in migration 0032). Sectors are pure reference data — both the web
-- and Android apps fetch the category/sector list live from this table (getCategories()/
-- getAllCategories() on web, ReferenceRepository on mobile), nothing is hardcoded in either
-- client — so this insert alone is enough to make it appear everywhere: new-submission pickers,
-- filter dropdowns, GIS "Sector" filter, CSV export, DRI "Assigned Sector" field.
--
-- sort_order = 7 continues the existing sequence (Fraud is 6); abbr = 'WAR' passes the existing
-- categories_abbr_format check ('^[A-Z]{3}$') and categories_abbr_unique constraint.

insert into categories (name, sort_order, abbr, is_active) values
  ('Warehouse', 7, 'WAR', true);
