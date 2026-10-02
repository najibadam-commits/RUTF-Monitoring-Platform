-- RUTF seed: supply-chain levels shown as "Sector" (brief §4).
-- TPM sectors from 0032/0039 are deactivated, never deleted (Finding IDs may reference them).

update categories set is_active = false where abbr not in ('SST', 'LST', 'OTP');

insert into categories (name, sort_order, abbr, is_active) values
  ('State Store', 0, 'SST', true),
  ('LGA Store', 1, 'LST', true),
  ('OTP Site', 2, 'OTP', true)
on conflict (abbr) do update set name = excluded.name, sort_order = excluded.sort_order, is_active = true;
