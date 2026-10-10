-- RUTF Monitoring Platform — migration 0132
-- The user's answers of 10 Oct (DECISIONS R160–R162):
--   RUTF follow-up is WEEKLY UP TO 12 WEEKS until the child recovers (RULEBOOK Q12). This replaces
--     the 3-visit / exceptional-4th rule of 0129: after 12 weeks without recovery the app suggests a
--     referral to a doctor; the booklet's 8-week minimum for MUAC admissions now fits.
--   MNP (W6): a child whose MUAC is yellow receives MNP — 3 boxes of 30 sachets AT ONCE, for 3 months —
--     and comes back after 3 months; counts only, no names (the user's choice). The pack: 150 sachets
--     a carton, 5 boxes of 30.
--   The clinical rules are set by the STATE NUTRITION OFFICER (Q22): only they may approve the rule set.

-- Rule set: weekly up to 12 weeks; the visit-count rule off; answered questions closed.
update otp_rule_sets set params = (params || jsonb_build_object('visit_interval_days', 7, 'max_weeks', 12, 'expected_visits', null, 'max_visits', null))
    || jsonb_build_object('open_questions', (params -> 'open_questions') - 'Q12' - 'Q21' - 'Q22')
where version = '2026-10-draft';

-- MNP pack and pattern (W6).
insert into rutf_thresholds (project_id, key, value, note)
select p.id, t.key, t.value, t.note from projects p cross join (values
  ('mnp_sachets_per_carton', 150, 'MNP sachets in a carton (5 boxes of 30)'),
  ('mnp_sachets_per_box', 30, 'MNP sachets in a box'),
  ('mnp_boxes_per_child', 3, 'MNP boxes a MAM child (MUAC yellow) receives at once, for 3 months'),
  ('mnp_follow_up_months', 3, 'Months after which a child on MNP comes back for follow-up')
) as t(key, value, note)
where p.name = 'Katsina RUTF Pilot'
on conflict (project_id, key) do update set value = excluded.value, note = excluded.note;

alter table mnp_doses alter column dose_number drop not null;
alter table mnp_doses add column if not exists event text check (event in ('started', 'follow_up'));

-- Who approved the rules, with their account and note.
alter table otp_rule_sets add column if not exists approved_by_user uuid references profiles(id),
                          add column if not exists approval_note text;

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
    'note', 'Direction of change only (better / same / worse). Whether a change is "sustained weight gain" or "no change" is for the clinical authority (RULEBOOK Q14).',
    'rule_set', v_rs.version, 'rule_status', v_rs.status);
end;
$$;

create or replace function otp_next_step(p_admission_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_adm otp_admissions; v_rs otp_rule_sets; v_ref otp_referrals; v_last otp_visits; v_chk jsonb; v_absent int; v_msg text; v_dest text;
        v_referred_since boolean; v_exp int; v_max int; v_wmax int; v_week int;
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
  -- 12 weeks of weekly follow-up done without recovery: refer the child to see a doctor.
  v_wmax := nullif(v_rs.params ->> 'max_weeks', '')::int;
  v_week := (v_last.visit_on - v_adm.admitted_on) / 7;
  if v_wmax is not null and v_last.attended and v_last.visit_on - v_adm.admitted_on >= v_wmax * 7 and not v_referred_since then
    return jsonb_build_object('step', 'refer', 'schedule', false,
      'message', format('%s weeks of treatment and the discharge criteria are not met: refer the child to see a doctor (follow-up is weekly up to %s weeks). Record the referral, or the outcome (non-recovered).', v_week, v_wmax));
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
  return jsonb_build_object('step', 'continue', 'schedule', true,
    'message', case when v_wmax is not null then format('Continue treatment (week %s of up to %s): the next visit is scheduled', v_week, v_wmax)
                    else 'Continue treatment: the next visit is scheduled' end);
end;
$$;

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

create or replace function otp_screen(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_res jsonb; v_id uuid; v_box int; v_boxes int; v_months int;
begin
  if nullif(p ->> 'client_id', '') is not null then
    select id, result into v_id, v_res from otp_screenings where client_id = (p ->> 'client_id')::uuid;
    if v_id is not null then return v_res || jsonb_build_object('screening_id', v_id, 'duplicate_submission', true); end if;
  end if;
  v_res := otp_evaluate_screening(p, v_site.otp_uses_wfh);
  -- The programme (10 Oct): a child whose MUAC is yellow (MAM, no complications) receives MNP —
  -- 3 boxes of 30 sachets at once, for 3 months — and comes back after 3 months for follow-up.
  if v_res ->> 'pathway' = 'nutrition_advice' and v_res ->> 'muac_band' = 'yellow' then
    v_box := rutf_threshold(v_site.project_id, 'mnp_sachets_per_box', 30)::int;
    v_boxes := rutf_threshold(v_site.project_id, 'mnp_boxes_per_child', 3)::int;
    v_months := rutf_threshold(v_site.project_id, 'mnp_follow_up_months', 3)::int;
    v_res := v_res || jsonb_build_object(
      'next_action', format('Give MNP (micronutrient powder): %s boxes (%s sachets) now, for %s months, and ask the caregiver to come back after %s months for follow-up. Give nutritional advice; refer to the Supplementary Feeding Programme if available (G1).',
                            v_boxes, v_boxes * v_box, v_months, v_months),
      'mnp', jsonb_build_object('boxes', v_boxes, 'sachets', v_boxes * v_box, 'months', v_months, 'follow_up_on', current_date + (v_months || ' months')::interval));
  end if;
  insert into otp_screenings (project_id, facility_id, lga_id, sex, age_months, inputs, result, classification, pathway, recorded_by, client_id)
  values (v_site.project_id, v_site.id, v_site.lga_id, nullif(p ->> 'sex', ''), nullif(p ->> 'age_months', '')::int,
          p - 'client_id', v_res, v_res ->> 'classification', v_res ->> 'pathway', auth.uid(), nullif(p ->> 'client_id', '')::uuid)
  returning id into v_id;
  return v_res || jsonb_build_object('screening_id', v_id);
end;
$$;

create or replace function otp_record_mnp_doses(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_id uuid; v_event text := coalesce(nullif(p ->> 'event', ''), 'started');
        v_n int := nullif(p ->> 'children', '')::int; v_box int; v_boxes int;
begin
  if nullif(p ->> 'client_id', '') is not null then
    select id into v_id from mnp_doses where client_id = (p ->> 'client_id')::uuid; if v_id is not null then return v_id; end if;
  end if;
  if (p ->> 'given_on')::date > current_date then raise exception 'The date cannot be in the future'; end if;
  if v_event not in ('started', 'follow_up') then raise exception 'Record children started on MNP or back for the follow-up'; end if;
  if v_n is null or v_n < 0 then raise exception 'Record the number of children'; end if;
  insert into mnp_doses (project_id, facility_id, given_on, dose_number, event, children, recorded_by, client_id)
  values (v_site.project_id, v_site.id, (p ->> 'given_on')::date, null, v_event, v_n, auth.uid(), nullif(p ->> 'client_id', '')::uuid)
  returning id into v_id;
  -- Children started on MNP take their boxes home: the stock goes out with them.
  if v_event = 'started' and v_n > 0 then
    v_box := rutf_threshold(v_site.project_id, 'mnp_sachets_per_box', 30)::int;
    v_boxes := rutf_threshold(v_site.project_id, 'mnp_boxes_per_child', 3)::int;
    insert into mnp_stock_movements (project_id, facility_id, movement_date, kind, sachets, note, recorded_by)
    values (v_site.project_id, v_site.id, (p ->> 'given_on')::date, 'distributed', v_n * v_boxes * v_box,
            format('%s child(ren) started on MNP: %s boxes of %s sachets each (recorded automatically)', v_n, v_boxes, v_box), auth.uid());
  end if;
  return v_id;
end;
$$;

create or replace function otp_weekly_report_compute(p_facility_id uuid, p_week_start date)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_base jsonb := otp_weekly_report_compute_base(p_facility_id, p_week_start);
  ws date := (v_base -> 'sections' -> 'A' ->> 'week_start')::date;
  we date := ws + 6;
  l jsonb; v_ref jsonb; v_appt jsonb; v_missing int; v_issues jsonb := v_base -> 'issues'; i jsonb; v_outside int; v_cat jsonb; v_refs jsonb; v_sections jsonb; h jsonb; v_mnp jsonb; v_proj uuid;
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

  -- H. MNP (10 Oct): children started (3 boxes at once) and back for the 3-month follow-up, and how
  -- many are due back this week (started 3 months before); the pack is 150 sachets a carton, 5 boxes of 30.
  select project_id into v_proj from facilities where id = p_facility_id;
  h := v_base -> 'sections' -> 'H';
  if coalesce(h ->> 'status', '') <> 'not_recorded' then
    select jsonb_build_object(
        'started', coalesce(sum(children) filter (where event = 'started' and given_on between ws and we), 0),
        'follow_up', coalesce(sum(children) filter (where event = 'follow_up' and given_on between ws and we), 0),
        'due_back_this_week', coalesce(sum(children) filter (where event = 'started'
            and given_on between (ws - (rutf_threshold(v_proj, 'mnp_follow_up_months', 3)::int || ' months')::interval)::date
                             and (we - (rutf_threshold(v_proj, 'mnp_follow_up_months', 3)::int || ' months')::interval)::date), 0))
      into v_mnp from mnp_doses where facility_id = p_facility_id;
    h := h || jsonb_build_object('children', v_mnp, 'pack', jsonb_build_object(
      'sachets_per_carton', rutf_threshold(v_proj, 'mnp_sachets_per_carton', 150), 'sachets_per_box', rutf_threshold(v_proj, 'mnp_sachets_per_box', 30),
      'boxes_per_child', rutf_threshold(v_proj, 'mnp_boxes_per_child', 3), 'follow_up_after_months', rutf_threshold(v_proj, 'mnp_follow_up_months', 3)));
  end if;
  v_sections := (v_base -> 'sections') || jsonb_build_object('I', i, 'L', l, 'H', h);
  v_sections := jsonb_set(v_sections, '{C,SAM,categories}', v_cat);
  v_sections := jsonb_set(v_sections, '{E,SAM,referred}', v_refs);
  return jsonb_build_object('sections', v_sections, 'issues', v_issues);
end;
$$;

-- Is the caller a State Nutrition Officer (an officer at a State store)?
create or replace function otp_is_state_nutrition_officer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p join facilities f on f.id = p.facility_id
                 where p.id = auth.uid() and p.role = 'dri' and p.status = 'active' and f.facility_type = 'state_store');
$$;

-- The clinical rules in force, for everyone signed in to read (no personal data), with whether the
-- caller may approve them.
create or replace function otp_rules_view()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rs otp_rule_sets := otp_current_rule_set();
begin
  if auth.uid() is null then raise exception 'Sign in to see the clinical rules'; end if;
  return jsonb_build_object('version', v_rs.version, 'status', v_rs.status, 'source', v_rs.source, 'params', v_rs.params,
    'effective_from', v_rs.effective_from, 'approved_by', v_rs.approved_by, 'approved_at', v_rs.approved_at, 'approval_note', v_rs.approval_note,
    'bands', coalesce((select jsonb_agg(jsonb_build_object('min_kg', min_kg, 'max_kg', max_kg, 'per_day', packets_per_day, 'per_week', packets_per_week, 'source', source_ref) order by min_kg)
                       from otp_ration_bands where rule_set_id = v_rs.id), '[]'::jsonb),
    'can_approve', v_rs.status = 'draft' and otp_is_state_nutrition_officer());
end;
$$;

-- The State Nutrition Officer approves the draft rule set: it becomes the rules in force from
-- today for new admissions (children already admitted keep theirs). Recorded with their name.
create or replace function otp_rule_set_approve(p_version text, p_confirm boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rs otp_rule_sets; v_name text;
begin
  if not otp_is_state_nutrition_officer() then raise exception 'Only the State Nutrition Officer may approve the clinical rules'; end if;
  select * into v_rs from otp_rule_sets where version = p_version for update;
  if v_rs.id is null then raise exception 'No rule set %', p_version; end if;
  if v_rs.status <> 'draft' then raise exception 'This rule set is %, not a draft', v_rs.status; end if;
  if coalesce(p_confirm, false) is not true then raise exception 'Confirm that you have reviewed the rules'; end if;
  select name into v_name from profiles where id = auth.uid();
  update otp_rule_sets set status = 'retired' where status = 'approved';
  update otp_rule_sets set status = 'approved', effective_from = current_date, approved_by = v_name || ' (State Nutrition Officer)',
         approved_by_user = auth.uid(), approved_at = now(), approval_note = nullif(trim(p_note), '')
  where id = v_rs.id;
  return jsonb_build_object('version', v_rs.version, 'status', 'approved', 'effective_from', current_date, 'approved_by', v_name);
end;
$$;

revoke execute on function otp_recovery_assessment(uuid, int, jsonb), otp_next_step(uuid), otp_weekly_report_compute(uuid, date) from public, anon, authenticated;
revoke execute on function otp_record_visit(jsonb), otp_screen(jsonb), otp_record_mnp_doses(jsonb), otp_is_state_nutrition_officer(),
  otp_rules_view(), otp_rule_set_approve(text, boolean, text) from public, anon;
grant execute on function otp_record_visit(jsonb), otp_screen(jsonb), otp_record_mnp_doses(jsonb), otp_is_state_nutrition_officer(),
  otp_rules_view(), otp_rule_set_approve(text, boolean, text) to authenticated;
