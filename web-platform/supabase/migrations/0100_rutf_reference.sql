-- RUTF Monitoring Platform — migration 0100 (brief §5, milestone M1)
-- Reference data: the facility registry (State store → LGA stores → health facilities / OTPs),
-- products and lots, dosing rules and thresholds, and the facility a `dri` user records for.
--
-- Facilities reuse the 0015 Data Sets approval workflow (enforce_dataset_workflow): Super Admin
-- writes go live, Project Admin writes become pending proposals. Products, protocol rules and
-- thresholds are programme sign-off values (brief §12.2–12.4), so only Super Admin edits them.

-- ── Pilot project ──────────────────────────────────────────────────────────────────────────────
-- Thresholds are keyed by project (brief §5), so the pilot project has to exist first.
insert into projects (name) values ('Katsina RUTF Pilot') on conflict (name) do nothing;

-- ── Facilities ─────────────────────────────────────────────────────────────────────────────────
create type facility_type as enum ('state_store', 'lga_store', 'health_facility');

create table facilities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  facility_type facility_type not null,
  name text not null,
  national_code text,                       -- registry globalid until a national code exists
  state_id uuid not null references states(id),
  lga_id uuid not null references lgas(id),
  ward_id uuid references wards(id),
  ward_name_source text,                    -- ward as written in the source list
  lat numeric(9,6),
  lng numeric(9,6),
  geocode_accuracy_m numeric,
  geocode_source text check (geocode_source in ('field_gps', 'registry', 'manual')),
  location_flag text,                       -- set by derive_facility_location(); never blocks
  is_otp_site boolean not null default false,
  supplied_by_facility_id uuid references facilities(id),  -- OTP -> LGA store -> State store
  is_hard_to_reach boolean not null default false,         -- uses variance_pct_max_remote
  is_active boolean not null default true,
  functional_status text,                   -- registry value: Functional / Unknown / blank
  registry_category text,                   -- registry value: Dispensary, Maternity Home, ...
  dummy_fields text,                        -- which fields are generated dummy data (DECISIONS R2)
  -- 0015 approval workflow columns
  status dataset_status not null default 'approved',
  pending_data jsonb,
  submitted_by uuid references profiles(id),
  reviewed_by uuid references profiles(id),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index facilities_project_id_idx on facilities(project_id);
create index facilities_lga_id_idx on facilities(lga_id);
create index facilities_ward_id_idx on facilities(ward_id);
create index facilities_supplier_idx on facilities(supplied_by_facility_id);
create index facilities_status_idx on facilities(status);
create index facilities_name_trgm_idx on facilities using gin (name gin_trgm_ops);
create unique index facilities_national_code_unique on facilities(national_code)
  where national_code is not null and status <> 'rejected';

comment on column facilities.location_flag is
  'outside_boundaries: point outside every known LGA; outside_declared_lga: point falls in a '
  'different LGA than lga_id; outside_declared_ward: point falls in a different ward than ward_id. '
  'Flags are for review — the declared location is kept.';

create trigger facilities_set_updated_at before update on facilities
  for each row execute function set_updated_at();

-- Resolves state from LGA, fills a missing ward from coordinates, flags (never blocks) a point
-- that sits outside its declared LGA/ward, and keeps the supply chain one level at a time.
-- Named to sort before facilities_enforce_workflow (BEFORE triggers fire in name order), so a
-- Project Admin's pending_data snapshot already holds the derived values — same as 0019.
create or replace function derive_facility_location()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_supplier_type facility_type;
begin
  NEW.location_flag := null;

  if NEW.lat is not null and NEW.lng is not null then
    select * into r from resolve_administrative_location(NEW.lat, NEW.lng);
    if r.lga_id is null then
      NEW.location_flag := 'outside_boundaries';
    elsif NEW.lga_id is null then
      NEW.lga_id := r.lga_id;
      NEW.ward_id := coalesce(NEW.ward_id, r.ward_id);
    elsif NEW.lga_id = r.lga_id then
      NEW.ward_id := coalesce(NEW.ward_id, r.ward_id);
      if r.ward_id is not null and NEW.ward_id is distinct from r.ward_id then
        NEW.location_flag := 'outside_declared_ward';
      end if;
    else
      NEW.location_flag := 'outside_declared_lga';
    end if;
  end if;

  if NEW.lga_id is null then
    raise exception 'lga_id is required (or coordinates inside a known LGA)';
  end if;
  select state_id into NEW.state_id from lgas where id = NEW.lga_id;
  if NEW.ward_id is not null and not exists (select 1 from wards where id = NEW.ward_id and lga_id = NEW.lga_id) then
    raise exception 'ward_id does not belong to the facility''s LGA';
  end if;

  if NEW.supplied_by_facility_id is not null then
    select facility_type into v_supplier_type from facilities where id = NEW.supplied_by_facility_id;
    if (NEW.facility_type = 'state_store')
       or (NEW.facility_type = 'lga_store' and v_supplier_type is distinct from 'state_store')
       or (NEW.facility_type = 'health_facility' and v_supplier_type is distinct from 'lga_store') then
      raise exception 'Supply chain is State store -> LGA store -> health facility: a % cannot be supplied by a %',
        NEW.facility_type, coalesce(v_supplier_type::text, 'missing facility');
    end if;
  end if;

  return NEW;
end;
$$;

create trigger facilities_derive_location before insert or update on facilities
  for each row execute function derive_facility_location();
create trigger facilities_enforce_workflow before insert or update or delete on facilities
  for each row execute function enforce_dataset_workflow();

-- Approve / reject a pending facility change (Super Admin only) — same semantics as 0015's
-- approve_activity_site / reject_activity_site, applied to every business column at once.
create or replace function approve_facility(p_id uuid, p_note text default null)
returns facilities language plpgsql as $$
declare
  v_row facilities;
  v_new facilities;
begin
  if not is_super_admin() then raise exception 'Only Super Admin may approve data set entries'; end if;
  select * into v_row from facilities where id = p_id;
  if not found then raise exception 'Entry not found'; end if;

  if v_row.status = 'pending_delete' then
    delete from facilities where id = p_id;
  elsif v_row.status = 'pending_update' then
    v_new := jsonb_populate_record(v_row, coalesce(v_row.pending_data, '{}'::jsonb));
    update facilities set
      facility_type = v_new.facility_type, name = v_new.name, national_code = v_new.national_code,
      lga_id = v_new.lga_id, ward_id = v_new.ward_id, ward_name_source = v_new.ward_name_source,
      lat = v_new.lat, lng = v_new.lng, geocode_accuracy_m = v_new.geocode_accuracy_m,
      geocode_source = v_new.geocode_source, is_otp_site = v_new.is_otp_site,
      supplied_by_facility_id = v_new.supplied_by_facility_id, is_hard_to_reach = v_new.is_hard_to_reach,
      is_active = v_new.is_active, functional_status = v_new.functional_status,
      registry_category = v_new.registry_category,
      status = 'approved', pending_data = null, reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  elsif v_row.status = 'pending_create' then
    update facilities set status = 'approved', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  else
    raise exception 'This entry has no pending change to approve';
  end if;
  return v_row;
end;
$$;

create or replace function reject_facility(p_id uuid, p_note text)
returns facilities language plpgsql as $$
declare v_row facilities;
begin
  if not is_super_admin() then raise exception 'Only Super Admin may reject data set entries'; end if;
  select * into v_row from facilities where id = p_id;
  if not found then raise exception 'Entry not found'; end if;

  if v_row.status in ('pending_delete', 'pending_update') then
    update facilities set status = 'approved', pending_data = null, reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  elsif v_row.status = 'pending_create' then
    update facilities set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  else
    raise exception 'This entry has no pending change to reject';
  end if;
  return v_row;
end;
$$;

-- ── Facility users ─────────────────────────────────────────────────────────────────────────────
alter table profiles add column if not exists facility_id uuid references facilities(id) on delete set null;
create index if not exists profiles_facility_id_idx on profiles(facility_id);
comment on column profiles.facility_id is
  'The one facility a `dri` (facility user) records for — brief §4. Its level (SST/LST/OTP) is '
  'copied into assigned_category_id by profiles_set_facility_level, so Finding scoping follows.';

create or replace function current_facility_id()
returns uuid language sql stable security definer set search_path = public as $$
  select facility_id from profiles where id = auth.uid();
$$;

-- The facility that supplies the caller's facility (receipts come from it).
create or replace function current_facility_supplier_id()
returns uuid language sql stable security definer set search_path = public as $$
  select f.supplied_by_facility_id from facilities f where f.id = current_facility_id();
$$;

-- Level follows facility: State store -> SST, LGA store -> LST, health facility -> OTP.
create or replace function set_profile_facility_level()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.facility_id is not null and (TG_OP = 'INSERT' or NEW.facility_id is distinct from OLD.facility_id) then
    select c.id into NEW.assigned_category_id
    from facilities f
    join categories c on c.abbr = case f.facility_type
      when 'state_store' then 'SST' when 'lga_store' then 'LST' else 'OTP' end
    where f.id = NEW.facility_id;
  end if;
  return NEW;
end;
$$;

-- "zz" so it runs after profiles_enforce_update_rules has pinned a self-edited facility_id back.
create trigger profiles_zz_set_facility_level before insert or update on profiles
  for each row execute function set_profile_facility_level();

-- Same pin-back as 0038, now also covering facility_id; a Project Admin may only assign a
-- facility in their own project.
create or replace function enforce_profile_update_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  acting_role user_role;
begin
  if auth.uid() is null then
    return new; -- service-role / direct DB connection: trusted, no client-side guard needed
  end if;

  acting_role := current_user_role();

  if acting_role = 'super_admin' then
    return new;
  end if;

  if acting_role = 'project_admin' then
    if old.project_id is distinct from current_project_id() then
      raise exception 'Not authorized to modify profiles outside your project';
    end if;
    if new.role in ('super_admin', 'project_admin') and new.role is distinct from old.role then
      raise exception 'Project Admin cannot assign the % role', new.role;
    end if;
    if new.facility_id is distinct from old.facility_id and new.facility_id is not null
       and not exists (select 1 from facilities where id = new.facility_id and status = 'approved'
                       and project_id is not distinct from current_project_id()) then
      raise exception 'Facility must be an approved facility in your project';
    end if;
    return new;
  end if;

  if old.id is distinct from auth.uid() then
    raise exception 'Not authorized to modify other profiles';
  end if;
  new.role := old.role;
  new.project_id := old.project_id;
  new.status := old.status;
  new.managed_state_id := old.managed_state_id;
  new.assigned_category_id := old.assigned_category_id;
  new.facility_id := old.facility_id;
  return new;
end;
$$;

-- ── Facility RLS ───────────────────────────────────────────────────────────────────────────────
-- A facility user sees only their own facility, its supplier, and the facilities it supplies
-- (what they receive from / issue to) — this is also all the Android app syncs for them.
-- Other roles see approved facilities in their project. Pending/rejected rows: submitter and
-- approvers only, as in 0015.
alter table facilities enable row level security;

create policy facilities_select on facilities for select to authenticated
  using (
    is_super_admin()
    or submitted_by = auth.uid()
    or (current_user_role() = 'project_admin' and in_scope(project_id))
    or (
      status = 'approved'
      and case
        when current_user_role() = 'dri' then
          id = current_facility_id()
          or id = current_facility_supplier_id()
          or supplied_by_facility_id = current_facility_id()
        else in_scope(project_id)
      end
    )
  );
create policy facilities_insert on facilities for insert to authenticated
  with check (current_user_role() in ('super_admin', 'project_admin'));
create policy facilities_update on facilities for update to authenticated
  using (
    is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id) and (submitted_by = auth.uid() or status = 'approved'))
  )
  with check (is_super_admin() or current_user_role() = 'project_admin');
create policy facilities_delete on facilities for delete to authenticated
  using (
    is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id) and (submitted_by = auth.uid() or status = 'approved'))
  );

-- ── Products and lots ──────────────────────────────────────────────────────────────────────────
create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null default 'sachet',
  units_per_carton int not null check (units_per_carton > 0),
  shelf_life_months int check (shelf_life_months > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger products_set_updated_at before update on products
  for each row execute function set_updated_at();

create table product_lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  lot_no text not null,
  expiry_date date not null,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, lot_no)
);
create index product_lots_expiry_idx on product_lots(expiry_date);
create trigger product_lots_set_updated_at before update on product_lots
  for each row execute function set_updated_at();

-- Brief §12.2 (settled). Fixed id so data/dummy/product_lots.csv can reference it.
insert into products (id, name, unit, units_per_carton, shelf_life_months)
values ('7f362a56-19fb-5960-a260-14f1c68b1e85', 'RUTF paste 92 g sachet', 'sachet', 150, 24)
on conflict (id) do nothing;

-- ── Dosing rules — data, never code (brief §12.3) ──────────────────────────────────────────────
create table protocol_rules (
  id uuid primary key default gen_random_uuid(),
  protocol_version text not null,
  weight_min_kg numeric not null,
  weight_max_kg numeric not null,
  sachets_per_week numeric not null check (sachets_per_week > 0),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (weight_max_kg >= weight_min_kg),
  check (effective_to is null or effective_to >= effective_from),
  unique (protocol_version, weight_min_kg)
);
create trigger protocol_rules_set_updated_at before update on protocol_rules
  for each row execute function set_updated_at();

-- [VALIDATE] seed defaults, to be signed off by the Katsina State nutrition unit (§12.3).
insert into protocol_rules (protocol_version, weight_min_kg, weight_max_kg, sachets_per_week, effective_from) values
  ('CMAM-175kcal-generic', 3.5, 3.9, 10, '2026-01-01'),
  ('CMAM-175kcal-generic', 4.0, 4.4, 11, '2026-01-01'),
  ('CMAM-175kcal-generic', 4.5, 4.9, 12, '2026-01-01'),
  ('CMAM-175kcal-generic', 5.0, 5.9, 14, '2026-01-01'),
  ('CMAM-175kcal-generic', 6.0, 6.9, 17, '2026-01-01'),
  ('CMAM-175kcal-generic', 7.0, 7.9, 20, '2026-01-01'),
  ('CMAM-175kcal-generic', 8.0, 8.9, 23, '2026-01-01'),
  ('CMAM-175kcal-generic', 9.0, 9.9, 26, '2026-01-01'),
  ('CMAM-175kcal-generic', 10.0, 11.9, 28, '2026-01-01'),
  ('CMAM-175kcal-generic', 12.0, 999, 35, '2026-01-01')
on conflict (protocol_version, weight_min_kg) do nothing;

-- ── Thresholds (brief §12.4) ───────────────────────────────────────────────────────────────────
create table rutf_thresholds (
  project_id uuid not null references projects(id) on delete cascade,
  key text not null,
  value numeric not null,
  note text,
  updated_at timestamptz not null default now(),
  primary key (project_id, key)
);
create trigger rutf_thresholds_set_updated_at before update on rutf_thresholds
  for each row execute function set_updated_at();

-- [VALIDATE] seed defaults (§12.4), confirm with programme.
insert into rutf_thresholds (project_id, key, value, note)
select p.id, t.key, t.value, t.note
from projects p
cross join (values
  ('variance_pct_max', 5, '± % stock card vs physical count'),
  ('variance_pct_max_remote', 10, 'Same, for facilities flagged hard-to-reach'),
  ('vf_min', 0.90, 'OTP verification factor: below suggests over-reporting'),
  ('vf_max', 1.10, 'OTP verification factor: above suggests under-reporting or a parallel supply'),
  ('geofence_m', 150, 'Supervision visit GPS distance from the facility point'),
  ('short_dispense_pct', 5, 'Cumulative dispensed-vs-prescribed deficit before flagging')
) as t(key, value, note)
where p.name = 'Katsina RUTF Pilot'
on conflict (project_id, key) do nothing;

-- ── RLS for products, lots, protocol rules, thresholds ─────────────────────────────────────────
-- Readable by every signed-in user (the Android app needs them offline). Lots: Super Admin and
-- Project Admin add/edit (new lots arrive with deliveries); the rest: Super Admin only.
alter table products enable row level security;
alter table product_lots enable row level security;
alter table protocol_rules enable row level security;
alter table rutf_thresholds enable row level security;

create policy products_select on products for select to authenticated using (true);
create policy products_write on products for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

create policy product_lots_select on product_lots for select to authenticated using (true);
create policy product_lots_insert on product_lots for insert to authenticated
  with check (current_user_role() in ('super_admin', 'project_admin'));
create policy product_lots_update on product_lots for update to authenticated
  using (current_user_role() in ('super_admin', 'project_admin'))
  with check (current_user_role() in ('super_admin', 'project_admin'));
create policy product_lots_delete on product_lots for delete to authenticated
  using (is_super_admin());

create policy protocol_rules_select on protocol_rules for select to authenticated using (true);
create policy protocol_rules_write on protocol_rules for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

create policy rutf_thresholds_select on rutf_thresholds for select to authenticated
  using (in_scope(project_id));
create policy rutf_thresholds_write on rutf_thresholds for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- ── Realtime — the Super Admin approval queue updates live, as for 0015 ────────────────────────
alter publication supabase_realtime add table facilities;
