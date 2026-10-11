-- RUTF Monitoring Platform — migration 0138: requests and distribution worked out from need
-- (DECISIONS R173), following the programme's "RUTF allocation from State to OTP centre":
--   §1, §6  A request is calculated from the patients under treatment, the expected new
--           admissions and discharges, each patient's prescribed ration and the usable stock:
--           need over the cover period − usable stock (= the document's 60 − 15 = 45 cartons).
--           The form suggests it; the officer may change it, with the reason.
--   §1      An LGA's request counts the usable stock at its OTP centres as well as its store.
--   §2      The LGA's monthly figures (patients at the start, new admissions, discharges, other
--           outcomes, patients at the end, stock) travel with its request to the State.
--   §3      OTP centres are Apex or satellite (one Apex per LGA).
--   §4      The State Nutrition Officer reviews the request with the LGA's figures per centre.
--   §5      After stock arrives, the LGA Nutrition Officer splits it across the Apex and the
--           satellites by need (an allocation plan); each line is an ordinary stock issue.
--   §6      Cover: one month for an LGA, one week for an OTP centre (thresholds below).
-- Settings (rutf_thresholds, per project): supply_cover_days_lga 30, supply_cover_days_otp 7,
-- supply_buffer_pct 0 (no safety stock for now — the user's decision).

-- ── Apex and satellite OTP centres ───────────────────────────────────────────────────────────
-- Kept in its own table (not a facilities column) so setting it never goes through the Master Data
-- approval workflow on facilities; one row per LGA, with who set it and when.
create table lga_apex_otp (
  lga_id uuid primary key references lgas(id),
  facility_id uuid not null unique references facilities(id),
  dummy boolean not null default false,          -- set by seed-demo-apex-sites.js (DUMMY data)
  set_by uuid references profiles(id),
  set_at timestamptz not null default now()
);
alter table lga_apex_otp enable row level security;
revoke all on table lga_apex_otp from anon, authenticated;
create trigger lga_apex_otp_audit after insert or update or delete on lga_apex_otp for each row execute function audit_row_change();

create or replace function rutf_is_apex(p_facility_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from lga_apex_otp where facility_id = p_facility_id);
$$;

-- The LGA Nutrition Officer of the LGA, the State Nutrition Officer, or an administrator sets it.
create or replace function set_apex_otp(p_facility_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f facilities;
begin
  select * into f from facilities where id = p_facility_id and is_otp_site and facility_type = 'health_facility' and status = 'approved';
  if f.id is null then raise exception 'Not an OTP centre'; end if;
  if not (is_super_admin() or current_user_role() = 'project_admin' or rutf_is_lga_nutritionist(f.lga_id) or rutf_is_state_nutritionist(f.state_id)) then
    raise exception 'Only the LGA or State Nutrition Officer, or an administrator, sets the Apex OTP centre';
  end if;
  insert into lga_apex_otp (lga_id, facility_id, set_by) values (f.lga_id, f.id, auth.uid())
  on conflict (lga_id) do update set facility_id = excluded.facility_id, dummy = false, set_by = excluded.set_by, set_at = now();
  return jsonb_build_object('apex', f.id, 'name', f.name);
end;
$$;

-- ── Settings ──────────────────────────────────────────────────────────────────────────────────
insert into rutf_thresholds (project_id, key, value, note)
select p.id, t.key, t.value, t.note from projects p
cross join (values
  ('supply_cover_days_lga', 30, 'An LGA request covers this many days (allocation guide §6: at least one month)'),
  ('supply_cover_days_otp', 7, 'An OTP centre request and the LGA allocation cover this many days (guide §6: weekly)'),
  ('supply_buffer_pct', 0, 'Safety stock added on top of the need, % (none for now: user, 11 Oct 2026)')
) as t(key, value, note)
where p.name = 'Katsina RUTF Pilot'
on conflict (project_id, key) do nothing;

-- ── Usable stock: lots not yet expired (and unallocated rows, which carry shortfalls) ─────────
create or replace function rutf_usable_stock(p_facility_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)), 0)::int
  from stock_transactions t left join product_lots l on l.id = t.lot_id
  where t.facility_id = p_facility_id and t.status <> 'voided' and t.txn_date <= current_date
    and (l.id is null or l.expiry_date >= current_date);
$$;

-- ── One OTP centre's caseload and need ────────────────────────────────────────────────────────
-- Patients, admissions, discharges and the ration come from the child registry (the Digital OTP
-- Admission Card) where the centre uses it; otherwise from its daily dispensing register (children
-- seen a week over the last 4 weeks ≈ patients, since each child comes weekly); otherwise the last accepted
-- weekly report. The ration is each child's prescribed packets a week (otp_ration on the latest
-- weight); without the registry, sachets given per child seen over the last 28 days.
create or replace function rutf_site_need(p_facility_id uuid, p_cover_days int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f facilities; v_src text; v_pat numeric := 0; v_new numeric := 0; v_dis numeric := 0; v_ration numeric; v_usable int;
  v_weeks numeric := p_cover_days / 7.0; v_end numeric; v_need int; v_rep jsonb; v_seen int; v_given int;
begin
  select * into f from facilities where id = p_facility_id;
  if exists (select 1 from otp_admissions where facility_id = f.id) then
    v_src := 'registry';
    select count(*) into v_pat from otp_admissions where facility_id = f.id and status = 'active';
    select count(*) / 4.0 into v_new from otp_admissions where facility_id = f.id and admitted_on > current_date - 28;
    select count(*) / 4.0 into v_dis from otp_admissions where facility_id = f.id and outcome_on > current_date - 28;
    select avg((otp_ration(coalesce(
             (select v.weight_kg from otp_visits v where v.admission_id = a.id and v.weight_kg is not null order by v.visit_on desc limit 1),
             a.weight_kg)) ->> 'packets_per_week')::numeric)
      into v_ration from otp_admissions a where a.facility_id = f.id and a.status = 'active';
  elsif exists (select 1 from otp_daily_dispensing where facility_id = f.id and dispense_date > current_date - 28) then
    v_src := 'dispensing register';
    -- Each child comes weekly, so children seen a week (averaged over 4 weeks) ≈ patients.
    select coalesce(sum(new_admissions), 0) / 4.0, sum(children_seen), sum(sachets_dispensed) into v_new, v_seen, v_given
      from otp_daily_dispensing where facility_id = f.id and dispense_date > current_date - 28;
    v_pat := coalesce(v_seen, 0) / 4.0;
    if v_seen > 0 then v_ration := v_given::numeric / v_seen; end if;
  else
    select v.data into v_rep from otp_weekly_reports r join otp_weekly_report_versions v on v.report_id = r.id and v.decision = 'approved'
    where r.facility_id = f.id order by r.week_start desc, v.version desc limit 1;
    if v_rep is not null then
      v_src := 'last accepted weekly report';
      v_pat := coalesce((v_rep #>> '{F,SAM,actual,total}')::numeric, 0);
      v_new := coalesce((v_rep #>> '{C,SAM,total}')::numeric, 0);
      v_dis := coalesce((v_rep #>> '{E,SAM,cured,total}')::numeric, 0);
    else
      v_src := 'no data';
    end if;
  end if;
  -- No ration measured: the protocol ration at 7.5 kg (21 packets a week).
  v_ration := coalesce(nullif(v_ration, 0), (otp_ration(7.5) ->> 'packets_per_week')::numeric, 21);
  v_end := greatest(0, v_pat + (v_new - v_dis) * v_weeks);
  -- Need over the cover period: the average caseload (start and projected end) × ration × weeks.
  v_need := ceil((v_pat + v_end) / 2.0 * v_ration * v_weeks);
  v_usable := rutf_usable_stock(f.id);
  return jsonb_build_object('facility_id', f.id, 'facility', f.name, 'facility_code', f.facility_code, 'apex', rutf_is_apex(f.id), 'source', v_src,
    'patients', round(v_pat), 'new_per_week', round(v_new, 1), 'discharges_per_week', round(v_dis, 1),
    'projected_patients_end', round(v_end), 'ration_per_patient_week', round(v_ration, 1),
    'cover_days', p_cover_days, 'need', v_need, 'usable_stock', v_usable, 'gap', greatest(0, v_need - v_usable));
end;
$$;

-- The suggestion: need − usable stock, plus the safety stock %, rounded up to whole cartons.
create or replace function rutf_suggest(p_gap int, p_project uuid)
returns int language sql stable security definer set search_path = public as $$
  select (ceil(greatest(0, p_gap) * (1 + rutf_threshold(p_project, 'supply_buffer_pct', 0) / 100.0) /
               (select units_per_carton from products order by name limit 1)) *
          (select units_per_carton from products order by name limit 1))::int;
$$;

-- ── An LGA's monthly figures (guide §2), from the OTP reports its LGA Nutrition Officer accepted ─
create or replace function lga_month_figures(p_lga_id uuid, p_month date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ms date := date_trunc('month', p_month)::date; me date; v jsonb; v_store facilities;
begin
  me := (ms + interval '1 month - 1 day')::date;
  select * into v_store from facilities where lga_id = p_lga_id and facility_type = 'lga_store' and status = 'approved' order by is_active desc limit 1;
  with acc as (
    select r.facility_id, r.week_start, x.data from otp_weekly_reports r
    join lateral (select data from otp_weekly_report_versions w where w.report_id = r.id and w.decision = 'approved' order by w.version desc limit 1) x on true
    where r.lga_id = p_lga_id and r.week_start between ms and me
  ), firsts as (select distinct on (facility_id) facility_id, data from acc order by facility_id, week_start),
     lasts as (select distinct on (facility_id) facility_id, data from acc order by facility_id, week_start desc)
  select jsonb_build_object(
    'month', to_char(ms, 'YYYY-MM'), 'weeks_reported', (select count(*) from acc), 'sites_reporting', (select count(distinct facility_id) from acc),
    'otp_sites', (select count(*) from facilities where lga_id = p_lga_id and is_otp_site and is_active and status = 'approved'),
    'patients_start', (select coalesce(sum((data #>> '{B,SAM,total}')::numeric), 0) from firsts),
    'new_admissions', (select coalesce(sum((data #>> '{C,SAM,total}')::numeric), 0) from acc),
    'transfers_in', (select coalesce(sum((data #>> '{D,SAM,in,total}')::numeric), 0) from acc),
    'discharged_cured', (select coalesce(sum((data #>> '{E,SAM,cured,total}')::numeric), 0) from acc),
    'defaulted', (select coalesce(sum((data #>> '{E,SAM,defaulted,total}')::numeric), 0) from acc),
    'died', (select coalesce(sum((data #>> '{E,SAM,died,total}')::numeric), 0) from acc),
    'transferred_or_other', (select coalesce(sum(coalesce((data #>> '{E,SAM,non_recovered,total}')::numeric, 0)
        + coalesce((data #>> '{E,SAM,transferred_inpatient,total}')::numeric, 0) + coalesce((data #>> '{E,SAM,refused_inpatient,total}')::numeric, 0)
        + coalesce((data #>> '{D,SAM,out,total}')::numeric, 0)), 0) from acc),
    'patients_end', (select coalesce(sum((data #>> '{F,SAM,actual,total}')::numeric), 0) from lasts),
    'otp_stock_end', (select coalesce(sum((data #>> '{G,physical_count}')::numeric), 0) from lasts),
    'store_stock_end', case when v_store.id is not null then ledger_balance(v_store.id, null, least(me, current_date)) end,
    'source', 'OTP weekly reports accepted by the LGA Nutrition Officer, weeks starting in the month')
  into v;
  return v;
end;
$$;

-- ── The request form now carries the calculation ──────────────────────────────────────────────
alter table supply_requests add column if not exists calculation jsonb;
alter table supply_request_lines add column if not exists suggested_qty int;

create or replace function supply_request_calculation(f facilities)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_days int; v_sites jsonb; v_need int; v_usable int; v_store int; v_month date := (date_trunc('month', current_date) - interval '1 month')::date;
begin
  if f.facility_type = 'lga_store' then
    v_days := rutf_threshold(f.project_id, 'supply_cover_days_lga', 30)::int;
    select coalesce(jsonb_agg(rutf_site_need(s.id, v_days) order by rutf_is_apex(s.id) desc, s.name), '[]') into v_sites
    from facilities s where s.lga_id = f.lga_id and s.facility_type = 'health_facility' and s.is_otp_site and s.is_active and s.status = 'approved';
    select coalesce(sum((x ->> 'need')::int), 0), coalesce(sum((x ->> 'usable_stock')::int), 0) into v_need, v_usable from jsonb_array_elements(v_sites) x;
    v_store := rutf_usable_stock(f.id);
    return jsonb_build_object('level', 'lga_to_state', 'cover_days', v_days, 'buffer_pct', rutf_threshold(f.project_id, 'supply_buffer_pct', 0),
      'sites', v_sites,
      'patients', (select coalesce(sum((x ->> 'patients')::int), 0) from jsonb_array_elements(v_sites) x),
      'need', v_need, 'usable_at_sites', v_usable, 'usable_at_store', v_store, 'usable_total', v_usable + v_store,
      'gap', greatest(0, v_need - v_usable - v_store),
      'suggested_qty', rutf_suggest(v_need - v_usable - v_store, f.project_id),
      'month', lga_month_figures(f.lga_id, v_month),
      'calculated_at', now());
  else
    v_days := rutf_threshold(f.project_id, 'supply_cover_days_otp', 7)::int;
    v_sites := rutf_site_need(f.id, v_days);
    return jsonb_build_object('level', 'otp_to_lga', 'cover_days', v_days, 'buffer_pct', rutf_threshold(f.project_id, 'supply_buffer_pct', 0),
      'site', v_sites, 'need', (v_sites ->> 'need')::int, 'usable_total', (v_sites ->> 'usable_stock')::int,
      'gap', (v_sites ->> 'gap')::int, 'suggested_qty', rutf_suggest((v_sites ->> 'gap')::int, f.project_id), 'calculated_at', now());
  end if;
end;
$$;

create or replace function supply_request_form()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f facilities; s facilities; v_balance int; v_used int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select fa.* into f from facilities fa where fa.id = current_facility_id();
  if current_user_role() <> 'dri' or f.id is null then raise exception 'Only an OTP Officer or an LGA Nutrition Officer makes supply requests'; end if;
  if f.facility_type = 'state_store' then raise exception 'The State store is not supplied through this form'; end if;
  if f.facility_type = 'health_facility' and not f.is_otp_site then raise exception 'Only OTP sites make supply requests'; end if;
  select fa.* into s from facilities fa where fa.id = f.supplied_by_facility_id;
  if s.id is null then raise exception 'Your facility has no supplying store on record — ask your administrator'; end if;
  v_balance := ledger_balance(f.id, null, current_date);
  select coalesce(sum(quantity_sachets), 0) into v_used from stock_transactions
  where facility_id = f.id and status <> 'voided' and txn_type in ('issue', 'dispensed') and txn_date > current_date - 30;
  return jsonb_build_object(
    'facility', jsonb_build_object('id', f.id, 'name', f.name, 'type', f.facility_type),
    'supplier', jsonb_build_object('id', s.id, 'name', s.name, 'type', s.facility_type),
    'level', case f.facility_type when 'lga_store' then 'lga_to_state' else 'otp_to_lga' end,
    'balance_on_hand', v_balance,
    'consumed_30d', v_used,
    'calculation', supply_request_calculation(f),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'unit', unit, 'units_per_carton', units_per_carton) order by name), '[]') from products),
    'open_requests', (select count(*) from supply_requests where from_facility_id = f.id
                      and status in ('submitted', 'under_review', 'queried', 'approved', 'partially_fulfilled')));
end;
$$;

-- Create: the calculation is saved with the request; asking for a different quantity than the
-- suggestion needs the reason (the justification).
create or replace function supply_request_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_form jsonb; f facilities; r supply_requests; v_line record; v_abbr text; v_n int := 0; v_suggest int; v_total int := 0;
begin
  if p ->> 'local_id' is not null then
    select * into r from supply_requests where local_id = p ->> 'local_id';
    if found then return jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status); end if;
  end if;
  v_form := supply_request_form();   -- checks the caller
  select * into f from facilities where id = (v_form #>> '{facility,id}')::uuid;
  if jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') = 0 then
    raise exception 'Add at least one commodity with a quantity';
  end if;
  v_suggest := (v_form #>> '{calculation,suggested_qty}')::int;
  select coalesce(sum((x ->> 'requested_qty')::int), 0) into v_total from jsonb_array_elements(p -> 'lines') x;
  if v_suggest is not null and v_total <> v_suggest and coalesce(trim(p ->> 'justification'), '') = '' then
    raise exception 'You asked for % sachets; the calculation suggests %. Say why in the justification.', v_total, v_suggest;
  end if;
  select abbr into v_abbr from lgas where id = f.lga_id;
  insert into supply_requests (project_id, code, level, from_facility_id, to_facility_id, needed_by, justification, requested_by, local_id, calculation)
  values (f.project_id, 'SR-' || coalesce(v_abbr, 'GEN') || '-' || to_char(current_date, 'YY') || '-' || lpad(nextval('supply_request_code_seq')::text, 6, '0'),
          v_form ->> 'level', f.id, f.supplied_by_facility_id, nullif(p ->> 'needed_by', '')::date,
          nullif(trim(p ->> 'justification'), ''), auth.uid(), p ->> 'local_id', v_form -> 'calculation')
  returning * into r;
  for v_line in select * from jsonb_to_recordset(p -> 'lines') as x(product_id uuid, requested_qty int, stockout_days int) loop
    if coalesce(v_line.requested_qty, 0) <= 0 then raise exception 'Each commodity needs a quantity above zero'; end if;
    if not exists (select 1 from products where id = v_line.product_id) then raise exception 'Unknown commodity'; end if;
    insert into supply_request_lines (request_id, product_id, balance_on_hand, consumed_30d, stockout_days, requested_qty, suggested_qty)
    values (r.id, v_line.product_id, (v_form ->> 'balance_on_hand')::int, (v_form ->> 'consumed_30d')::int, v_line.stockout_days, v_line.requested_qty,
            case when v_n = 0 then v_suggest end);
    v_n := v_n + 1;
  end loop;
  perform supply_request_log(r.id, 'submitted', r.justification,
    (select jsonb_agg(jsonb_build_object('product_id', product_id, 'requested_qty', requested_qty, 'suggested_qty', suggested_qty)) from supply_request_lines where request_id = r.id),
    null, 'submitted');
  perform supply_request_notify(r, r.to_facility_id, 'Supply request ' || r.code || ' from ' || f.name || ' is waiting for your review.');
  return jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status);
end;
$$;

-- The request with the suggested quantity on each line (0135's, plus suggested_qty).
create or replace function supply_request_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r supply_requests; v_role text := current_user_role(); v_me uuid := current_facility_id();
begin
  select * into r from supply_requests where id = p_id;
  if not found or not supply_request_can_see(r) then raise exception 'Supply request not found'; end if;
  return jsonb_build_object(
    'request', to_jsonb(r) || jsonb_build_object(
      'from_name', (select name from facilities where id = r.from_facility_id),
      'from_lga', (select l.name from facilities f join lgas l on l.id = f.lga_id where f.id = r.from_facility_id),
      'to_name', (select name from facilities where id = r.to_facility_id),
      'requested_by_name', (select name from profiles where id = r.requested_by),
      'reviewed_by_name', (select name from profiles where id = r.reviewed_by)),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('product_id', l.product_id, 'product', pr.name, 'unit', pr.unit,
                'units_per_carton', pr.units_per_carton, 'balance_on_hand', l.balance_on_hand, 'consumed_30d', l.consumed_30d,
                'stockout_days', l.stockout_days, 'requested_qty', l.requested_qty, 'suggested_qty', l.suggested_qty, 'approved_qty', l.approved_qty) order by pr.name), '[]')
              from supply_request_lines l join products pr on pr.id = l.product_id where l.request_id = r.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'actor', p.name, 'actor_role', e.actor_role,
                'note', e.note, 'detail', e.detail, 'status_before', e.status_before, 'status_after', e.status_after, 'at', e.created_at)
                order by e.created_at), '[]')
               from supply_request_events e left join profiles p on p.id = e.actor where e.request_id = r.id),
    'transfers', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'issued_date', t.issued_date,
                'sachets_issued', t.sachets_issued, 'sachets_received', t.sachets_received, 'status', t.status) order by t.issued_date), '[]')
                  from transfers t where t.supply_request_id = r.id),
    'supplier_balance', case when v_me = r.to_facility_id or v_role <> 'dri' or rutf_officer_level() = 'state'
                             then ledger_balance(r.to_facility_id, null, current_date) end,
    'can', jsonb_build_object(
      'review', v_role = 'dri' and v_me = r.to_facility_id and r.status in ('submitted', 'under_review'),
      'respond', v_role = 'dri' and v_me = r.from_facility_id and r.status = 'queried',
      'cancel', v_role = 'dri' and v_me = r.from_facility_id and r.status in ('submitted', 'under_review', 'queried'),
      'comment', v_role in ('dri', 'state_coordinator', 'tpm_supervisor') and r.status not in ('received', 'cancelled', 'rejected'),
      'dispatch', v_role = 'dri' and v_me = r.to_facility_id and r.status in ('approved', 'partially_fulfilled')));
end;
$$;

-- ── The LGA allocation plan (guide §5) ────────────────────────────────────────────────────────
create table lga_allocations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  store_id uuid not null references facilities(id),
  lga_id uuid not null references lgas(id),
  cover_days int not null,
  store_usable_before int not null,
  lines jsonb not null,            -- [{facility_id, facility, apex, need, usable, gap, suggested, issued, transfer_id, transfer_code}]
  note text,
  local_id text unique,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table lga_allocations enable row level security;
revoke all on table lga_allocations from anon, authenticated;
create trigger lga_allocations_audit after insert or update or delete on lga_allocations for each row execute function audit_row_change();

-- Each centre's need for the OTP cover period, the gap after its usable stock, and the suggested
-- share: the gap, scaled down evenly when the store cannot cover every gap. Approved requests
-- waiting for dispatch are shown beside it.
create or replace function lga_allocation_plan()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st facilities; v_days int; v_sites jsonb; v_gaps int; v_usable int; v_scale numeric; v_out jsonb := '[]'::jsonb; x jsonb; v_carton int;
begin
  select f.* into st from profiles p join facilities f on f.id = p.facility_id
  where p.id = auth.uid() and p.role = 'dri' and p.status = 'active' and f.facility_type = 'lga_store';
  if st.id is null then raise exception 'Only an LGA Nutrition Officer plans the distribution to OTP centres'; end if;
  v_days := rutf_threshold(st.project_id, 'supply_cover_days_otp', 7)::int;
  v_carton := (select units_per_carton from products order by name limit 1);
  select coalesce(jsonb_agg(rutf_site_need(s.id, v_days) order by rutf_is_apex(s.id) desc, s.name), '[]') into v_sites
  from facilities s where s.supplied_by_facility_id = st.id and s.facility_type = 'health_facility' and s.is_otp_site and s.is_active and s.status = 'approved';
  v_usable := rutf_usable_stock(st.id);
  select coalesce(sum(rutf_suggest((y ->> 'gap')::int, st.project_id)), 0) into v_gaps from jsonb_array_elements(v_sites) y;
  v_scale := case when v_gaps > v_usable and v_gaps > 0 then greatest(v_usable, 0)::numeric / v_gaps else 1 end;
  for x in select * from jsonb_array_elements(v_sites) loop
    v_out := v_out || (x || jsonb_build_object(
      'suggested', (floor(rutf_suggest((x ->> 'gap')::int, st.project_id) * v_scale / v_carton) * v_carton)::int,
      'approved_requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status,
            'approved', (select sum(approved_qty) from supply_request_lines l where l.request_id = r.id),
            'sent', (select coalesce(sum(sachets_issued), 0) from transfers t where t.supply_request_id = r.id))), '[]')
         from supply_requests r where r.from_facility_id = (x ->> 'facility_id')::uuid and r.to_facility_id = st.id
           and r.status in ('submitted', 'under_review', 'queried', 'approved', 'partially_fulfilled'))));
  end loop;
  return jsonb_build_object('store', jsonb_build_object('id', st.id, 'name', st.name), 'cover_days', v_days,
    'store_usable', v_usable, 'total_gap', v_gaps, 'scaled', v_scale < 1, 'sachets_per_carton', v_carton, 'centres', v_out,
    'has_apex', exists (select 1 from lga_apex_otp where lga_id = st.lga_id),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'at', a.created_at, 'by', (select name from profiles where id = a.created_by),
                 'sachets', (select sum((l ->> 'issued')::int) from jsonb_array_elements(a.lines) l), 'centres', jsonb_array_length(a.lines)) order by a.created_at desc), '[]')
               from (select * from lga_allocations where store_id = st.id order by created_at desc limit 5) a));
end;
$$;

-- Issue the plan: one stock issue per centre (record_issue), lots earliest expiry first from the
-- store's usable stock. A centre's approved request is linked automatically (0135). The plan is
-- saved with the need it was based on.
create or replace function lga_allocation_issue(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st facilities; v_plan jsonb; v_line record; v_lines jsonb := '[]'::jsonb; v_left int; v_take int; lot record; v_lots jsonb;
  v_res jsonb; v_id uuid; v_local text := coalesce(p ->> 'local_id', gen_random_uuid()::text); v_n int := 0; v_total int := 0; v_site jsonb;
begin
  if exists (select 1 from lga_allocations where local_id = v_local) then
    return (select jsonb_build_object('id', id, 'lines', lines) from lga_allocations where local_id = v_local);
  end if;
  v_plan := lga_allocation_plan();   -- checks the caller
  select * into st from facilities where id = (v_plan #>> '{store,id}')::uuid;
  for v_line in select * from jsonb_to_recordset(p -> 'lines') as x(facility_id uuid, sachets int) loop
    continue when coalesce(v_line.sachets, 0) <= 0;
    select x into v_site from jsonb_array_elements(v_plan -> 'centres') x where (x ->> 'facility_id')::uuid = v_line.facility_id;
    if v_site is null then raise exception 'That centre is not supplied by your store'; end if;
    v_total := v_total + v_line.sachets;
    -- Lots, earliest expiry first, from what is left in the store.
    v_lots := '[]'::jsonb; v_left := v_line.sachets;
    for lot in
      select t.lot_id, sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets))::int bal
      from stock_transactions t join product_lots l on l.id = t.lot_id
      where t.facility_id = st.id and t.status <> 'voided' and l.expiry_date >= current_date
      group by t.lot_id, l.expiry_date having sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)) > 0
      order by l.expiry_date, t.lot_id
    loop
      exit when v_left <= 0;
      v_take := least(v_left, lot.bal);
      v_lots := v_lots || jsonb_build_object('lot_id', lot.lot_id, 'quantity', v_take);
      v_left := v_left - v_take;
    end loop;
    if v_left > 0 then raise exception 'Not enough usable stock in the store for %: % sachets short', v_site ->> 'facility', v_left; end if;
    v_n := v_n + 1;
    v_res := record_issue(v_local || ':' || v_n, st.id, v_line.facility_id, current_date, v_lots, nullif(p ->> 'document_no', ''), 'web');
    v_lines := v_lines || jsonb_build_object('facility_id', v_line.facility_id, 'facility', v_site ->> 'facility', 'apex', v_site -> 'apex',
      'need', v_site -> 'need', 'usable', v_site -> 'usable_stock', 'gap', v_site -> 'gap', 'suggested', v_site -> 'suggested',
      'issued', v_line.sachets, 'transfer_id', v_res -> 'transfer_id', 'transfer_code', v_res -> 'transfer_code');
  end loop;
  if v_n = 0 then raise exception 'Enter a quantity for at least one centre'; end if;
  insert into lga_allocations (project_id, store_id, lga_id, cover_days, store_usable_before, lines, note, local_id)
  values (st.project_id, st.id, st.lga_id, (v_plan ->> 'cover_days')::int, (v_plan ->> 'store_usable')::int, v_lines, nullif(trim(p ->> 'note'), ''), v_local)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'sachets', v_total, 'lines', v_lines);
end;
$$;

-- ── Monthly LGA figures for the State (guide §2) ──────────────────────────────────────────────
create or replace function lga_monthly_overview(p_month date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_role user_role := current_user_role(); v_rows jsonb;
begin
  if not (v_role in ('state_coordinator', 'super_admin', 'project_admin', 'tpm_supervisor') or rutf_officer_level() in ('lga', 'state')) then
    raise exception 'Your role does not see the LGA monthly figures';
  end if;
  select coalesce(jsonb_agg(lga_month_figures(l.id, p_month) || jsonb_build_object('lga_id', l.id, 'lga', l.name) order by l.name), '[]') into v_rows
  from lgas l where rutf_can_see_lga(l.id) and exists (select 1 from facilities f where f.lga_id = l.id and f.facility_type = 'lga_store');
  return jsonb_build_object('month', to_char(date_trunc('month', p_month), 'YYYY-MM'), 'lgas', v_rows);
end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────
revoke execute on function rutf_is_apex(uuid), rutf_usable_stock(uuid), rutf_site_need(uuid, int), rutf_suggest(int, uuid), lga_month_figures(uuid, date),
  supply_request_calculation(facilities) from public, anon, authenticated;
revoke execute on function set_apex_otp(uuid), lga_allocation_plan(), lga_allocation_issue(jsonb), lga_monthly_overview(date) from public, anon;
grant execute on function set_apex_otp(uuid), lga_allocation_plan(), lga_allocation_issue(jsonb), lga_monthly_overview(date) to authenticated;
