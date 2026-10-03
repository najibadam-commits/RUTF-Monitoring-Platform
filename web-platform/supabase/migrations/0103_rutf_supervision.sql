-- RUTF Monitoring Platform — migration 0103 (brief §5 "0102_rutf_supervision" + §6, milestone M4)
-- Supervision visits by government nutrition officers (brief §4, §8): a Store Check at an LGA /
-- State store, an OTP Verification at an OTP site. A visit records the supervisor's physical
-- count by lot, the checklist, GPS and evidence; evaluate_visit() then raises the visit-based
-- Findings (brief §6) into review. Supervisors also confirm the adjustments facilities record.
-- Numbered 0103 (brief: 0102) — see DECISIONS R29.

-- ── Who supervises what (brief §4, §12.6) ──────────────────────────────────────────────────────
-- An LGA Nutrition Officer supervises the OTP sites in their LGA; a State nutrition / SMoH M&E
-- officer supervises the stores in the LGAs assigned to them (and the State store).
alter table profiles add column if not exists supervision_level text check (supervision_level in ('stores', 'otp_sites'));
comment on column profiles.supervision_level is
  'For a tpm_supervisor: which facilities they supervise in their LGAs (supervisor_lgas) — '
  'stores (LGA stores + the State store) or otp_sites.';

create table supervisor_lgas (
  profile_id uuid not null references profiles(id) on delete cascade,
  lga_id uuid not null references lgas(id) on delete cascade,
  primary key (profile_id, lga_id)
);
alter table supervisor_lgas enable row level security;
create policy supervisor_lgas_select on supervisor_lgas for select to authenticated
  using (profile_id = auth.uid() or current_user_role() in ('super_admin', 'project_admin', 'state_coordinator'));
create policy supervisor_lgas_write on supervisor_lgas for all to authenticated
  using (is_super_admin() or (current_user_role() = 'project_admin'
         and exists (select 1 from profiles p where p.id = profile_id and p.project_id is not distinct from current_project_id())))
  with check (is_super_admin() or (current_user_role() = 'project_admin'
         and exists (select 1 from profiles p where p.id = profile_id and p.project_id is not distinct from current_project_id())));

-- May the caller supervise this facility? Super Admin always; a supervisor by level and LGA.
-- A facility user never supervises (separation of duties — brief §4).
create or replace function can_supervise(p_facility_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when is_super_admin() then true
    when current_user_role() <> 'tpm_supervisor' then false
    else exists (
      select 1 from facilities f, profiles p
      where f.id = p_facility_id and p.id = auth.uid() and f.status = 'approved' and f.is_active
        and (
          (p.supervision_level = 'otp_sites' and f.facility_type = 'health_facility' and f.is_otp_site
             and exists (select 1 from supervisor_lgas s where s.profile_id = p.id and s.lga_id = f.lga_id))
          or (p.supervision_level = 'stores' and f.facility_type = 'state_store')
          or (p.supervision_level = 'stores' and f.facility_type = 'lga_store'
             and exists (select 1 from supervisor_lgas s where s.profile_id = p.id and s.lga_id = f.lga_id))
        )
    )
  end;
$$;

-- Self-edit pin-back (0038/0100) now also covers supervision_level.
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
  new.supervision_level := old.supervision_level;
  return new;
end;
$$;

-- ── Visits ─────────────────────────────────────────────────────────────────────────────────────
create type visit_type as enum ('store_check', 'otp_verification');
create sequence visit_code_seq;

create table monitoring_visits (
  id uuid primary key default gen_random_uuid(),
  code text unique,                         -- VIS-<LGA3>-<YY>-000123
  project_id uuid references projects(id) on delete set null,
  visit_type visit_type not null,
  facility_id uuid not null references facilities(id),
  supervisor_id uuid not null references profiles(id),
  visit_date date not null,
  period_start date,                        -- OTP verification: the period recounted
  period_end date,
  lat numeric(9,6) not null,
  lng numeric(9,6) not null,
  gps_accuracy_m numeric,
  distance_to_facility_m numeric,           -- computed vs the facility point
  outside_geofence boolean,                 -- distance > geofence_m (brief §7 distance flag)
  device_id text not null,
  local_id text unique,
  status text not null default 'submitted',
  created_at timestamptz not null default now(),
  check (period_start is null or period_end is null or period_start <= period_end)
);
create index monitoring_visits_facility_idx on monitoring_visits(facility_id, visit_date);
create index monitoring_visits_supervisor_idx on monitoring_visits(supervisor_id, visit_date);

create table stock_check_lines (            -- supervisor's physical count per lot
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references monitoring_visits(id) on delete cascade,
  lot_id uuid references product_lots(id),
  lot_no_seen text,
  expiry_seen date,
  stock_card_balance int,                   -- as written on the card
  system_balance int,                       -- ledger balance at visit time (filled server-side)
  physical_count int not null check (physical_count >= 0),
  damaged_count int not null default 0 check (damaged_count >= 0),
  expired_count int not null default 0 check (expired_count >= 0)
);
create index stock_check_lines_visit_idx on stock_check_lines(visit_id);

create table store_checks (                 -- 1:1 with a store_check visit
  visit_id uuid primary key references monitoring_visits(id) on delete cascade,
  stock_card_present boolean not null,
  stock_card_up_to_date boolean,
  storage_dry boolean,
  storage_off_floor boolean,
  storage_ventilated boolean,
  pests_seen boolean,
  fefo_followed boolean,
  notes text
);

create table otp_verifications (            -- 1:1 with an otp_verification visit
  visit_id uuid primary key references monitoring_visits(id) on delete cascade,
  register_present boolean not null,
  admissions_counted int,                   -- supervisor's tally for the period
  sachets_dispensed_counted int,
  admissions_recorded int,                  -- what the app has for the period (server-side)
  sachets_dispensed_recorded int,
  notes text
);

-- Evidence: stock card, stack, register page (names covered), selfie — brief §8.
create table visit_photos (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references monitoring_visits(id) on delete cascade,
  storage_path text not null unique,        -- {supervisor_id}/{visit local_id}/{kind}.jpg in visit-evidence
  kind text not null check (kind in ('stock_card', 'stock', 'register_page', 'selfie', 'other')),
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id) default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index visit_photos_visit_idx on visit_photos(visit_id);

-- Findings link back to the visit that raised them.
alter table issues add column if not exists visit_id uuid references monitoring_visits(id);
create index if not exists issues_visit_id_idx on issues(visit_id);

-- Adjustment confirmation note (supervisor, brief §8).
alter table stock_transactions add column if not exists confirmation_note text;

-- ── Visit-based rules (brief §6) ───────────────────────────────────────────────────────────────
-- Raised into review like the ledger rules (0102), one per rule per visit, linked to the visit.
create or replace function evaluate_visit_internal(p_visit_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v monitoring_visits;
  f facilities;
  sc store_checks;
  ov otp_verifications;
  v_raised int := 0;
  v_id uuid;
  v_limit numeric;
  v_sys int;
  v_phys int;
  v_expired int;
  v_vf numeric;
  v_min numeric;
  v_max numeric;
  v_problems text[];
begin
  select * into v from monitoring_visits where id = p_visit_id;
  if not found then return 0; end if;
  select * into f from facilities where id = v.facility_id;

  -- stock_variance: supervisor's count against the ledger at the visit, all lots together.
  select sum(system_balance)::int, sum(physical_count)::int, sum(expired_count)::int
    into v_sys, v_phys, v_expired from stock_check_lines where visit_id = p_visit_id;
  v_limit := rutf_threshold(f.project_id, case when f.is_hard_to_reach then 'variance_pct_max_remote' else 'variance_pct_max' end,
                            case when f.is_hard_to_reach then 10 else 5 end);
  if coalesce(v_sys, 0) > 0 and abs(v_sys - v_phys)::numeric / v_sys * 100 > v_limit then
    v_id := raise_auto_finding('stock_variance', f.id, 'stock_variance:visit:' || p_visit_id,
      format('Supervision count at %s on %s differs from the ledger by %s%% (counted %s, ledger %s sachets; limit %s%%). For review.',
             f.name, v.visit_date, round(abs(v_sys - v_phys)::numeric / v_sys * 100, 1),
             to_char(v_phys, 'FM999,999,999'), to_char(v_sys, 'FM999,999,999'), v_limit),
      jsonb_build_object('variance_pct', round(abs(v_sys - v_phys)::numeric / v_sys * 100, 1), 'threshold', v_limit,
                         'counted', v_phys, 'ledger_balance', v_sys, 'count_date', v.visit_date),
      v.visit_date, v.visit_date);
    if v_id is not null then update issues set visit_id = p_visit_id where id = v_id; v_raised := v_raised + 1; end if;
  end if;

  -- expired_stock: expired sachets found on the shelf.
  if coalesce(v_expired, 0) > 0 then
    v_id := raise_auto_finding('expired_stock', f.id, 'expired_stock:visit:' || p_visit_id,
      format('%s expired sachets were found on the shelf at %s during the visit on %s. For review.',
             to_char(v_expired, 'FM999,999,999'), f.name, v.visit_date),
      jsonb_build_object('balance', v_expired), v.visit_date, v.visit_date);
    if v_id is not null then update issues set visit_id = p_visit_id where id = v_id; v_raised := v_raised + 1; end if;
  end if;

  if v.visit_type = 'store_check' then
    select * into sc from store_checks where visit_id = p_visit_id;
    if found then
      if not sc.stock_card_present or sc.stock_card_up_to_date is false then
        v_id := raise_auto_finding('no_stock_card', f.id, 'no_stock_card:visit:' || p_visit_id,
          format('No up-to-date stock card at %s during the visit on %s (%s). For review.', f.name, v.visit_date,
                 case when not sc.stock_card_present then 'no stock card' else 'stock card not up to date' end),
          jsonb_build_object('stock_card_present', sc.stock_card_present, 'stock_card_up_to_date', sc.stock_card_up_to_date),
          v.visit_date, v.visit_date);
        if v_id is not null then update issues set visit_id = p_visit_id where id = v_id; v_raised := v_raised + 1; end if;
      end if;
      v_problems := array_remove(array[
        case when sc.storage_dry is false then 'store not dry' end,
        case when sc.storage_off_floor is false then 'stock on the floor' end,
        case when sc.pests_seen then 'signs of pests' end], null);
      if cardinality(v_problems) > 0 then
        v_id := raise_auto_finding('poor_storage', f.id, 'poor_storage:visit:' || p_visit_id,
          format('Storage at %s during the visit on %s: %s. For review.', f.name, v.visit_date, array_to_string(v_problems, ', ')),
          jsonb_build_object('storage_dry', sc.storage_dry, 'storage_off_floor', sc.storage_off_floor, 'pests_seen', sc.pests_seen),
          v.visit_date, v.visit_date);
        if v_id is not null then update issues set visit_id = p_visit_id where id = v_id; v_raised := v_raised + 1; end if;
      end if;
    end if;
  else
    select * into ov from otp_verifications where visit_id = p_visit_id;
    if found then
      if not ov.register_present then
        v_id := raise_auto_finding('register_missing', f.id, 'register_missing:visit:' || p_visit_id,
          format('The OTP register was not available at %s during the visit on %s. For review.', f.name, v.visit_date),
          jsonb_build_object('register_present', false), v.period_start, v.period_end);
        if v_id is not null then update issues set visit_id = p_visit_id where id = v_id; v_raised := v_raised + 1; end if;
      elsif ov.sachets_dispensed_counted is not null and coalesce(ov.sachets_dispensed_recorded, 0) > 0 then
        -- OTP VF = supervisor's register count ÷ app-recorded dispensing (brief §7).
        v_vf := round(ov.sachets_dispensed_counted::numeric / ov.sachets_dispensed_recorded, 2);
        v_min := rutf_threshold(f.project_id, 'vf_min', 0.90);
        v_max := rutf_threshold(f.project_id, 'vf_max', 1.10);
        if v_vf < v_min or v_vf > v_max then
          v_id := raise_auto_finding('dispensing_gap', f.id, 'dispensing_gap:visit:' || p_visit_id,
            format('At %s, the register shows %s sachets dispensed from %s to %s, against %s recorded in the app — verification factor %s (range %s–%s). For review.',
                   f.name, to_char(ov.sachets_dispensed_counted, 'FM999,999,999'), v.period_start, v.period_end,
                   to_char(ov.sachets_dispensed_recorded, 'FM999,999,999'), v_vf, v_min, v_max),
            jsonb_build_object('vf', v_vf, 'vf_min', v_min, 'vf_max', v_max,
                               'sachets_dispensed_counted', ov.sachets_dispensed_counted,
                               'sachets_dispensed_recorded', ov.sachets_dispensed_recorded),
            v.period_start, v.period_end);
          if v_id is not null then update issues set visit_id = p_visit_id where id = v_id; v_raised := v_raised + 1; end if;
        end if;
      end if;
    end if;
  end if;

  return v_raised;
end;
$$;

create or replace function evaluate_visit(p_visit_id uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and current_user_role() not in ('super_admin', 'project_admin') then
    raise exception 'Only an administrator can run Finding checks';
  end if;
  return evaluate_visit_internal(p_visit_id);
end;
$$;

-- History line: an auto-Finding says whether a ledger check or a visit raised it.
create or replace function log_issue_reported()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.auto_generated then
    insert into issue_history (issue_id, actor_id, actor_label, action, note)
    values (new.id, null, 'RUTF Monitoring (automatic check)', 'Finding reported',
            'Raised automatically from ' ||
            case when (select source from finding_types where key = new.finding_type) = 'visit' or new.dedupe_key like '%:visit:%'
                 then 'a supervision visit' else 'the stock ledger' end ||
            ' for review — ' || coalesce((select label from finding_types where key = new.finding_type), new.finding_type) || '.');
  else
    insert into issue_history (issue_id, actor_id, actor_label, action, note)
    values (new.id, new.reported_by, coalesce((select name from profiles where id = new.reported_by), 'TPM Field Monitor'),
            'Finding reported', 'Field visit finding logged with photo evidence and GPS capture.');
  end if;
  return new;
end;
$$;

-- ── Recording a visit (from the Android wizards, through the sync queue) ───────────────────────
-- p_lines: [{ lot_id?/lot_no?/expiry_date?, stock_card_balance?, physical_count, damaged_count?, expired_count? }]
-- p_checklist (store_check): { stock_card_present, stock_card_up_to_date, storage_dry, storage_off_floor,
--                              storage_ventilated, pests_seen, fefo_followed, notes }
-- p_checklist (otp_verification): { register_present, admissions_counted, sachets_dispensed_counted, notes }
-- Idempotent on p_local_id: a retried sync gets the stored result back, marked duplicate.
create or replace function record_visit(
  p_local_id text, p_visit_type visit_type, p_facility_id uuid, p_visit_date date,
  p_lat numeric, p_lng numeric, p_gps_accuracy_m numeric, p_lines jsonb, p_checklist jsonb,
  p_period_start date default null, p_period_end date default null, p_device_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f facilities;
  v monitoring_visits;
  v_line record;
  v_lot uuid;
  v_distance numeric;
  v_geofence numeric;
  v_lga_abbr text;
  v_raised int;
  v_adm int;
  v_disp int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if nullif(trim(p_local_id), '') is null then raise exception 'local_id is required'; end if;

  select * into v from monitoring_visits where local_id = p_local_id;
  if found then
    if v.supervisor_id <> auth.uid() then raise exception 'local_id % was already used by another user', p_local_id; end if;
    return jsonb_build_object('visit_id', v.id, 'code', v.code, 'duplicate', true,
                              'findings_raised', (select count(*) from issues where visit_id = v.id));
  end if;

  select * into f from facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found'; end if;
  if not can_supervise(p_facility_id) then raise exception 'You are not assigned to supervise this facility'; end if;
  if p_visit_type = 'store_check' and f.facility_type = 'health_facility' then raise exception 'A store check is for State and LGA stores'; end if;
  if p_visit_type = 'otp_verification' and not f.is_otp_site then raise exception 'An OTP verification is for OTP sites'; end if;
  if p_visit_date is null or p_visit_date > current_date then raise exception 'Visit date is missing or in the future'; end if;
  if p_lat is null or p_lng is null then raise exception 'GPS location is required'; end if;
  if p_visit_type = 'otp_verification' and (p_period_start is null or p_period_end is null or p_period_end > p_visit_date) then
    raise exception 'An OTP verification needs the period recounted, ending on or before the visit date';
  end if;
  if jsonb_typeof(p_checklist) <> 'object' then raise exception 'The checklist is required'; end if;

  if f.lat is not null and f.lng is not null then
    v_distance := round(st_distance(st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
                                    st_setsrid(st_makepoint(f.lng, f.lat), 4326)::geography));
  end if;
  v_geofence := rutf_threshold(f.project_id, 'geofence_m', 150);
  select abbr into v_lga_abbr from lgas where id = f.lga_id;

  insert into monitoring_visits (code, project_id, visit_type, facility_id, supervisor_id, visit_date, period_start, period_end,
    lat, lng, gps_accuracy_m, distance_to_facility_m, outside_geofence, device_id, local_id)
  values ('VIS-' || coalesce(v_lga_abbr, 'GEN') || '-' || to_char(p_visit_date, 'YY') || '-' || lpad(nextval('visit_code_seq')::text, 6, '0'),
    f.project_id, p_visit_type, p_facility_id, auth.uid(), p_visit_date, p_period_start, p_period_end,
    p_lat, p_lng, p_gps_accuracy_m, v_distance, v_distance > v_geofence, coalesce(p_device_id, 'unknown'), p_local_id)
  returning * into v;

  for v_line in select * from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb))
      as x(lot_id uuid, lot_no text, expiry_date date, stock_card_balance int, physical_count int, damaged_count int, expired_count int) loop
    if coalesce(v_line.physical_count, -1) < 0 then raise exception 'Each counted lot needs a count of zero or more'; end if;
    v_lot := resolve_lot(v_line.lot_id, v_line.lot_no, v_line.expiry_date);
    insert into stock_check_lines (visit_id, lot_id, lot_no_seen, expiry_seen, stock_card_balance, system_balance,
      physical_count, damaged_count, expired_count)
    values (v.id, v_lot, v_line.lot_no, v_line.expiry_date, v_line.stock_card_balance,
      ledger_balance(p_facility_id, v_lot, p_visit_date), v_line.physical_count,
      coalesce(v_line.damaged_count, 0), coalesce(v_line.expired_count, 0));
  end loop;

  if p_visit_type = 'store_check' then
    insert into store_checks (visit_id, stock_card_present, stock_card_up_to_date, storage_dry, storage_off_floor,
      storage_ventilated, pests_seen, fefo_followed, notes)
    values (v.id, coalesce((p_checklist->>'stock_card_present')::boolean, false), (p_checklist->>'stock_card_up_to_date')::boolean,
      (p_checklist->>'storage_dry')::boolean, (p_checklist->>'storage_off_floor')::boolean,
      (p_checklist->>'storage_ventilated')::boolean, (p_checklist->>'pests_seen')::boolean,
      (p_checklist->>'fefo_followed')::boolean, p_checklist->>'notes');
  else
    select coalesce(sum(new_admissions), 0)::int, coalesce(sum(sachets_dispensed), 0)::int into v_adm, v_disp
    from otp_daily_dispensing where facility_id = p_facility_id and dispense_date between p_period_start and p_period_end;
    insert into otp_verifications (visit_id, register_present, admissions_counted, sachets_dispensed_counted,
      admissions_recorded, sachets_dispensed_recorded, notes)
    values (v.id, coalesce((p_checklist->>'register_present')::boolean, false),
      (p_checklist->>'admissions_counted')::int, (p_checklist->>'sachets_dispensed_counted')::int,
      v_adm, v_disp, p_checklist->>'notes');
  end if;

  v_raised := evaluate_visit_internal(v.id);

  return jsonb_build_object('visit_id', v.id, 'code', v.code, 'duplicate', false, 'findings_raised', v_raised,
    'distance_to_facility_m', v_distance, 'outside_geofence', v.outside_geofence,
    'sachets_dispensed_recorded', v_disp, 'admissions_recorded', v_adm,
    'lines', (select jsonb_agg(jsonb_build_object('lot_id', lot_id, 'physical_count', physical_count, 'system_balance', system_balance))
              from stock_check_lines where visit_id = v.id));
end;
$$;

-- A supervisor confirms (or a Super Admin confirms) an adjustment a facility recorded (R7).
create or replace function confirm_adjustment(p_txn_id uuid, p_note text default null)
returns stock_transactions language plpgsql security definer set search_path = public as $$
declare t stock_transactions;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into t from stock_transactions where id = p_txn_id for update;
  if not found or t.txn_type <> 'adjustment' then raise exception 'Adjustment not found'; end if;
  if not can_supervise(t.facility_id) then raise exception 'You are not assigned to supervise this facility'; end if;
  if t.status = 'confirmed' then return t; end if; -- idempotent: a retried sync
  if t.status <> 'recorded' then raise exception 'This adjustment can no longer be confirmed'; end if;
  update stock_transactions set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(), confirmation_note = nullif(trim(p_note), '')
  where id = p_txn_id returning * into t;
  return t;
end;
$$;

revoke execute on function evaluate_visit_internal from public, anon, authenticated;
revoke execute on function record_visit, confirm_adjustment, evaluate_visit, can_supervise from public, anon;
grant execute on function record_visit, confirm_adjustment, evaluate_visit, can_supervise to authenticated;

-- ── RLS: reads only; writes go through record_visit ────────────────────────────────────────────
alter table monitoring_visits enable row level security;
alter table stock_check_lines enable row level security;
alter table store_checks enable row level security;
alter table otp_verifications enable row level security;
alter table visit_photos enable row level security;

-- A facility user sees the visits to their facility; everyone else, their project's visits.
create or replace function can_see_visit(p_visit_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from monitoring_visits v where v.id = p_visit_id
      and case when current_user_role() = 'dri' then v.facility_id = current_facility_id()
               else v.supervisor_id = auth.uid() or in_scope(v.project_id) end
  );
$$;

create policy monitoring_visits_select on monitoring_visits for select to authenticated using (can_see_visit(id));
create policy stock_check_lines_select on stock_check_lines for select to authenticated using (can_see_visit(visit_id));
create policy store_checks_select on store_checks for select to authenticated using (can_see_visit(visit_id));
create policy otp_verifications_select on otp_verifications for select to authenticated using (can_see_visit(visit_id));
create policy visit_photos_select on visit_photos for select to authenticated using (can_see_visit(visit_id));
create policy visit_photos_insert on visit_photos for insert to authenticated
  with check (exists (select 1 from monitoring_visits v where v.id = visit_id and v.supervisor_id = auth.uid()));

-- ── Evidence bucket: {supervisor_id}/{visit local_id}/{kind}.jpg ───────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-evidence', 'visit-evidence', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy "visit-evidence select" on storage.objects for select to authenticated
  using (bucket_id = 'visit-evidence' and exists (select 1 from visit_photos p where p.storage_path = name and can_see_visit(p.visit_id)));
create policy "visit-evidence insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'visit-evidence' and (storage.foldername(name))[1] = auth.uid()::text
              and current_user_role() in ('tpm_supervisor', 'super_admin'));
