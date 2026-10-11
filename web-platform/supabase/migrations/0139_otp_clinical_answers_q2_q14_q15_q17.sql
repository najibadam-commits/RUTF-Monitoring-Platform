-- RUTF Monitoring Platform — migration 0139: the clinical answers of 11 Oct 2026 (DECISIONS R175)
-- The programme's answers to RULEBOOK Q2, Q14, Q15 and Q17, in the draft rule set 2026-10-draft
-- (still to be approved by the State Nutrition Officer, R159):
--   Q15  Admission: MUAC below 11.5 cm (unchanged). Discharge: MUAC 13.5 cm or more (was above 11.5).
--   Q14  Weight varies with age; discharge is decided on MUAC, not weight: the "sustained weight
--        gain" and the weight-for-height discharge criteria are removed. Weight still sets the
--        ration (the ration table is by weight) and the card's "no weight change by visit 4" alert.
--   Q17  Recovered (discharged cured) = MUAC 13.5 cm or more with no clinical concern.
--        Non-recovered = a child whose MUAC goes down between visits (e.g. 11.7 then 11.5): likely
--        an illness — the app flags it and suggests referral to the clinic.
--   Q2   The stabilisation threshold is NOT changed to 4 kg: it stays below 3.5 kg.
-- Also closed (answered with the allocation guide, R173): Q19 no buffer stock for now; Q20 one
-- Apex OTP centre per LGA (lga_apex_otp).
-- Q16 (minimum stay of 8 weeks for a MUAC admission) is still open and kept.

update otp_rule_sets
set params = (params - 'discharge_muac_above' - 'discharge_wfh_above')
  || jsonb_build_object(
       'discharge_muac_at_least', 13.5,
       'discharge_basis', 'muac',
       'refer_on_muac_decline', true,
       'open_questions', (select coalesce(jsonb_agg(q), '[]') from jsonb_array_elements_text(params -> 'open_questions') q
                          where q not in ('Q2', 'Q14', 'Q15', 'Q17', 'Q19', 'Q20')))
where version = '2026-10-draft';

-- The discharge check: MUAC 13.5 cm or more at the latest visit (Q15), the minimum stay for a MUAC
-- admission (Q16, still open), no oedema for 2 visits for an oedema admission, and no clinical
-- concern at the latest visit (Q17) — none of: oedema, poor or refused appetite, fever, diarrhoea,
-- vomiting, dehydration, pallor, an action required, or a fall in MUAC since the visit before.
create or replace function otp_discharge_check(p_admission_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_adm otp_admissions; v_rs otp_rule_sets; pr jsonb; v_last otp_visits; v_prev otp_visits;
  v_weeks numeric; c jsonb := '[]'::jsonb; v_all boolean := true; mk_ok boolean; n int; v_at_least numeric; v_concerns text[];
begin
  select * into v_adm from otp_admissions where id = p_admission_id;
  select * into v_rs from otp_rule_sets where id = v_adm.rule_set_id; pr := v_rs.params;
  select * into v_last from otp_visits where admission_id = p_admission_id and attended order by visit_number desc limit 1;
  select * into v_prev from otp_visits where admission_id = p_admission_id and attended and visit_number < coalesce(v_last.visit_number, 0) order by visit_number desc limit 1;
  n := coalesce((pr ->> 'discharge_consecutive_visits')::int, 2);
  v_at_least := coalesce((pr ->> 'discharge_muac_at_least')::numeric, (pr ->> 'discharge_muac_above')::numeric);
  mk_ok := v_last.muac_cm is not null and v_last.muac_cm >= v_at_least;
  c := c || jsonb_build_object('criterion', format('MUAC %s cm or more at the latest visit', v_at_least),
    'state', case when v_last.muac_cm is null then 'pending' when mk_ok then 'met' else 'not_met' end,
    'detail', case when v_last.muac_cm is not null then format('latest MUAC %s cm', v_last.muac_cm) end, 'source', 'Programme answer Q15 (11 Oct)');
  if 'muac' = any(v_adm.admission_criteria) and pr ? 'discharge_min_weeks_muac' then
    v_weeks := (coalesce(v_last.visit_on, current_date) - v_adm.admitted_on) / 7.0;
    c := c || jsonb_build_object('criterion', format('Minimum stay of %s weeks', pr ->> 'discharge_min_weeks_muac'),
      'state', case when v_weeks >= (pr ->> 'discharge_min_weeks_muac')::numeric then 'met' else 'not_met' end, 'source', 'G7 D1 (Q16, open)');
  end if;
  if 'oedema' = any(v_adm.admission_criteria) then
    c := c || jsonb_build_object('criterion', format('No oedema for %s consecutive visits', n),
      'state', case when v_prev.id is null then 'pending'
                    when v_last.oedema = 'absent' and v_prev.oedema = 'absent' then 'met' else 'not_met' end, 'source', 'G7 D2');
  end if;
  -- No clinical concern at the latest visit (Q17).
  if v_last.id is not null then
    v_concerns := array_remove(array[
      case when coalesce(v_last.oedema, 'absent') <> 'absent' then 'oedema' end,
      case when v_last.appetite_test in ('poor', 'refused') then 'poor appetite' end,
      case when coalesce(v_last.fever_days, 0) > 0 then 'fever' end,
      case when coalesce(v_last.diarrhoea_days, 0) > 0 then 'diarrhoea' end,
      case when coalesce(v_last.vomiting_days, 0) > 0 then 'vomiting' end,
      case when v_last.dehydrated then 'dehydration' end,
      case when v_last.pallor then 'pallor' end,
      case when v_last.action_required then 'an action required' end,
      case when v_prev.id is not null and v_last.muac_cm < v_prev.muac_cm then 'MUAC went down' end], null);
  end if;
  c := c || jsonb_build_object('criterion', 'No clinical concern (recovered)',
    'state', case when v_last.id is null then 'pending' when cardinality(v_concerns) > 0 then 'not_met' else 'officer_confirms' end,
    'detail', case when cardinality(v_concerns) > 0 then 'at the latest visit: ' || array_to_string(v_concerns, ', ') end,
    'source', 'Programme answer Q17 (11 Oct)');
  select bool_and(x ->> 'state' in ('met', 'officer_confirms')) into v_all from jsonb_array_elements(c) x;
  return jsonb_build_object('criteria', c, 'can_discharge_as_cured', coalesce(v_all, false), 'rule_set', v_rs.version, 'rule_status', v_rs.status);
end;
$$;

create or replace function otp_recovery_assessment(p_admission_id uuid, p_visit_number int, p_current jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_adm otp_admissions; v_rs otp_rule_sets; v_prev otp_visits;
  m record; v_measures jsonb := '[]'::jsonb; v_flags jsonb := '[]'::jsonb;
  cur numeric; prv numeric; bas numeric; d_prev text; d_base text;
  v_prev_dirs text[] := '{}'; v_base_dirs text[] := '{}'; v_has_prev boolean;
  v_wt numeric := nullif(p_current ->> 'weight_kg', '')::numeric;
  v_exp int; v_max int; v_wmax int; v_on date;
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
    v_flags := v_flags || jsonb_build_object('code', 'C2_no_weight_change', 'action', 'home_visit_or_refer', 'withhold_ration', false, 'source', 'Card C2 footnote',
      'message', 'No change in weight by the 4th visit: arrange a home visit or refer to inpatient care (card footnote)');
  end if;
  -- Q17 (answered 11 Oct): a child whose MUAC goes down between visits (e.g. 11.7 then 11.5) is
  -- not recovering — probably an illness: refer to the clinic. RUTF stays recommended.
  if coalesce((v_rs.params ->> 'refer_on_muac_decline')::boolean, false) and p_visit_number > 1
     and nullif(p_current ->> 'muac_cm', '')::numeric < coalesce(v_prev.muac_cm, v_adm.muac_cm) then
    v_flags := v_flags || jsonb_build_object('code', 'Q17_muac_declining', 'action', 'refer', 'withhold_ration', false, 'source', 'Programme answer Q17 (11 Oct)',
      'message', format('MUAC went down from %s to %s cm since the last visit: the child is not recovering and may be ill — refer to the clinic',
                        coalesce(v_prev.muac_cm, v_adm.muac_cm), p_current ->> 'muac_cm'));
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

  -- The programme's rule (10 Oct): weekly follow-up up to 12 weeks until the child recovers; a
  -- visit after that is flagged for a doctor (a suggestion: RUTF stays recommended).
  v_wmax := nullif(v_rs.params ->> 'max_weeks', '')::int;
  v_on := nullif(p_current ->> 'visit_on', '')::date;
  if v_wmax is not null and v_on is not null and v_on - v_adm.admitted_on > v_wmax * 7 then
    v_flags := v_flags || jsonb_build_object('code', 'beyond_max_weeks', 'action', 'refer', 'withhold_ration', false, 'source', 'Programme rule (10 Oct)',
      'message', format('More than %s weeks in treatment without recovery: refer the child to see a doctor', v_wmax));
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
    'note', 'Direction of change only (better / same / worse). Discharge is decided on MUAC, not weight (RULEBOOK Q14); a fall in MUAC is a reason to refer (Q17).',
    'rule_set', v_rs.version, 'rule_status', v_rs.status);
end;
$$;

create or replace function otp_record_outcome(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_child otp_children := otp_child_at_my_site(p ->> 'child_code'); v_adm otp_admissions; v_chk jsonb;
begin
  select * into v_adm from otp_admissions where child_id = v_child.id and status = 'active';
  if v_adm.id is null then raise exception 'This child has no active OTP admission'; end if;
  if p ->> 'outcome' not in ('cured', 'defaulted', 'died', 'non_recovered', 'transferred_inpatient', 'refused_inpatient') then
    raise exception 'Unknown outcome (use the transfer function for a move to another OTP site)';
  end if;
  if p ->> 'outcome' = 'cured' then
    v_chk := otp_discharge_check(v_adm.id);
    if (v_chk ->> 'can_discharge_as_cured')::boolean is not true then
      raise exception 'Discharge as cured is not possible yet: not every criterion is met (%)',
        (select string_agg(x ->> 'criterion', '; ') from jsonb_array_elements(v_chk -> 'criteria') x where x ->> 'state' in ('not_met', 'pending'));
    end if;
    -- Q14: discharge is on MUAC, not weight — no weight-gain confirmation. Q17: the officer confirms
    -- there is no clinical concern.
    if coalesce((p ->> 'confirm_clinically_well')::boolean, false) is not true then
      raise exception 'Confirm the child has no clinical concern (recovered)';
    end if;
  elsif coalesce(trim(p ->> 'reason'), '') = '' then
    raise exception 'Record the reason for this outcome';
  end if;
  update otp_admissions set status = 'closed', outcome = p ->> 'outcome', outcome_on = coalesce(nullif(p ->> 'outcome_on', '')::date, current_date),
         outcome_reason = nullif(trim(p ->> 'reason'), ''), outcome_confirmed_by = auth.uid()
  where id = v_adm.id;
  return jsonb_build_object('child_code', v_child.child_code, 'outcome', p ->> 'outcome', 'discharge_check', v_chk);
end;
$$;
