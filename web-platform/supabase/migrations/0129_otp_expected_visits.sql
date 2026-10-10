-- RUTF Monitoring Platform — migration 0129
-- The programme's answer to RULEBOOK Q23 (10 Oct): 3 OTP visits are expected; a 4th is scheduled
-- only when the child has not recovered well by the 3rd (the discharge criteria are not met);
-- beyond the 4th the app suggests a referral to see a doctor (DECISIONS R155). Visits are counted
-- from the admission visit (visit 1). RUTF stays recommended at an exceptional or later visit
-- (a suggestion, not a stop); the booklet's G4 rules still stop it.
-- Also: the OTP sites an officer may transfer a child to (for the app's transfer screen).

update otp_rule_sets set params = params || jsonb_build_object(
    'expected_visits', 3,              -- programme decision, 10 Oct (Q23)
    'max_visits', 4,                   -- a 4th only when recovery is not good; beyond: refer to a doctor
    'open_questions', (params -> 'open_questions') - 'Q23')
where version = '2026-10-draft';

create or replace function otp_recovery_assessment(p_admission_id uuid, p_visit_number int, p_current jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_adm otp_admissions; v_rs otp_rule_sets; v_prev otp_visits;
  m record; v_measures jsonb := '[]'::jsonb; v_flags jsonb := '[]'::jsonb;
  cur numeric; prv numeric; bas numeric; d_prev text; d_base text;
  v_prev_dirs text[] := '{}'; v_base_dirs text[] := '{}'; v_has_prev boolean;
  v_wt numeric := nullif(p_current ->> 'weight_kg', '')::numeric;
  v_exp int; v_max int;
begin
  select * into v_adm from otp_admissions where id = p_admission_id;
  select * into v_rs from otp_rule_sets where id = v_adm.rule_set_id;
  select * into v_prev from otp_visits where admission_id = p_admission_id and attended and visit_number < p_visit_number
  order by visit_number desc limit 1;
  -- With no earlier visit, the previous measurements are the admission's (except at the admission visit itself).
  v_has_prev := p_visit_number > 1;

  for m in select * from (values ('weight_kg', 'Weight', 'kg', 1), ('muac_cm', 'MUAC', 'cm', 1),
                                 ('wfh_z', 'Weight-for-height', 'Z', 1), ('oedema', 'Oedema', 'grade', -1)) t(key, label, unit, good) loop
    if m.key = 'oedema' then
      cur := otp_oedema_grade(p_current ->> 'oedema');
      prv := otp_oedema_grade(coalesce(v_prev.oedema, v_adm.oedema));
      bas := otp_oedema_grade(v_adm.oedema);
    else
      cur := nullif(p_current ->> m.key, '')::numeric;
      bas := case m.key when 'weight_kg' then v_adm.weight_kg when 'muac_cm' then v_adm.muac_cm else v_adm.wfh_z end;
      prv := case when v_prev.id is null then bas
                  else case m.key when 'weight_kg' then v_prev.weight_kg when 'muac_cm' then v_prev.muac_cm else v_prev.wfh_z end end;
    end if;
    if cur is null then continue; end if;
    d_prev := case when v_has_prev then otp_direction(cur, prv, m.good) end;
    d_base := case when v_has_prev then otp_direction(cur, bas, m.good) end;
    if d_prev is not null then v_prev_dirs := v_prev_dirs || d_prev; end if;
    if d_base is not null then v_base_dirs := v_base_dirs || d_base; end if;
    v_measures := v_measures || jsonb_build_object('key', m.key, 'label', m.label, 'unit', m.unit,
      'baseline', case when m.key = 'oedema' then to_jsonb(v_adm.oedema) else to_jsonb(bas) end,
      'previous', case when not v_has_prev then null when m.key = 'oedema' then to_jsonb(coalesce(v_prev.oedema, v_adm.oedema)) else to_jsonb(prv) end,
      'current', case when m.key = 'oedema' then to_jsonb(p_current ->> 'oedema') else to_jsonb(cur) end,
      'change_from_previous', case when m.key <> 'oedema' and v_has_prev and prv is not null then round(cur - prv, 2) end,
      'change_from_baseline', case when m.key <> 'oedema' and v_has_prev and bas is not null then round(cur - bas, 2) end,
      'vs_previous', d_prev, 'vs_baseline', d_base);
  end loop;

  -- Rule-based flags. withhold_ration = the booklet sends the child to stabilisation care (G4), so
  -- no OTP ration is recommended until a clinician has seen the child.
  if v_wt is not null and v_adm.weight_kg is not null and v_wt < v_adm.weight_kg and p_visit_number > 1 then
    v_flags := v_flags || jsonb_build_object('code', 'C2_weight_below_admission', 'action', 'home_visit_or_refer', 'withhold_ration', false, 'source', 'Card C2 footnote',
      'message', 'Weight below admission weight: arrange a home visit or refer to inpatient care (card footnote)');
  end if;
  if p_visit_number = (v_rs.params ->> 'no_weight_change_visit')::int and v_wt is not null and v_adm.weight_kg is not null and v_wt = v_adm.weight_kg then
    v_flags := v_flags || jsonb_build_object('code', 'C2_no_weight_change', 'action', 'home_visit_or_refer', 'withhold_ration', false, 'source', 'Card C2 footnote (Q14)',
      'message', 'No change in weight by the 4th visit: arrange a home visit or refer to inpatient care (card footnote; "no change" awaits Q14)');
  end if;
  if p_current ->> 'oedema' = '+++' then
    v_flags := v_flags || jsonb_build_object('code', 'G4_oedema_severe', 'action', 'refer', 'withhold_ration', true, 'source', 'Booklet G4',
      'message', 'Severe oedema (+++): refer to stabilisation care (G4)');
  end if;
  if p_current ->> 'appetite_test' in ('poor', 'refused') then
    v_flags := v_flags || jsonb_build_object('code', 'G4_appetite', 'action', 'refer', 'withhold_ration', true, 'source', 'Booklet G4',
      'message', 'Poor or refused appetite test: lack of appetite for RUTF sends the child to stabilisation care (G4)');
  end if;
  -- The programme's decision (10 Oct, RULEBOOK Q23): 3 visits expected; a 4th only when the child
  -- has not recovered well; beyond that, suggest a referral to a doctor. RUTF stays recommended:
  -- the referral is a suggestion, not a stop (the G4 rules above still stop it).
  v_exp := nullif(v_rs.params ->> 'expected_visits', '')::int;
  v_max := nullif(v_rs.params ->> 'max_visits', '')::int;
  if v_exp is not null and p_visit_number > v_exp and (v_max is null or p_visit_number <= v_max) then
    v_flags := v_flags || jsonb_build_object('code', 'exceptional_visit', 'action', 'clinical_attention', 'withhold_ration', false, 'source', 'Programme decision (Q23)',
      'message', format('Exceptional visit %s: the child had not recovered well by visit %s. If the discharge criteria are still not met after it, refer the child to see a doctor', p_visit_number, v_exp));
  end if;
  if v_max is not null and p_visit_number > v_max then
    v_flags := v_flags || jsonb_build_object('code', 'beyond_max_visits', 'action', 'refer', 'withhold_ration', false, 'source', 'Programme decision (Q23)',
      'message', format('Visit %s is beyond the %s visits the programme allows: refer the child to see a doctor', p_visit_number, v_max));
  end if;

  return jsonb_build_object(
    'basis', case when p_visit_number = 1 then 'baseline' else 'compared' end,
    'vs_previous', case when not v_has_prev then 'baseline' when 'worse' = any(v_prev_dirs) then 'deteriorated' when 'better' = any(v_prev_dirs) then 'improved'
                        when cardinality(v_prev_dirs) > 0 then 'unchanged' else 'not_assessed' end,
    'vs_baseline', case when not v_has_prev then 'baseline' when 'worse' = any(v_base_dirs) then 'deteriorated' when 'better' = any(v_base_dirs) then 'improved'
                        when cardinality(v_base_dirs) > 0 then 'unchanged' else 'not_assessed' end,
    'measures', v_measures, 'flags', v_flags,
    'trajectory', (
      select jsonb_agg(x.t order by x.n) from (
        select 0 as n, jsonb_build_object('visit', 'admission', 'date', v_adm.admitted_on, 'weight_kg', v_adm.weight_kg, 'muac_cm', v_adm.muac_cm,
                                          'oedema', v_adm.oedema, 'wfh_z', v_adm.wfh_z) as t
        union all
        select v.visit_number, jsonb_build_object('visit', v.visit_number, 'date', v.visit_on, 'attended', v.attended, 'weight_kg', v.weight_kg, 'muac_cm', v.muac_cm,
                                                  'oedema', v.oedema, 'wfh_z', v.wfh_z, 'rutf_recommended', v.rutf_prescribed, 'rutf_given', v.rutf_dispensed)
        from otp_visits v where v.admission_id = p_admission_id and v.visit_number < p_visit_number
        union all
        select p_visit_number, jsonb_build_object('visit', p_visit_number, 'date', null, 'current', true, 'weight_kg', v_wt,
                                                  'muac_cm', nullif(p_current ->> 'muac_cm', '')::numeric, 'oedema', p_current ->> 'oedema',
                                                  'wfh_z', nullif(p_current ->> 'wfh_z', '')::numeric)
      ) x(n, t)),
    'note', 'Direction of change only (better / same / worse). Whether a change is "sustained weight gain" or "no change" is for the clinical authority (RULEBOOK Q14).',
    'rule_set', v_rs.version, 'rule_status', v_rs.status);
end;
$$;

create or replace function otp_next_step(p_admission_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_adm otp_admissions; v_rs otp_rule_sets; v_ref otp_referrals; v_last otp_visits; v_chk jsonb; v_absent int; v_msg text; v_dest text;
        v_referred_since boolean; v_exp int; v_max int;
begin
  select * into v_adm from otp_admissions where id = p_admission_id;
  if v_adm.status <> 'active' then
    return jsonb_build_object('step', 'closed', 'schedule', false, 'message', 'The admission is closed: ' || coalesce(v_adm.outcome, ''));
  end if;
  select * into v_rs from otp_rule_sets where id = v_adm.rule_set_id;
  select * into v_ref from otp_referrals where admission_id = p_admission_id and status in ('referred', 'arrived');
  if v_ref.id is not null then
    v_dest := coalesce((select name from facilities where id = v_ref.destination_facility_id), v_ref.destination_name);
    return jsonb_build_object('step', 'awaiting_referral', 'schedule', false, 'referral_id', v_ref.id,
      'message', format('Referred to %s on %s: record the result of the referral before the next routine visit', v_dest, to_char(v_ref.referred_on, 'DD Mon')));
  end if;
  select * into v_last from otp_visits where admission_id = p_admission_id order by visit_number desc limit 1;
  if v_last.id is null then
    if v_adm.admission_type = 'transfer_from_otp' then
      return jsonb_build_object('step', 'continue', 'schedule', true, 'message', 'Transferred in: record the next visit at this OTP site');
    end if;
    return jsonb_build_object('step', 'admission_visit', 'schedule', false, 'message', 'Record the admission visit: the RUTF given and its photo');
  end if;
  -- A referral rule at the latest visit (G4, or beyond the visits allowed), unless the child has
  -- been referred since (and is back).
  v_referred_since := exists (select 1 from otp_referrals r where r.admission_id = p_admission_id and r.referred_on >= v_last.visit_on);
  if v_last.attended and not v_referred_since and exists (select 1 from jsonb_array_elements(coalesce(v_last.recovery -> 'flags', '[]'::jsonb)) x
                                                          where (x ->> 'withhold_ration')::boolean or x ->> 'action' = 'refer') then
    select string_agg(x ->> 'message', '; ') into v_msg from jsonb_array_elements(v_last.recovery -> 'flags') x
    where (x ->> 'withhold_ration')::boolean or x ->> 'action' = 'refer';
    return jsonb_build_object('step', 'refer', 'schedule', false, 'message', v_msg || '. Record the referral.');
  end if;
  v_chk := otp_discharge_check(p_admission_id);
  if (v_chk ->> 'can_discharge_as_cured')::boolean then
    return jsonb_build_object('step', 'discharge_review', 'schedule', false,
      'message', 'Every measurable discharge criterion is met: confirm and record the outcome, or schedule another visit with a reason');
  end if;
  -- The last visit the programme allows is done and the child has not met the discharge criteria:
  -- suggest a referral to a doctor (Q23), unless one has been made since.
  v_exp := nullif(v_rs.params ->> 'expected_visits', '')::int;
  v_max := nullif(v_rs.params ->> 'max_visits', '')::int;
  if v_max is not null and v_last.attended and v_last.visit_number >= v_max and not v_referred_since then
    return jsonb_build_object('step', 'refer', 'schedule', false,
      'message', format('Visit %s is done and the discharge criteria are not met: refer the child to see a doctor (%s visits are expected, a %s only when recovery is not good). Record the referral, or schedule another visit with a reason.',
                        v_last.visit_number, v_exp, case v_max when 4 then '4th' else v_max::text || 'th' end));
  end if;
  select count(*) into v_absent from otp_visits
  where admission_id = p_admission_id and not attended
    and visit_number > coalesce((select max(visit_number) from otp_visits where admission_id = p_admission_id and attended), 0);
  if v_absent >= (v_rs.params ->> 'defaulter_consecutive_absences')::int then
    return jsonb_build_object('step', 'record_outcome', 'schedule', false,
      'message', format('%s consecutive absences: the child meets the card''s defaulter definition; record the outcome', v_absent));
  end if;
  if v_last.attended and exists (select 1 from jsonb_array_elements(coalesce(v_last.recovery -> 'flags', '[]'::jsonb)) x where x ->> 'action' = 'home_visit_or_refer') then
    return jsonb_build_object('step', 'home_visit_or_refer', 'schedule', true,
      'message', 'Arrange a home visit or refer to inpatient care (card footnote); the next visit is scheduled');
  end if;
  if v_exp is not null and v_last.attended and v_last.visit_number = v_exp then
    return jsonb_build_object('step', 'exceptional_visit', 'schedule', true,
      'message', format('The child has not recovered well by visit %s (the discharge criteria are not met): an exceptional visit %s is scheduled', v_exp, v_exp + 1));
  end if;
  return jsonb_build_object('step', 'continue', 'schedule', true, 'message', 'Continue treatment: the next visit is scheduled');
end;
$$;

-- Active OTP sites in the officer's state, for transferring a child (names and LGAs only).
create or replace function otp_transfer_destinations()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_site facilities := otp_officer_site();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'lga', l.name) order by l.name, f.name)
    from facilities f join lgas l on l.id = f.lga_id
    where f.facility_type = 'health_facility' and f.is_otp_site and f.is_active and f.status = 'approved'
      and f.state_id = v_site.state_id and f.id <> v_site.id), '[]'::jsonb);
end;
$$;

revoke execute on function otp_recovery_assessment(uuid, int, jsonb), otp_next_step(uuid) from public, anon, authenticated;
revoke execute on function otp_transfer_destinations() from public, anon;
grant execute on function otp_transfer_destinations() to authenticated;
