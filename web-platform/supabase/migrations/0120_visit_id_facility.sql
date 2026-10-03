-- RUTF Monitoring Platform — migration 0120
-- Visit ID in the same administrative order as Finding and transfer IDs (DECISIONS R77), for the
-- visited facility, with a VIS prefix so a visit, a transfer and a Finding never share an ID:
--   VIS-STATE-LGA-WARD-LEVEL-YYNNN, e.g. VIS-KT-DAU-MAJ-OTP-26001
-- Sequence per facility state-LGA-ward-level and year of the visit. The 306 DUMMY visits are
-- re-numbered in visit order (nothing quotes a visit ID; visits have no audit trigger).

create table if not exists visit_id_counters (
  prefix text not null,
  year smallint not null,
  last_number int not null,
  primary key (prefix, year)
);
alter table visit_id_counters enable row level security;  -- no policies: only the function below uses it

create or replace function next_visit_code(p_facility_id uuid, p_date date)
returns text language plpgsql security definer set search_path = public as $$
declare
  -- transfer_code_prefix (0119) gives "TRF-KT-DAU-MAJ-OTP"; the location part is the same.
  v_prefix text := 'VIS-' || substr(coalesce(transfer_code_prefix(p_facility_id), 'TRF-GEN-GEN-GEN-GEN'), 5);
  v_year text := to_char(coalesce(p_date, current_date), 'YY');
  v_seq int;
begin
  insert into visit_id_counters (prefix, year, last_number) values (v_prefix, v_year::smallint, 1)
  on conflict (prefix, year) do update set last_number = visit_id_counters.last_number + 1
  returning last_number into v_seq;
  return v_prefix || '-' || v_year || lpad(v_seq::text, 3, '0');
end;
$$;
revoke execute on function next_visit_code(uuid, date) from public, anon, authenticated;

-- record_visit: the live definition with the code built by next_visit_code() (was
-- 'VIS-' || LGA || '-' || YY || '-' || 6-digit global sequence).
CREATE OR REPLACE FUNCTION public.record_visit(p_local_id text, p_visit_type visit_type, p_facility_id uuid, p_visit_date date, p_lat numeric, p_lng numeric, p_gps_accuracy_m numeric, p_lines jsonb, p_checklist jsonb, p_period_start date DEFAULT NULL::date, p_period_end date DEFAULT NULL::date, p_device_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  values (next_visit_code(p_facility_id, p_visit_date),
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
$function$;

-- ── Re-number the DUMMY visits ──────────────────────────────────────────────────────────────────
with numbered as (
  select v.id,
         'VIS-' || substr(transfer_code_prefix(v.facility_id), 5) || '-' || to_char(v.visit_date, 'YY') ||
           lpad(row_number() over (partition by transfer_code_prefix(v.facility_id), to_char(v.visit_date, 'YY')
                                   order by v.visit_date, v.created_at, v.id)::text, 3, '0') as new_code
  from monitoring_visits v
  join facilities f on f.id = v.facility_id and f.dummy_fields is not null
)
update monitoring_visits v set code = n.new_code from numbered n where n.id = v.id;

insert into visit_id_counters (prefix, year, last_number)
select regexp_replace(code, '-\d{5,}$', ''), substring(code from '-(\d{2})\d{3,}$')::smallint,
       max(substring(code from '-\d{2}(\d{3,})$')::int)
from monitoring_visits
where code ~ '^VIS-[A-Z]{2,3}-[A-Z]{3}-[A-Z]{3}-[A-Z]{3}-\d{5,}$'
group by 1, 2
on conflict (prefix, year) do update set last_number = greatest(visit_id_counters.last_number, excluded.last_number);
