-- RUTF Monitoring Platform — migration 0131
-- W3 answered (10 Oct): the report's categories were not complete. Added, by sex (DECISIONS R159):
--   C. admission categories — new case, relapse, readmission, returned defaulter, from
--      stabilisation care, others — each admission counted once, adding up to the week's admissions;
--   E. referrals made in the week — to stabilisation care (G4) and others (a doctor, another
--      facility); not exits: the child stays under treatment until an outcome is recorded.

create or replace function otp_weekly_report_compute(p_facility_id uuid, p_week_start date)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_base jsonb := otp_weekly_report_compute_base(p_facility_id, p_week_start);
  ws date := (v_base -> 'sections' -> 'A' ->> 'week_start')::date;
  we date := ws + 6;
  l jsonb; v_ref jsonb; v_appt jsonb; v_missing int; v_issues jsonb := v_base -> 'issues'; i jsonb; v_outside int; v_cat jsonb; v_refs jsonb; v_sections jsonb;
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

  -- W3 (10 Oct): the admission categories, by sex, each admission counted once in the first that
  -- applies: relapse, readmission, returned defaulter, from stabilisation care, new case, others.
  -- They add up to the admissions of the week (transfers in are in section D).
  with adm as (
    select ch.sex, case when a.relapse then 'relapse' when a.readmission then 'readmission'
                        when a.admission_type = 'returned_defaulter' then 'returned_defaulter'
                        when a.admission_type = 'from_stabilisation' then 'from_stabilisation'
                        when a.admission_type = 'new_case' then 'new_case' else 'others' end as cat
    from otp_admissions a join otp_children ch on ch.id = a.child_id
    where a.facility_id = p_facility_id and a.admitted_on between ws and we and a.admission_type <> 'transfer_from_otp'
  )
  select jsonb_object_agg(k, jsonb_build_object('M', m, 'F', fe, 'total', m + fe)) into v_cat from (
    select k, count(*) filter (where adm.sex = 'M') m, count(*) filter (where adm.sex = 'F') fe
    from unnest(array['new_case', 'relapse', 'readmission', 'returned_defaulter', 'from_stabilisation', 'others']) k
    left join adm on adm.cat = k group by k) y;

  -- W3: referrals made in the week, by sex: to stabilisation care (a G4 rule prompted it) and others
  -- (a doctor or another facility). A referral is not an exit: the child stays under treatment
  -- until an outcome is recorded.
  with r as (
    select ch.sex, case when exists (select 1 from unnest(rf.triggers) t where t like 'G4%') then 'to_stabilisation' else 'others' end as k
    from otp_referrals rf join otp_admissions a on a.id = rf.admission_id join otp_children ch on ch.id = a.child_id
    where a.facility_id = p_facility_id and rf.referred_on between ws and we
  )
  select jsonb_object_agg(k, jsonb_build_object('M', m, 'F', fe, 'total', m + fe)) into v_refs from (
    select u.kk as k, count(*) filter (where r.sex = 'M') m, count(*) filter (where r.sex = 'F') fe
    from unnest(array['to_stabilisation', 'others']) u(kk) left join r on r.k = u.kk group by u.kk) y;

  v_sections := (v_base -> 'sections') || jsonb_build_object('I', i, 'L', l);
  v_sections := jsonb_set(v_sections, '{C,SAM,categories}', v_cat);
  v_sections := jsonb_set(v_sections, '{E,SAM,referred}', v_refs);
  return jsonb_build_object('sections', v_sections, 'issues', v_issues);
end;
$$;

revoke execute on function otp_weekly_report_compute(uuid, date) from public, anon, authenticated;
