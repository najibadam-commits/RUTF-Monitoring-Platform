-- TPM Monitoring Platform — schema migration 19
-- Administrative hierarchy for the Android field app's cascading dropdowns:
-- State -> LGA -> Ward -> {Settlement, Activity Site} as two INDEPENDENT
-- siblings under Ward (not a Settlement -> Activity Site chain — deliberate
-- choice, see DECISIONS.md #8). Both settlements and activity_sites gain a
-- real `ward_id` FK; `statename`/`lganame` stay as denormalized display
-- columns (matching the `ward` text column pattern already used on
-- `issues`) but are now derived server-side from ward_id, never trusted
-- from the client — this makes an inconsistent State/LGA/Ward/Settlement
-- combination structurally impossible rather than merely validated (README
-- requirement 6: "Do not silently accept inconsistent records").
--
-- Both tables are empty in production (confirmed before writing this), so
-- ward_id can go straight to NOT NULL with no backfill.

alter table settlements add column ward_id uuid references wards(id);
alter table settlements alter column ward_id set not null;
create index settlements_ward_id_idx on settlements(ward_id);

alter table activity_sites add column ward_id uuid references wards(id);
alter table activity_sites alter column ward_id set not null;
create index activity_sites_ward_id_idx on activity_sites(ward_id);

-- Replace the old (statename, lganame, name) uniqueness with (ward_id, name)
-- — the precise scope now that ward_id is the authoritative link.
drop index if exists settlements_unique_name;
create unique index settlements_unique_name on settlements (ward_id, settlementname) where status <> 'rejected';

drop index if exists activity_sites_unique_name;
create unique index activity_sites_unique_name on activity_sites (ward_id, activitysitename) where status <> 'rejected';

-- ── derive statename/lganame from ward_id, ignoring whatever the client sent ──
create or replace function derive_dataset_location_names()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_state text;
  v_lga text;
begin
  if NEW.ward_id is null then
    raise exception 'ward_id is required';
  end if;

  select s.name, l.name into v_state, v_lga
  from wards w join lgas l on l.id = w.lga_id join states s on s.id = l.state_id
  where w.id = NEW.ward_id;

  if v_state is null then
    raise exception 'Invalid ward_id — no matching ward/LGA/state found';
  end if;

  NEW.statename := v_state;
  NEW.lganame := v_lga;
  return NEW;
end;
$$;

-- Named to sort alphabetically before each table's existing
-- "*_enforce_workflow" trigger (BEFORE triggers on the same table/event fire
-- in trigger-name order) — derivation must happen first so the workflow
-- trigger's pending_data snapshot captures the already-correct names.
create trigger settlements_derive_location_names before insert or update on settlements
  for each row execute function derive_dataset_location_names();
create trigger activity_sites_derive_location_names before insert or update on activity_sites
  for each row execute function derive_dataset_location_names();

-- ── issues: store stable IDs for settlement/activity site, not just text ──
-- (state_id/lga_id/ward_id already existed; settlement/activity_site were
-- text-only from migration 0016 — README requirement 11.)
alter table issues add column settlement_id uuid references settlements(id);
alter table issues add column activity_site_id uuid references activity_sites(id);
