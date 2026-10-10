-- RUTF Monitoring Platform — migration 0130
-- The user's answers of 10 Oct (DECISIONS R157):
--   Q22  the OTP Officer authorises: when no RUTF is recommended the officer may still give it,
--        with the reason; the officer is recorded as the authoriser (no clinician's name needed).
--   W7   MUAC screening (section I): screening events of children 6–59 months; other ages apart.
--   W8   IYCF: pregnant, breastfeeding and other women do not overlap; the total is attendance.
--   W10  Child ID in the RUTF-DTAP Beneficiary Card's format: DTAP-<state>-<LGA>-<7 digits>, e.g.
--        DTAP-KTS-MTZ-0001245 (Katsina = KTS, as on the card). New IDs only: an issued Child ID
--        never changes (the DUMMY demo children are renumbered by tools/db/renumber-demo-child-ids.js).

-- W10: the Beneficiary Card's format, per LGA (numbering per LGA, as before).
update otp_child_id_config c
set prefix = 'DTAP-' || case s.code when 'KT' then 'KTS' else s.code end || '-' || upper(l.abbr),
    include_year = false, digits = 7, next_number = 1, updated_at = now()
from lgas l join states s on s.id = l.state_id
where l.id = c.lga_id and l.abbr ~ '^[A-Za-z]{3}$';

create or replace function otp_record_visit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_child otp_children := otp_child_at_my_site(p ->> 'child_code');
  v_adm otp_admissions; v_rs otp_rule_sets; v_n int; v_ration jsonb; v_alerts text[] := '{}';
  v_wt numeric := nullif(p ->> 'weight_kg', '')::numeric; v_disp int := nullif(p ->> 'rutf_dispensed', '')::int;
  v_att boolean := coalesce((p ->> 'attended')::boolean, true); v_id uuid; v_absent int;
  v_first boolean := coalesce((p ->> 'admission_visit')::boolean, false);
  v_on date; v_cur jsonb; v_rec jsonb; v_ref otp_referrals; v_withhold text; v_status text; v_rec_status text := 'complete';
  v_next jsonb; v_due date; v_appt uuid; v_dup otp_visits; v_muac numeric;
  v_photo boolean;
begin
  if nullif(p ->> 'client_id', '') is not null then
    select id into v_id from otp_visits where client_id = (p ->> 'client_id')::uuid;
    if v_id is not null then return jsonb_build_object('visit_id', v_id, 'duplicate_submission', true); end if;
  end if;
  select * into v_adm from otp_admissions where child_id = v_child.id and status = 'active';
  if v_adm.id is null then raise exception 'This child has no active OTP admission'; end if;
  select * into v_rs from otp_rule_sets where id = v_adm.rule_set_id;
  v_photo := coalesce((v_rs.params ->> 'rutf_photo_required')::boolean, true);

  if v_first then
    if exists (select 1 from otp_visits where admission_id = v_adm.id) then
      raise exception 'The admission visit is already recorded: record a follow-up visit';
    end if;
    if not v_att then raise exception 'The admission visit is the day of admission: it cannot be an absence'; end if;
    v_n := 1;
    v_on := coalesce(nullif(p ->> 'visit_on', '')::date, v_adm.admitted_on);
    v_wt := coalesce(v_wt, v_adm.weight_kg);
    v_cur := jsonb_build_object('weight_kg', v_wt, 'muac_cm', coalesce(nullif(p ->> 'muac_cm', '')::numeric, v_adm.muac_cm),
      'oedema', coalesce(nullif(p ->> 'oedema', ''), v_adm.oedema), 'wfh_z', coalesce(nullif(p ->> 'wfh_z', '')::numeric, v_adm.wfh_z),
      'height_cm', coalesce(nullif(p ->> 'height_cm', '')::numeric, v_adm.height_cm), 'appetite_test', nullif(p ->> 'appetite_test', ''));
  else
    select coalesce(max(visit_number), 1) + 1 into v_n from otp_visits where admission_id = v_adm.id;
    v_on := coalesce(nullif(p ->> 'visit_on', '')::date, current_date);
    v_cur := jsonb_build_object('weight_kg', v_wt, 'muac_cm', nullif(p ->> 'muac_cm', '')::numeric, 'oedema', nullif(p ->> 'oedema', ''),
      'wfh_z', nullif(p ->> 'wfh_z', '')::numeric, 'height_cm', nullif(p ->> 'height_cm', '')::numeric, 'appetite_test', nullif(p ->> 'appetite_test', ''));
  end if;
  if v_on > current_date then raise exception 'The visit date cannot be in the future'; end if;
  if v_on < v_adm.admitted_on then raise exception 'The visit date is before the admission date (%)', v_adm.admitted_on; end if;
  -- One visit per child per day: protects against recording (and giving RUTF) twice.
  select * into v_dup from otp_visits where admission_id = v_adm.id and visit_on = v_on limit 1;
  if v_dup.id is not null then
    raise exception 'Visit % is already recorded for this child on %: check the child''s card before recording again', v_dup.visit_number, to_char(v_on, 'DD Mon YYYY');
  end if;
  select * into v_ref from otp_referrals where admission_id = v_adm.id and status in ('referred', 'arrived');

  if v_att then
    if v_wt is null then raise exception 'A valid weight is needed for each visit: the ration depends on it'; end if;
    if v_wt < ((v_rs.params -> 'plausible' -> 'weight_kg') ->> 0)::numeric or v_wt > ((v_rs.params -> 'plausible' -> 'weight_kg') ->> 1)::numeric then
      raise exception 'Weight of % kg is outside the plausible range: check the measurement', v_wt;
    end if;
    v_muac := nullif(v_cur ->> 'muac_cm', '')::numeric;
    if v_muac is not null and (v_muac < ((v_rs.params -> 'plausible' -> 'muac_cm') ->> 0)::numeric or v_muac > ((v_rs.params -> 'plausible' -> 'muac_cm') ->> 1)::numeric) then
      raise exception 'MUAC of % cm is outside the plausible range: check the measurement', v_muac;
    end if;
    if v_disp is null then raise exception 'Record the RUTF packets given (0 if none were given)'; end if;
    if v_disp < 0 then raise exception 'RUTF packets given cannot be negative'; end if;

    v_rec := otp_recovery_assessment(v_adm.id, v_n, v_cur);
    select coalesce(array_agg(x ->> 'message'), '{}') into v_alerts from jsonb_array_elements(v_rec -> 'flags') x;
    v_ration := otp_ration(v_wt, v_rs.id);
    if v_ration ->> 'ok' = 'false' then
      v_status := 'no_rule'; v_alerts := v_alerts || (v_ration ->> 'reason');
    else
      v_status := 'recommended';
    end if;
    if v_ref.id is not null then
      v_withhold := format('the child was referred on %s and the result is not recorded yet', to_char(v_ref.referred_on, 'DD Mon'));
    else
      select string_agg(x ->> 'message', '; ') into v_withhold from jsonb_array_elements(v_rec -> 'flags') x where (x ->> 'withhold_ration')::boolean;
    end if;
    if v_withhold is not null then
      v_status := 'withheld';
      v_alerts := v_alerts || ('No RUTF recommended: ' || v_withhold)::text;
    end if;
    -- The OTP Officer authorises it (RULEBOOK Q22, 10 Oct): RUTF may still be given, with the reason.
    if v_status in ('withheld', 'no_rule') and v_disp > 0 and coalesce(trim(p ->> 'dispense_note'), '') = '' then
      raise exception 'No RUTF is recommended at this visit (%): as the OTP Officer you may still give RUTF, with the reason recorded',
        coalesce(v_withhold, v_ration ->> 'reason');
    end if;
    if v_status = 'recommended' and v_disp <> (v_ration ->> 'packets_per_week')::int and coalesce(trim(p ->> 'dispense_note'), '') = '' then
      raise exception 'Dispensed % packets but the ration is %: record the reason', v_disp, v_ration ->> 'packets_per_week';
    end if;
    if v_disp > 0 and v_photo then v_rec_status := 'awaiting_photo'; end if;
  else
    select count(*) into v_absent from otp_visits
    where admission_id = v_adm.id and not attended
      and visit_number > coalesce((select max(visit_number) from otp_visits where admission_id = v_adm.id and attended), 1);
    if v_absent + 1 >= (v_rs.params ->> 'defaulter_consecutive_absences')::int then
      v_alerts := v_alerts || format('%s consecutive absences: the child meets the card''s defaulter definition; record the outcome', v_absent + 1);
    end if;
    v_disp := null;
    v_rec := jsonb_build_object('basis', 'absent');
  end if;

  insert into otp_visits (admission_id, visit_number, visit_kind, visit_on, attended, weight_kg, height_cm, muac_cm, oedema, wfh_z,
    diarrhoea_days, vomiting_days, fever_days, cough_days, appetite_test, temperature_c, respiratory_rate, dehydrated, pallor,
    superficial_infection, action_required, action_details, ration_band_min_kg, rutf_prescribed, rutf_dispensed, dispense_note,
    ration_status, ration_withheld_reason, dispense_authorised_by, recovery, record_status,
    alerts, examiner_initials, rule_set_id, recorded_by, client_id)
  values (v_adm.id, v_n, case when v_first then 'admission' else 'follow_up' end, v_on, v_att,
    case when v_att then v_wt end, nullif(v_cur ->> 'height_cm', '')::numeric, nullif(v_cur ->> 'muac_cm', '')::numeric,
    nullif(v_cur ->> 'oedema', ''), nullif(v_cur ->> 'wfh_z', '')::numeric,
    nullif(p ->> 'diarrhoea_days', '')::int, nullif(p ->> 'vomiting_days', '')::int, nullif(p ->> 'fever_days', '')::int, nullif(p ->> 'cough_days', '')::int,
    nullif(p ->> 'appetite_test', ''), nullif(p ->> 'temperature_c', '')::numeric, nullif(p ->> 'respiratory_rate', '')::int,
    (p ->> 'dehydrated')::boolean, (p ->> 'pallor')::boolean, (p ->> 'superficial_infection')::boolean,
    (p ->> 'action_required')::boolean, nullif(p ->> 'action_details', ''),
    case when v_status = 'recommended' then nullif(v_ration ->> 'band_min_kg', '')::numeric end,
    case when v_status = 'recommended' then nullif(v_ration ->> 'packets_per_week', '')::int end,
    v_disp, nullif(trim(p ->> 'dispense_note'), ''),
    v_status, v_withhold,
    case when v_status in ('withheld', 'no_rule') and v_disp > 0
         then coalesce(nullif(trim(p ->> 'dispense_authorised_by'), ''), (select name from profiles where id = auth.uid()) || ' (OTP Officer)') end,
    v_rec - 'trajectory', v_rec_status,
    v_alerts, nullif(p ->> 'examiner_initials', ''), v_rs.id, auth.uid(), nullif(p ->> 'client_id', '')::uuid)
  returning id into v_id;

  -- Close the appointment this visit answers, then schedule the next one if the rules allow it.
  update otp_appointments set status = case when v_att then 'attended' else 'missed' end, visit_id = v_id, closed_at = now()
  where admission_id = v_adm.id and status = 'scheduled';
  v_next := otp_next_step(v_adm.id);
  if (v_next ->> 'schedule')::boolean then
    v_due := v_on + coalesce((v_rs.params ->> 'visit_interval_days')::int, 7);
    insert into otp_appointments (admission_id, facility_id, visit_number, due_on, created_by)
    values (v_adm.id, v_adm.facility_id, v_n + 1, v_due, auth.uid()) returning id into v_appt;
  end if;

  return jsonb_build_object('visit_id', v_id, 'visit_number', v_n, 'visit_kind', case when v_first then 'admission' else 'follow_up' end,
    'ration', v_ration, 'ration_status', v_status, 'withheld_reason', v_withhold, 'rutf_given', v_disp,
    'recovery', v_rec, 'alerts', to_jsonb(v_alerts), 'record_status', v_rec_status,
    'photo_folder', case when v_rec_status = 'awaiting_photo' then v_adm.facility_id::text || '/' || v_id::text || '/' end,
    'next_step', v_next, 'next_visit_due', v_due,
    'due_medications', otp_due_medications_for(v_adm.id), 'discharge_check', otp_discharge_check(v_adm.id));
end;
$$;

create or replace function otp_weekly_report_compute(p_facility_id uuid, p_week_start date)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_base jsonb := otp_weekly_report_compute_base(p_facility_id, p_week_start);
  ws date := (v_base -> 'sections' -> 'A' ->> 'week_start')::date;
  we date := ws + 6;
  l jsonb; v_ref jsonb; v_appt jsonb; v_missing int; v_issues jsonb := v_base -> 'issues'; i jsonb; v_outside int;
begin
  select jsonb_build_object(
    'visits', jsonb_build_object(
      'admission', count(*) filter (where v.visit_kind = 'admission'),
      'second', count(*) filter (where v.visit_kind = 'follow_up' and v.attended and v.visit_number = 2),
      'third', count(*) filter (where v.visit_kind = 'follow_up' and v.attended and v.visit_number = 3),
      'fourth_or_later', count(*) filter (where v.visit_kind = 'follow_up' and v.attended and v.visit_number >= 4),
      'absent', count(*) filter (where not v.attended),
      'attended', count(*) filter (where v.attended)),
    'rutf', jsonb_build_object(
      'recommended', coalesce(sum(v.rutf_prescribed), 0), 'given', coalesce(sum(v.rutf_dispensed), 0),
      'visits_differing', count(*) filter (where v.ration_status = 'recommended' and v.rutf_dispensed is distinct from v.rutf_prescribed),
      'visits_withheld', count(*) filter (where v.ration_status = 'withheld'),
      'given_while_withheld', count(*) filter (where v.ration_status in ('withheld', 'no_rule') and v.rutf_dispensed > 0)),
    'recovery', jsonb_build_object(
      'improved', count(*) filter (where v.recovery ->> 'vs_previous' = 'improved'),
      'unchanged', count(*) filter (where v.recovery ->> 'vs_previous' = 'unchanged'),
      'deteriorated', count(*) filter (where v.recovery ->> 'vs_previous' = 'deteriorated'),
      'note', 'Direction of change since the previous visit (RULEBOOK Q14)'),
    'awaiting_photo', count(*) filter (where v.record_status = 'awaiting_photo'))
  into l
  from otp_visits v join otp_admissions a on a.id = v.admission_id
  where a.facility_id = p_facility_id and v.visit_on between ws and we;

  select jsonb_build_object(
    'made', count(*) filter (where r.referred_on between ws and we),
    'open_at_week_end', count(*) filter (where r.referred_on <= we and (r.status in ('referred', 'arrived') or r.status_changed_at::date > we)))
  into v_ref from otp_referrals r join otp_admissions a on a.id = r.admission_id where a.facility_id = p_facility_id;

  select jsonb_build_object(
    'due_in_week', count(*) filter (where ap.due_on between ws and we and ap.status <> 'rescheduled'),
    'attended', count(*) filter (where ap.due_on between ws and we and ap.status = 'attended'),
    'missed', count(*) filter (where ap.due_on between ws and we and ap.status = 'missed'),
    'overdue_at_week_end', count(*) filter (where ap.due_on <= we and ap.created_at::date <= we and (ap.closed_at is null or ap.closed_at::date > we)))
  into v_appt from otp_appointments ap join otp_admissions a on a.id = ap.admission_id where a.facility_id = p_facility_id;

  select count(*) into v_missing from otp_admissions a
  where a.facility_id = p_facility_id and a.admitted_on between ws and we and a.admission_type <> 'transfer_from_otp'
    and not exists (select 1 from otp_visits v where v.admission_id = a.id and v.visit_kind = 'admission');

  l := l || jsonb_build_object('referrals', v_ref, 'appointments', v_appt, 'admission_visit_missing', v_missing);

  if v_missing > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'admission_visit_missing', 'severity', 'warning', 'section', 'L',
      'message', format('%s child(ren) admitted this week have no admission visit (RUTF given at admission) recorded', v_missing));
  end if;
  if (l ->> 'awaiting_photo')::int > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'visit_awaiting_photo', 'severity', 'warning', 'section', 'L',
      'message', format('%s visit(s) with RUTF given have no photo of the RUTF yet', l ->> 'awaiting_photo'));
  end if;
  if (v_appt ->> 'overdue_at_week_end')::int > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'visits_overdue', 'severity', 'warning', 'section', 'L',
      'message', format('%s scheduled visit(s) were overdue at the end of the week: follow up the children', v_appt ->> 'overdue_at_week_end'));
  end if;
  if (l -> 'rutf' ->> 'given_while_withheld')::int > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'rutf_given_while_withheld', 'severity', 'info', 'section', 'L',
      'message', format('RUTF was given at %s visit(s) where none was recommended, each with the OTP Officer''s reason recorded', l -> 'rutf' ->> 'given_while_withheld'));
  end if;

  -- I. MUAC screening (W7, 10 Oct): screening events of children 6–59 months, by the colour band
  -- the engine computed and by sex; screenings of other ages are counted apart. A child screened
  -- twice counts twice: children who are not admitted have no Child ID, so they cannot be counted once.
  select jsonb_object_agg(band, jsonb_build_object('M', m, 'F', fe, 'total', m + fe)) into i from (
    select band, count(*) filter (where sc.sex = 'M') m, count(*) filter (where sc.sex = 'F') fe
    from unnest(array['green', 'yellow', 'red', 'boundary', 'not_measured']) band
    left join otp_screenings sc on sc.facility_id = p_facility_id and sc.screened_on between ws and we and sc.age_months between 6 and 59
      and coalesce(sc.result ->> 'muac_band', 'not_measured') = band
    group by band) y;
  select count(*) into v_outside from otp_screenings
  where facility_id = p_facility_id and screened_on between ws and we and (age_months is null or age_months not between 6 and 59);
  select i || jsonb_build_object('total', jsonb_build_object('M', count(*) filter (where sex = 'M'), 'F', count(*) filter (where sex = 'F'), 'total', count(*)),
      'outside_6_59', v_outside,
      'counting', 'screening events of children 6–59 months (W7); a child screened twice counts twice') into i
  from otp_screenings where facility_id = p_facility_id and screened_on between ws and we and age_months between 6 and 59;

  return jsonb_build_object('sections', (v_base -> 'sections') || jsonb_build_object('I', i, 'L', l), 'issues', v_issues);
end;
$$;

create or replace function otp_record_iycf_session(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_id uuid; v_groups int; v_any boolean;
begin
  if nullif(p ->> 'client_id', '') is not null then
    select id into v_id from iycf_sessions where client_id = (p ->> 'client_id')::uuid; if v_id is not null then return v_id; end if;
  end if;
  if (p ->> 'held_on')::date > current_date then raise exception 'The date cannot be in the future'; end if;
  -- W8 (10 Oct): pregnant, breastfeeding and other women do not overlap, and the total is the
  -- attendance (a woman attending twice counts twice). With the groups, the total is their sum.
  v_groups := coalesce(nullif(p ->> 'pregnant_women', '')::int, 0) + coalesce(nullif(p ->> 'breastfeeding_women', '')::int, 0) + coalesce(nullif(p ->> 'other_women', '')::int, 0);
  v_any := nullif(p ->> 'pregnant_women', '') is not null or nullif(p ->> 'breastfeeding_women', '') is not null or nullif(p ->> 'other_women', '') is not null;
  if v_any and nullif(p ->> 'total_participants', '') is not null and (p ->> 'total_participants')::int <> v_groups then
    raise exception 'The total attendance (%) must equal pregnant + breastfeeding + other women (%)', p ->> 'total_participants', v_groups;
  end if;
  if not v_any and nullif(p ->> 'total_participants', '') is null then raise exception 'Record the attendance'; end if;
  insert into iycf_sessions (project_id, facility_id, held_on, kind, topic, pregnant_women, breastfeeding_women, other_women, total_participants, recorded_by, client_id)
  values (v_site.project_id, v_site.id, (p ->> 'held_on')::date, p ->> 'kind', nullif(trim(p ->> 'topic'), ''),
          nullif(p ->> 'pregnant_women', '')::int, nullif(p ->> 'breastfeeding_women', '')::int, nullif(p ->> 'other_women', '')::int,
          case when v_any then v_groups else nullif(p ->> 'total_participants', '')::int end, auth.uid(), nullif(p ->> 'client_id', '')::uuid)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function otp_weekly_report_compute(uuid, date) from public, anon, authenticated;
revoke execute on function otp_record_visit(jsonb), otp_record_iycf_session(jsonb) from public, anon;
grant execute on function otp_record_visit(jsonb), otp_record_iycf_session(jsonb) to authenticated;
