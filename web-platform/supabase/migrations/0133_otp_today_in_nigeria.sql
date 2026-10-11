-- RUTF Monitoring Platform — migration 0133
-- "Today" in Nigerian time (DECISIONS R163). The database runs in UTC, one hour behind
-- Africa/Lagos, so between midnight and 1 a.m. a visit recorded "today" was dated the day before —
-- found on the phone test of 11 Oct: a visit just after midnight was refused as a second visit on
-- the 10th. The OTP functions officers use for visits, appointments and referrals now take today's
-- date in Africa/Lagos; the app also sends the phone's date with each visit.

create or replace function otp_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Africa/Lagos')::date;
$$;
grant execute on function otp_today() to authenticated;

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
    v_on := coalesce(nullif(p ->> 'visit_on', '')::date, otp_today());
    v_cur := jsonb_build_object('weight_kg', v_wt, 'muac_cm', nullif(p ->> 'muac_cm', '')::numeric, 'oedema', nullif(p ->> 'oedema', ''),
      'wfh_z', nullif(p ->> 'wfh_z', '')::numeric, 'height_cm', nullif(p ->> 'height_cm', '')::numeric, 'appetite_test', nullif(p ->> 'appetite_test', ''));
  end if;
  if v_on > otp_today() then raise exception 'The visit date cannot be in the future'; end if;
  if v_on < v_adm.admitted_on then raise exception 'The visit date is before the admission date (%)', v_adm.admitted_on; end if;
  v_cur := v_cur || jsonb_build_object('visit_on', v_on);
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

create or replace function otp_reschedule_visit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_child otp_children := otp_child_at_my_site(p ->> 'child_code'); v_adm otp_admissions; v_old otp_appointments; v_due date := nullif(p ->> 'due_on', '')::date; v_new otp_appointments; v_n int;
begin
  select * into v_adm from otp_admissions where child_id = v_child.id and status = 'active';
  if v_adm.id is null then raise exception 'This child has no active OTP admission'; end if;
  if v_due is null or v_due < otp_today() then raise exception 'Choose a date from today onwards'; end if;
  if coalesce(trim(p ->> 'reason'), '') = '' then raise exception 'Give the reason for the change'; end if;
  if exists (select 1 from otp_referrals where admission_id = v_adm.id and status in ('referred', 'arrived')) then
    raise exception 'Record the result of the referral first';
  end if;
  select * into v_old from otp_appointments where admission_id = v_adm.id and status = 'scheduled' for update;
  if v_old.id is not null then
    update otp_appointments set status = 'rescheduled', reason = trim(p ->> 'reason'), closed_at = now() where id = v_old.id;
    v_n := v_old.visit_number;
  else
    if not exists (select 1 from otp_visits where admission_id = v_adm.id) and v_adm.admission_type <> 'transfer_from_otp' then
      raise exception 'Record the admission visit first';
    end if;
    select coalesce(max(visit_number), 1) + 1 into v_n from otp_visits where admission_id = v_adm.id;
  end if;
  insert into otp_appointments (admission_id, facility_id, visit_number, due_on, reason, created_by)
  values (v_adm.id, v_adm.facility_id, v_n, v_due, trim(p ->> 'reason'), auth.uid()) returning * into v_new;
  return jsonb_build_object('appointment_id', v_new.id, 'visit_number', v_new.visit_number, 'due_on', v_new.due_on, 'rescheduled_from', v_old.due_on);
end;
$$;

create or replace function otp_refer_child(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_child otp_children := otp_child_at_my_site(p ->> 'child_code'); v_adm otp_admissions; v_ref otp_referrals; v_id uuid; v_dest uuid := nullif(p ->> 'destination_facility_id', '')::uuid;
        v_on date := coalesce(nullif(p ->> 'referred_on', '')::date, otp_today());
begin
  if nullif(p ->> 'client_id', '') is not null then
    select id into v_id from otp_referrals where client_id = (p ->> 'client_id')::uuid;
    if v_id is not null then return jsonb_build_object('referral_id', v_id, 'duplicate_submission', true); end if;
  end if;
  select * into v_adm from otp_admissions where child_id = v_child.id and status = 'active';
  if v_adm.id is null then raise exception 'This child has no active OTP admission'; end if;
  select * into v_ref from otp_referrals where admission_id = v_adm.id and status in ('referred', 'arrived');
  if v_ref.id is not null then raise exception 'This child already has an open referral (since %): record its result first', v_ref.referred_on; end if;
  if coalesce(trim(p ->> 'reason'), '') = '' then raise exception 'Give the reason for the referral'; end if;
  if v_dest is null and coalesce(trim(p ->> 'destination_name'), '') = '' then raise exception 'Say where the child is referred to'; end if;
  if v_dest is not null and not exists (select 1 from facilities where id = v_dest and is_active) then raise exception 'Unknown receiving facility'; end if;
  if v_on > otp_today() or v_on < v_adm.admitted_on then raise exception 'The referral date must be between the admission and today'; end if;
  if nullif(p ->> 'visit_id', '') is not null and not exists (select 1 from otp_visits where id = (p ->> 'visit_id')::uuid and admission_id = v_adm.id) then
    raise exception 'The visit is not part of this admission';
  end if;
  insert into otp_referrals (admission_id, facility_id, visit_id, referred_on, reason, triggers, destination_facility_id, destination_name, created_by, client_id)
  values (v_adm.id, v_adm.facility_id, nullif(p ->> 'visit_id', '')::uuid, v_on, trim(p ->> 'reason'),
          coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'triggers', '[]'::jsonb)) x), '{}'),
          v_dest, nullif(trim(p ->> 'destination_name'), ''), auth.uid(), nullif(p ->> 'client_id', '')::uuid)
  returning id into v_id;
  update otp_appointments set status = 'cancelled', reason = 'Referred: ' || trim(p ->> 'reason'), closed_at = now()
  where admission_id = v_adm.id and status = 'scheduled';
  insert into otp_access_log (actor, child_id, action) values (auth.uid(), v_child.id, 'refer');
  return jsonb_build_object('referral_id', v_id, 'status', 'referred', 'next_step', otp_next_step(v_adm.id));
end;
$$;

create or replace function otp_update_referral(p_referral_id uuid, p_status text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_ref otp_referrals; v_adm otp_admissions; v_n int;
begin
  select * into v_ref from otp_referrals where id = p_referral_id for update;
  if v_ref.id is null or v_ref.facility_id <> v_site.id then raise exception 'Referral not found at your OTP site'; end if;
  select * into v_adm from otp_admissions where id = v_ref.admission_id;
  if (select facility_id from otp_children where id = v_adm.child_id) <> v_site.id then raise exception 'The child is no longer at your OTP site'; end if;
  if v_ref.status not in ('referred', 'arrived') then raise exception 'This referral is already %', v_ref.status; end if;
  if p_status not in ('arrived', 'returned', 'refused', 'closed') then raise exception 'Status must be arrived, returned, refused or closed'; end if;
  if p_status <> 'arrived' and coalesce(trim(p_note), '') = '' then raise exception 'Record what happened (the receiving clinician''s advice, or why it was refused or closed)'; end if;
  update otp_referrals set status = p_status, status_note = nullif(trim(p_note), ''), status_changed_at = now(), status_changed_by = auth.uid() where id = v_ref.id;
  if p_status in ('returned', 'refused') and v_adm.status = 'active'
     and not exists (select 1 from otp_appointments where admission_id = v_adm.id and status = 'scheduled') then
    select coalesce(max(visit_number), 1) + 1 into v_n from otp_visits where admission_id = v_adm.id;
    insert into otp_appointments (admission_id, facility_id, visit_number, due_on, reason, created_by)
    values (v_adm.id, v_adm.facility_id, v_n, otp_today(), 'Back from referral (' || p_status || ')', auth.uid());
  end if;
  return jsonb_build_object('referral_id', v_ref.id, 'status', p_status, 'next_step', otp_next_step(v_adm.id));
end;
$$;

create or replace function otp_my_visits()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_out jsonb;
begin
  insert into otp_access_log (actor, child_id, action) values (auth.uid(), null, 'visits_list');
  with act as (
    select a.id, a.admission_type, a.admitted_on, c.child_code from otp_admissions a join otp_children c on c.id = a.child_id
    where a.facility_id = v_site.id and a.status = 'active' and c.facility_id = v_site.id
  )
  select jsonb_build_object(
    'today', otp_today(), 'site', v_site.name,
    'due', coalesce((select jsonb_agg(jsonb_build_object('child_code', act.child_code, 'visit_number', ap.visit_number, 'due_on', ap.due_on,
               'state', case when ap.due_on < otp_today() then 'overdue' when ap.due_on = otp_today() then 'today' else 'upcoming' end,
               'days_overdue', greatest(otp_today() - ap.due_on, 0), 'rescheduled', ap.reason is not null) order by ap.due_on, act.child_code)
             from otp_appointments ap join act on act.id = ap.admission_id where ap.status = 'scheduled'), '[]'::jsonb),
    'awaiting_photo', coalesce((select jsonb_agg(jsonb_build_object('child_code', act.child_code, 'visit_id', v.id, 'visit_number', v.visit_number,
               'visit_on', v.visit_on, 'rutf_given', v.rutf_dispensed, 'photo_folder', v_site.id::text || '/' || v.id::text || '/') order by v.visit_on)
             from otp_visits v join act on act.id = v.admission_id where v.record_status = 'awaiting_photo'), '[]'::jsonb),
    'admission_visit_missing', coalesce((select jsonb_agg(jsonb_build_object('child_code', act.child_code, 'admitted_on', act.admitted_on) order by act.admitted_on)
             from act where act.admission_type <> 'transfer_from_otp' and not exists (select 1 from otp_visits v where v.admission_id = act.id)), '[]'::jsonb),
    'referrals', coalesce((select jsonb_agg(jsonb_build_object('child_code', act.child_code, 'referral_id', r.id, 'referred_on', r.referred_on, 'status', r.status,
               'destination', coalesce((select name from facilities where id = r.destination_facility_id), r.destination_name)) order by r.referred_on)
             from otp_referrals r join act on act.id = r.admission_id where r.status in ('referred', 'arrived')), '[]'::jsonb),
    'needs_decision', coalesce((select jsonb_agg(jsonb_build_object('child_code', act.child_code, 'step', ns ->> 'step', 'message', ns ->> 'message') order by act.child_code)
             from act cross join lateral otp_next_step(act.id) ns
             where exists (select 1 from otp_visits v where v.admission_id = act.id)
               and not exists (select 1 from otp_appointments ap where ap.admission_id = act.id and ap.status = 'scheduled')
               and ns ->> 'step' in ('refer', 'discharge_review', 'record_outcome')), '[]'::jsonb),
    'note', 'Child IDs only. Enter a Child ID to open the child''s card.')
  into v_out;
  return v_out || jsonb_build_object('counts', jsonb_build_object(
    'overdue', (select count(*) from jsonb_array_elements(v_out -> 'due') x where x ->> 'state' = 'overdue'),
    'today', (select count(*) from jsonb_array_elements(v_out -> 'due') x where x ->> 'state' = 'today'),
    'upcoming', (select count(*) from jsonb_array_elements(v_out -> 'due') x where x ->> 'state' = 'upcoming'),
    'awaiting_photo', jsonb_array_length(v_out -> 'awaiting_photo'), 'admission_visit_missing', jsonb_array_length(v_out -> 'admission_visit_missing'),
    'referrals', jsonb_array_length(v_out -> 'referrals'), 'needs_decision', jsonb_array_length(v_out -> 'needs_decision')));
end;
$$;

revoke execute on function otp_record_visit(jsonb), otp_reschedule_visit(jsonb), otp_refer_child(jsonb),
  otp_update_referral(uuid, text, text), otp_my_visits() from public, anon;
grant execute on function otp_record_visit(jsonb), otp_reschedule_visit(jsonb), otp_refer_child(jsonb),
  otp_update_referral(uuid, text, text), otp_my_visits() to authenticated;
