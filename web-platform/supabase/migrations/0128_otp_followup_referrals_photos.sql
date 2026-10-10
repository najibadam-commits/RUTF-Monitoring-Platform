-- RUTF Monitoring Platform — migration 0128
-- OTP follow-up: the admission visit, recovery comparison, automatic weekly scheduling, referrals,
-- photos of the RUTF given, the officer's visits list; weekly report section L, figure corrections
-- with reasons, "under review" and "rejected" (DECISIONS R150–R154; enhancement request of 10 Oct).
--
-- No clinical threshold is invented here. The recovery comparison reports the DIRECTION of each
-- measurement (better / same / worse) against the admission and the previous visit; what counts as
-- "sustained weight gain" or "no change" stays with the clinical authority (RULEBOOK Q14). Referral
-- and withholding rules are only those in the booklet and the card (G4, C2). The expected number of
-- visits is a rule-set setting left empty until it is confirmed (RULEBOOK Q23): the booklet's
-- minimum stay of 8 weeks for MUAC admissions (G7 D1) does not fit a three-visit pathway.

-- ── Rule-set settings ────────────────────────────────────────────────────────────────────────
update otp_rule_sets set params = params || jsonb_build_object(
    'visit_interval_days', 7,          -- weekly follow-up (request §9; RUTF goes to OTP sites weekly, A6; RULEBOOK Q12)
    'expected_visits', null,           -- RULEBOOK Q23: not applied until confirmed
    'rutf_photo_required', true,       -- the user's decision, 10 Oct: required whenever RUTF is given
    'open_questions', (params -> 'open_questions') || '["Q23"]'::jsonb)
where version = '2026-10-draft' and not (params -> 'open_questions') ? 'Q23';

-- ── Visits: the admission visit, the ration status, the recovery comparison, completeness ────
alter table otp_visits
  add column if not exists visit_kind text not null default 'follow_up' check (visit_kind in ('admission', 'follow_up')),
  add column if not exists ration_status text check (ration_status in ('recommended', 'withheld', 'no_rule')),
  add column if not exists ration_withheld_reason text,
  add column if not exists dispense_authorised_by text,   -- the clinician who authorised RUTF when the recommendation was withheld
  add column if not exists recovery jsonb,                -- the comparison made when the visit was saved (without the trajectory)
  add column if not exists record_status text not null default 'complete' check (record_status in ('awaiting_photo', 'complete'));
comment on column otp_visits.rutf_prescribed is 'Packets recommended by the ration table for this visit (null when withheld or no rule)';
comment on column otp_visits.rutf_dispensed is 'Packets actually given by the OTP Officer';

-- The list view of the officer is logged without a child.
alter table otp_access_log alter column child_id drop not null;

-- ── Appointments (the next visit), referrals, photos ─────────────────────────────────────────
create table otp_appointments (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references otp_admissions(id),
  facility_id uuid not null references facilities(id),
  visit_number int not null,
  due_on date not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'attended', 'missed', 'rescheduled', 'cancelled')),
  reason text,                                    -- why it was rescheduled, cancelled or scheduled by hand
  visit_id uuid references otp_visits(id),        -- the visit that closed it
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index otp_appointments_one_open on otp_appointments(admission_id) where status = 'scheduled';
create index otp_appointments_facility_idx on otp_appointments(facility_id, due_on);

create table otp_referrals (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references otp_admissions(id),
  facility_id uuid not null references facilities(id),     -- the OTP site that referred
  visit_id uuid references otp_visits(id),
  referred_on date not null default current_date,
  reason text not null,
  triggers text[] not null default '{}',                   -- the rule codes that prompted it (e.g. G4_oedema_severe)
  destination_facility_id uuid references facilities(id),
  destination_name text,
  status text not null default 'referred' check (status in ('referred', 'arrived', 'returned', 'refused', 'closed')),
  status_note text,
  status_changed_at timestamptz,
  status_changed_by uuid references profiles(id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  client_id uuid unique,
  check (destination_facility_id is not null or nullif(trim(destination_name), '') is not null)
);
create unique index otp_referrals_one_open on otp_referrals(admission_id) where status in ('referred', 'arrived');
create index otp_referrals_facility_idx on otp_referrals(facility_id, referred_on);

-- Photos of the RUTF given (sachets only: the officer confirms no child or caregiver is in the frame).
create table otp_visit_photos (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references otp_visits(id),
  facility_id uuid not null references facilities(id),
  storage_path text not null unique,              -- {facility_id}/{visit_id}/{file} in the private bucket otp-rutf-evidence
  no_people_confirmed boolean not null check (no_people_confirmed),
  taken_by uuid references profiles(id),
  uploaded_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['otp_appointments', 'otp_referrals', 'otp_visit_photos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
    execute format('create trigger %1$s_audit after update or delete on %1$s for each row execute function otp_audit()', t);
  end loop;
end $$;

-- ── Photo storage: private bucket; upload only to an own-site visit waiting for its photo; view
-- only by the OTP Officers at that site and the super administrator. No update or delete. ────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('otp-rutf-evidence', 'otp-rutf-evidence', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Policies run as the caller, who cannot read the OTP tables: these helpers answer yes / no only.
create or replace function otp_rutf_photo_can_upload(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select current_user_role() = 'dri' and exists (
    select 1 from otp_visits v join otp_admissions a on a.id = v.admission_id
    where v.record_status = 'awaiting_photo' and a.facility_id = current_facility_id()
      and a.facility_id::text = split_part(p_name, '/', 1) and v.id::text = split_part(p_name, '/', 2));
$$;
create or replace function otp_rutf_photo_can_view(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  -- (the uploader may also read back a photo of a visit still waiting for it: an upload returns the row)
  select exists (select 1 from otp_visit_photos ph where ph.storage_path = p_name
                 and (is_super_admin() or (current_user_role() = 'dri' and ph.facility_id = current_facility_id())))
         or otp_rutf_photo_can_upload(p_name);
$$;
revoke execute on function otp_rutf_photo_can_upload(text), otp_rutf_photo_can_view(text) from public, anon;
grant execute on function otp_rutf_photo_can_upload(text), otp_rutf_photo_can_view(text) to authenticated;

create policy "otp-rutf-evidence insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'otp-rutf-evidence' and otp_rutf_photo_can_upload(name));
create policy "otp-rutf-evidence select" on storage.objects for select to authenticated
  using (bucket_id = 'otp-rutf-evidence' and otp_rutf_photo_can_view(name));

-- ── Recovery comparison ──────────────────────────────────────────────────────────────────────

create or replace function otp_oedema_grade(p text)
returns int language sql immutable set search_path = public as $$
  select case p when 'absent' then 0 when '+' then 1 when '++' then 2 when '+++' then 3 end;
$$;

-- better / same / worse, or null when there is nothing to compare with. p_good: 1 = higher is
-- better (weight, MUAC, WFH), -1 = lower is better (oedema grade).
create or replace function otp_direction(p_current numeric, p_ref numeric, p_good int)
returns text language sql immutable set search_path = public as $$
  select case when p_current is null or p_ref is null then null
              when p_current = p_ref then 'same'
              when (p_current > p_ref) = (p_good > 0) then 'better' else 'worse' end;
$$;

-- The comparison of a visit's measurements (p_current) with the admission (baseline) and the
-- previous attended visit, plus the rule-based flags (booklet G4, card C2) and the trajectory.
-- p_current: weight_kg, muac_cm, wfh_z, oedema, appetite_test.
create or replace function otp_recovery_assessment(p_admission_id uuid, p_visit_number int, p_current jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_adm otp_admissions; v_rs otp_rule_sets; v_prev otp_visits;
  m record; v_measures jsonb := '[]'::jsonb; v_flags jsonb := '[]'::jsonb;
  cur numeric; prv numeric; bas numeric; d_prev text; d_base text;
  v_prev_dirs text[] := '{}'; v_base_dirs text[] := '{}'; v_has_prev boolean;
  v_wt numeric := nullif(p_current ->> 'weight_kg', '')::numeric;
  v_exp int;
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
  v_exp := nullif(v_rs.params ->> 'expected_visits', '')::int;
  if v_exp is not null and p_visit_number > v_exp then
    v_flags := v_flags || jsonb_build_object('code', 'beyond_expected_visits', 'action', 'clinical_review', 'withhold_ration', true, 'source', 'Rule set (Q23)',
      'message', format('Visit %s is beyond the expected %s visits: clinical review before more RUTF', p_visit_number, v_exp));
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

-- What should happen next for an admission, and whether a routine visit is scheduled.
create or replace function otp_next_step(p_admission_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_adm otp_admissions; v_rs otp_rule_sets; v_ref otp_referrals; v_last otp_visits; v_chk jsonb; v_absent int; v_msg text; v_dest text;
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
  -- A referral rule at the latest visit, unless the child has been referred since (and is back).
  if v_last.attended and exists (select 1 from jsonb_array_elements(coalesce(v_last.recovery -> 'flags', '[]'::jsonb)) x where (x ->> 'withhold_ration')::boolean)
     and not exists (select 1 from otp_referrals r where r.admission_id = p_admission_id and r.referred_on >= v_last.visit_on) then
    select string_agg(x ->> 'message', '; ') into v_msg from jsonb_array_elements(v_last.recovery -> 'flags') x where (x ->> 'withhold_ration')::boolean;
    return jsonb_build_object('step', 'refer', 'schedule', false, 'message', v_msg || '. Record the referral.');
  end if;
  v_chk := otp_discharge_check(p_admission_id);
  if (v_chk ->> 'can_discharge_as_cured')::boolean then
    return jsonb_build_object('step', 'discharge_review', 'schedule', false,
      'message', 'Every measurable discharge criterion is met: confirm and record the outcome, or schedule another visit with a reason');
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
  return jsonb_build_object('step', 'continue', 'schedule', true, 'message', 'Continue treatment: the next visit is scheduled');
end;
$$;

-- ── Record a visit (replaces 0124): the admission visit, the comparison, withholding, photos,
-- duplicate protection and the next appointment ──────────────────────────────────────────────
-- p: child_code, admission_visit (true for the first visit at admission), visit_on, attended, the
-- card's visit fields, rutf_dispensed (required when attended), dispense_note,
-- dispense_authorised_by, examiner_initials, client_id.
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
    if v_status in ('withheld', 'no_rule') and v_disp > 0
       and (coalesce(trim(p ->> 'dispense_note'), '') = '' or coalesce(trim(p ->> 'dispense_authorised_by'), '') = '') then
      raise exception 'No RUTF is recommended at this visit (%): RUTF can be given only with the reason and the name of the clinician who authorised it',
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
    v_status, v_withhold, nullif(trim(p ->> 'dispense_authorised_by'), ''), v_rec - 'trajectory', v_rec_status,
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

-- Attach the photo of the RUTF given, once uploaded to {facility_id}/{visit_id}/… . Completes the visit.
create or replace function otp_attach_visit_photo(p_visit_id uuid, p_storage_path text, p_no_people_confirmed boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_visit otp_visits; v_fac uuid;
begin
  select * into v_visit from otp_visits where id = p_visit_id;
  select a.facility_id into v_fac from otp_visits v join otp_admissions a on a.id = v.admission_id where v.id = p_visit_id;
  if v_visit.id is null or v_fac <> v_site.id then raise exception 'Visit not found at your OTP site'; end if;
  if coalesce(p_no_people_confirmed, false) is not true then raise exception 'Confirm that no child or caregiver is in the photo'; end if;
  if split_part(p_storage_path, '/', 1) <> v_site.id::text or split_part(p_storage_path, '/', 2) <> p_visit_id::text then
    raise exception 'The photo is not stored for this visit';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'otp-rutf-evidence' and name = p_storage_path) then
    raise exception 'The photo has not finished uploading: try again';
  end if;
  insert into otp_visit_photos (visit_id, facility_id, storage_path, no_people_confirmed, taken_by)
  values (p_visit_id, v_site.id, p_storage_path, true, auth.uid()) on conflict (storage_path) do nothing;
  update otp_visits set record_status = 'complete' where id = p_visit_id and record_status = 'awaiting_photo';
  return jsonb_build_object('visit_id', p_visit_id, 'record_status', 'complete',
    'photos', (select count(*) from otp_visit_photos where visit_id = p_visit_id));
end;
$$;

-- The photo paths of a visit, for the OTP Officers at its site (shown through signed links).
create or replace function otp_visit_photo_paths(p_visit_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_site facilities := otp_officer_site();
begin
  return coalesce((select jsonb_agg(ph.storage_path order by ph.uploaded_at) from otp_visit_photos ph
                   where ph.visit_id = p_visit_id and ph.facility_id = v_site.id), '[]'::jsonb);
end;
$$;

-- Reschedule the next visit (or schedule one by hand after a decision), with the reason.
-- p: child_code, due_on, reason.
create or replace function otp_reschedule_visit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_child otp_children := otp_child_at_my_site(p ->> 'child_code'); v_adm otp_admissions; v_old otp_appointments; v_due date := nullif(p ->> 'due_on', '')::date; v_new otp_appointments; v_n int;
begin
  select * into v_adm from otp_admissions where child_id = v_child.id and status = 'active';
  if v_adm.id is null then raise exception 'This child has no active OTP admission'; end if;
  if v_due is null or v_due < current_date then raise exception 'Choose a date from today onwards'; end if;
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

-- Refer a child (G4 stabilisation care, or a clinician's examination). Stops routine scheduling
-- and the RUTF recommendation until the result is recorded.
-- p: child_code, reason, triggers (array of rule codes), destination_facility_id or destination_name, referred_on, visit_id, client_id.
create or replace function otp_refer_child(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_child otp_children := otp_child_at_my_site(p ->> 'child_code'); v_adm otp_admissions; v_ref otp_referrals; v_id uuid; v_dest uuid := nullif(p ->> 'destination_facility_id', '')::uuid;
        v_on date := coalesce(nullif(p ->> 'referred_on', '')::date, current_date);
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
  if v_on > current_date or v_on < v_adm.admitted_on then raise exception 'The referral date must be between the admission and today'; end if;
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

-- Record what happened to a referral: arrived (still open), returned to the OTP (schedules a visit
-- today), refused (caregiver refused; schedules a visit today), closed (e.g. admitted as an
-- inpatient: record the outcome too).
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
    values (v_adm.id, v_adm.facility_id, v_n, current_date, 'Back from referral (' || p_status || ')', auth.uid());
  end if;
  return jsonb_build_object('referral_id', v_ref.id, 'status', p_status, 'next_step', otp_next_step(v_adm.id));
end;
$$;

-- Closing an admission (outcome or transfer) cancels its appointment and closes an open referral;
-- a child transferred in keeps the due date of the visit cancelled at the old site.
create or replace function otp_admission_followup_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_due date; v_prev uuid;
begin
  if tg_op = 'UPDATE' and old.status = 'active' and new.status = 'closed' then
    update otp_appointments set status = 'cancelled', reason = 'Admission closed: ' || coalesce(new.outcome, ''), closed_at = now()
    where admission_id = new.id and status = 'scheduled';
    update otp_referrals set status = 'closed', status_note = coalesce(status_note, 'Admission closed: ' || coalesce(new.outcome, '')), status_changed_at = now(), status_changed_by = auth.uid()
    where admission_id = new.id and status in ('referred', 'arrived');
  elsif tg_op = 'INSERT' and new.admission_type = 'transfer_from_otp' then
    select id into v_prev from otp_admissions where child_id = new.child_id and id <> new.id and outcome = 'transferred_otp' order by outcome_on desc nulls last, created_at desc limit 1;
    select due_on into v_due from otp_appointments where admission_id = v_prev and status = 'cancelled' order by closed_at desc limit 1;
    insert into otp_appointments (admission_id, facility_id, visit_number, due_on, reason, created_by)
    values (new.id, new.facility_id, 2, greatest(coalesce(v_due, current_date), current_date), 'Transferred in', auth.uid());
  end if;
  return null;
end;
$$;
revoke execute on function otp_admission_followup_sync() from public, anon, authenticated;
create trigger otp_admissions_followup after insert or update of status on otp_admissions
  for each row execute function otp_admission_followup_sync();

-- The OTP Officer's visits list: Child IDs only (no names, caregivers, addresses or phones; the
-- user's decision, 10 Oct). Opening a child still needs the Child ID. The view is logged.
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
    'today', current_date, 'site', v_site.name,
    'due', coalesce((select jsonb_agg(jsonb_build_object('child_code', act.child_code, 'visit_number', ap.visit_number, 'due_on', ap.due_on,
               'state', case when ap.due_on < current_date then 'overdue' when ap.due_on = current_date then 'today' else 'upcoming' end,
               'days_overdue', greatest(current_date - ap.due_on, 0), 'rescheduled', ap.reason is not null) order by ap.due_on, act.child_code)
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

-- Open a child's record by Child ID (replaces 0124): adds the next visit, appointments, referrals,
-- photos per visit, the trajectory, the latest comparison and the next step. Logged.
create or replace function otp_child_lookup(p_child_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_child otp_children := otp_child_at_my_site(p_child_code); v_adm otp_admissions; v_out jsonb; v_last otp_visits;
begin
  insert into otp_access_log (actor, child_id, action) values (auth.uid(), v_child.id, 'lookup');
  select * into v_adm from otp_admissions where child_id = v_child.id order by (status = 'active') desc, admitted_on desc limit 1;
  select * into v_last from otp_visits where admission_id = v_adm.id and attended order by visit_number desc limit 1;
  select jsonb_build_object(
    'child_code', v_child.child_code, 'sex', v_child.sex, 'date_of_birth', v_child.date_of_birth,
    'age_months_at_registration', v_child.age_months_at_registration, 'registered_at', v_child.registered_at,
    'identity', (select to_jsonb(i) - 'child_id' - 'updated_at' from otp_child_identity i where i.child_id = v_child.id),
    'admission', to_jsonb(v_adm),
    'visits', coalesce((select jsonb_agg((to_jsonb(v) - 'admission_id') || jsonb_build_object('photos', (select count(*) from otp_visit_photos ph where ph.visit_id = v.id))
                                         order by v.visit_number) from otp_visits v where v.admission_id = v_adm.id), '[]'::jsonb),
    'medications', coalesce((select jsonb_agg(to_jsonb(m) - 'admission_id' order by m.given_on) from otp_medications m where m.admission_id = v_adm.id), '[]'::jsonb),
    'due_medications', case when v_adm.id is not null then otp_due_medications_for(v_adm.id) end,
    'past_admissions', (select count(*) from otp_admissions where child_id = v_child.id and id <> coalesce(v_adm.id, gen_random_uuid())),
    'discharge_check', case when v_adm.status = 'active' then otp_discharge_check(v_adm.id) end,
    'next_visit', (select jsonb_build_object('due_on', due_on, 'visit_number', visit_number, 'overdue', due_on < current_date, 'reason', reason)
                   from otp_appointments where admission_id = v_adm.id and status = 'scheduled'),
    'appointments', coalesce((select jsonb_agg(jsonb_build_object('visit_number', visit_number, 'due_on', due_on, 'status', status, 'reason', reason, 'closed_at', closed_at)
                                               order by created_at) from otp_appointments where admission_id = v_adm.id), '[]'::jsonb),
    'referrals', coalesce((select jsonb_agg((to_jsonb(r) - 'admission_id' - 'client_id') || jsonb_build_object('destination',
                                               coalesce((select name from facilities where id = r.destination_facility_id), r.destination_name)) order by r.referred_on)
                           from otp_referrals r where r.admission_id = v_adm.id), '[]'::jsonb),
    'latest_comparison', v_last.recovery,
    'trajectory', case when v_adm.id is not null then
        otp_recovery_assessment(v_adm.id, coalesce((select max(visit_number) from otp_visits where admission_id = v_adm.id), 0) + 1, '{}'::jsonb) -> 'trajectory' end,
    'next_step', case when v_adm.id is not null then otp_next_step(v_adm.id) end
  ) into v_out;
  -- The trajectory above ends with an empty "current" entry for the next visit: drop it.
  v_out := jsonb_set(v_out, '{trajectory}', coalesce((select jsonb_agg(t) from jsonb_array_elements(v_out -> 'trajectory') t where not coalesce((t ->> 'current')::boolean, false)), '[]'::jsonb));
  return v_out;
end;
$$;

-- ── Aggregates of follow-up for everyone in scope (no child-level rows, small counts hidden) ──
create or replace function otp_followup_aggregates(p_start date, p_end date, p_lga_id uuid default null, p_facility_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_project uuid := current_project_id(); v_min int; v_out jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to see OTP figures'; end if;
  v_min := rutf_threshold(v_project, 'otp_min_cell_count', 5)::int;
  with scope as (
    select a.id, a.facility_id from otp_admissions a join otp_children c on c.id = a.child_id join facilities f on f.id = a.facility_id
    where (select in_scope(c.project_id)) and (p_lga_id is null or f.lga_id = p_lga_id) and (p_facility_id is null or a.facility_id = p_facility_id)
  ), vis as (
    select v.* from otp_visits v join scope s on s.id = v.admission_id where v.visit_on between p_start and p_end
  ), counts as (
    select jsonb_build_object(
      'admission_visits', count(*) filter (where visit_kind = 'admission'),
      'visit_2', count(*) filter (where visit_kind = 'follow_up' and attended and visit_number = 2),
      'visit_3', count(*) filter (where visit_kind = 'follow_up' and attended and visit_number = 3),
      'visit_4_plus', count(*) filter (where visit_kind = 'follow_up' and attended and visit_number >= 4),
      'absences', count(*) filter (where not attended),
      'improved', count(*) filter (where recovery ->> 'vs_previous' = 'improved'),
      'unchanged', count(*) filter (where recovery ->> 'vs_previous' = 'unchanged'),
      'deteriorated', count(*) filter (where recovery ->> 'vs_previous' = 'deteriorated'),
      'rutf_withheld', count(*) filter (where ration_status = 'withheld'),
      'awaiting_photo', count(*) filter (where record_status = 'awaiting_photo'),
      'referrals_made', (select count(*) from otp_referrals r join scope s on s.id = r.admission_id where r.referred_on between p_start and p_end),
      'referrals_open', (select count(*) from otp_referrals r join scope s on s.id = r.admission_id where r.status in ('referred', 'arrived')),
      'visits_overdue_now', (select count(*) from otp_appointments ap join scope s on s.id = ap.admission_id where ap.status = 'scheduled' and ap.due_on < current_date)
    ) as c,
    jsonb_build_object('recommended', coalesce(sum(rutf_prescribed), 0), 'given', coalesce(sum(rutf_dispensed), 0)) as packets
    from vis
  )
  select jsonb_build_object('period', jsonb_build_array(p_start, p_end), 'min_cell_count', v_min,
    'counts', (select jsonb_object_agg(k, case when (val)::int between 1 and v_min - 1 then null else val end) from jsonb_each(counts.c) e(k, val)),
    'suppressed', (select bool_or((val)::int between 1 and v_min - 1) from jsonb_each(counts.c) e(k, val)),
    'rutf_packets', counts.packets,
    'note', 'Visits by number, the direction of change since the previous visit, referrals and overdue visits. Counts from 1 to ' || (v_min - 1) || ' are hidden. No totals are shown for the split figures, so a hidden count cannot be worked out.')
  into v_out from counts;
  return v_out;
end;
$$;

-- ── Weekly report: section L, corrections with reasons, under review, rejected ───────────────

alter table otp_weekly_reports drop constraint otp_weekly_reports_status_check;
alter table otp_weekly_reports add constraint otp_weekly_reports_status_check
  check (status in ('draft', 'submitted', 'under_review', 'returned', 'approved', 'rejected'));
alter table otp_weekly_report_versions drop constraint otp_weekly_report_versions_decision_check;
alter table otp_weekly_report_versions add constraint otp_weekly_report_versions_decision_check
  check (decision in ('approved', 'returned', 'rejected'));
alter table otp_weekly_report_versions
  add column if not exists adjustments jsonb not null default '[]'::jsonb,   -- the corrections applied to data, with the calculated values
  add column if not exists review_started_by uuid references profiles(id),
  add column if not exists review_started_at timestamptz;

-- A correction of one figure: the calculated value at the time, the corrected value, the reason.
-- Aggregate figures only (no child data), so the values are kept.
create table otp_weekly_report_adjustments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references otp_weekly_reports(id),
  path text not null,                              -- e.g. 'E.SAM.cured.M'
  original numeric,
  adjusted numeric not null,
  reason text not null,
  adjusted_by uuid not null references profiles(id),
  adjusted_at timestamptz not null default now(),
  active boolean not null default true,
  removed_by uuid references profiles(id),
  removed_at timestamptz
);
create unique index otp_weekly_report_adjustments_one_active on otp_weekly_report_adjustments(report_id, path) where active;
alter table otp_weekly_report_adjustments enable row level security;
revoke all on table otp_weekly_report_adjustments from anon, authenticated;
create trigger otp_weekly_report_adjustments_audit after insert or update or delete on otp_weekly_report_adjustments
  for each row execute function audit_row_change();

-- The 0126 engine stays as the base; the report adds section L and its checks.
alter function otp_weekly_report_compute(uuid, date) rename to otp_weekly_report_compute_base;

create or replace function otp_weekly_report_compute(p_facility_id uuid, p_week_start date)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_base jsonb := otp_weekly_report_compute_base(p_facility_id, p_week_start);
  ws date := (v_base -> 'sections' -> 'A' ->> 'week_start')::date;
  we date := ws + 6;
  l jsonb; v_ref jsonb; v_appt jsonb; v_missing int; v_issues jsonb := v_base -> 'issues';
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
      'message', format('RUTF was given at %s visit(s) where none was recommended, each with a clinician''s authorisation recorded', l -> 'rutf' ->> 'given_while_withheld'));
  end if;

  return jsonb_build_object('sections', (v_base -> 'sections') || jsonb_build_object('L', l), 'issues', v_issues);
end;
$$;

-- The active corrections of a report, for display.
create or replace function otp_report_adjustments_list(p_report_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('path', a.path, 'original', a.original, 'adjusted', a.adjusted, 'reason', a.reason,
                                               'by', (select name from profiles where id = a.adjusted_by), 'at', a.adjusted_at) order by a.path), '[]'::jsonb)
  from otp_weekly_report_adjustments a where a.report_id = p_report_id and a.active;
$$;

-- Correct one figure of a draft or returned report, with the reason. p_value null removes the correction.
create or replace function otp_report_adjust(p_report_id uuid, p_path text, p_value numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_rep otp_weekly_reports; v_calc jsonb; v_orig jsonb; v_parts text[] := string_to_array(p_path, '.');
begin
  select * into v_rep from otp_weekly_reports where id = p_report_id and facility_id = v_site.id for update;
  if v_rep.id is null then raise exception 'Report not found at your OTP site'; end if;
  if v_rep.status not in ('draft', 'returned') then raise exception 'This report is % and cannot be changed', v_rep.status; end if;
  if v_parts[1] not in ('B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'L') then raise exception 'This figure cannot be corrected'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason for the correction'; end if;
  v_calc := otp_weekly_report_compute(v_site.id, v_rep.week_start);
  v_orig := (v_calc -> 'sections') #> v_parts;
  if v_orig is null or jsonb_typeof(v_orig) <> 'number' then raise exception 'This figure cannot be corrected'; end if;
  update otp_weekly_report_adjustments set active = false, removed_by = auth.uid(), removed_at = now() where report_id = v_rep.id and path = p_path and active;
  if p_value is not null then
    if p_value < 0 and v_parts[1] not in ('G', 'H') then raise exception 'A count cannot be negative'; end if;
    insert into otp_weekly_report_adjustments (report_id, path, original, adjusted, reason, adjusted_by)
    values (v_rep.id, p_path, (v_orig #>> '{}')::numeric, p_value, trim(p_reason), auth.uid());
  end if;
  update otp_weekly_reports set updated_at = now() where id = v_rep.id;
  return otp_report_adjustments_list(v_rep.id);
end;
$$;

-- Open (replaces 0126): adds the corrections.
create or replace function otp_report_open(p_week_start date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); ws date := lower(otp_week_of(p_week_start))::date; v_rep otp_weekly_reports; v_calc jsonb;
begin
  if ws > current_date then raise exception 'That week has not started yet'; end if;
  select * into v_rep from otp_weekly_reports where facility_id = v_site.id and week_start = ws;
  if v_rep.id is null then
    insert into otp_weekly_reports (project_id, state_id, lga_id, facility_id, week_start, week_end)
    values (v_site.project_id, v_site.state_id, v_site.lga_id, v_site.id, ws, ws + 6) returning * into v_rep;
  end if;
  v_calc := otp_weekly_report_compute(v_site.id, ws);
  return jsonb_build_object('report_id', v_rep.id, 'status', v_rep.status, 'amendment', v_rep.amendment, 'current_version', v_rep.current_version,
    'week_start', ws, 'week_end', ws + 6, 'due', ws + 6 + rutf_threshold(v_site.project_id, 'otp_report_due_days_after', 2)::int,
    'draft_comments', v_rep.draft_comments, 'editable', v_rep.status in ('draft', 'returned'),
    'can_amend', v_rep.status in ('approved', 'rejected'),
    'adjustments', otp_report_adjustments_list(v_rep.id),
    'last_decision', (select jsonb_build_object('decision', decision, 'note', decision_note, 'at', decided_at, 'by', (select name from profiles where id = decided_by))
                      from otp_weekly_report_versions where report_id = v_rep.id and decision is not null order by version desc limit 1),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', version, 'submitted_at', submitted_at, 'decision', decision, 'decided_at', decided_at, 'amendment', amendment) order by version)
                          from otp_weekly_report_versions where report_id = v_rep.id), '[]'::jsonb))
    || v_calc;
end;
$$;

-- Submit (replaces 0126): the corrections are applied to the version's data and kept with the
-- calculated value at submission.
create or replace function otp_report_submit(p_report_id uuid, p_comments jsonb, p_confirm_reviewed boolean, p_amendment_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_rep otp_weekly_reports; v_calc jsonb; v_data jsonb; v_adj jsonb := '[]'::jsonb; v_missing text; v_ver int; c record; a record;
begin
  select * into v_rep from otp_weekly_reports where id = p_report_id and facility_id = v_site.id for update;
  if v_rep.id is null then raise exception 'Report not found at your OTP site'; end if;
  if v_rep.status not in ('draft', 'returned') then raise exception 'This report is % and cannot be submitted again', v_rep.status; end if;
  if v_rep.week_end >= current_date then raise exception 'The week is not over yet: submit from %', v_rep.week_end + 1; end if;
  if coalesce(p_confirm_reviewed, false) is not true then raise exception 'Confirm that you have reviewed the report'; end if;
  if v_rep.amendment and coalesce(trim(p_amendment_reason), '') = '' then raise exception 'Give the reason for amending the report'; end if;
  v_calc := otp_weekly_report_compute(v_site.id, v_rep.week_start);
  select string_agg(x ->> 'message', '; ') into v_missing from jsonb_array_elements(v_calc -> 'issues') x
  where x ->> 'severity' = 'blocking' and coalesce(trim(p_comments ->> (x ->> 'code')), '') = '';
  if v_missing is not null then raise exception 'Explain each flagged issue before submitting: %', v_missing; end if;
  v_data := v_calc -> 'sections';
  for a in select * from otp_weekly_report_adjustments where report_id = v_rep.id and active order by path loop
    if (v_data #> string_to_array(a.path, '.')) is not null then
      v_adj := v_adj || jsonb_build_object('path', a.path, 'calculated', v_data #> string_to_array(a.path, '.'), 'original_when_corrected', a.original,
        'adjusted', a.adjusted, 'reason', a.reason, 'by', (select name from profiles where id = a.adjusted_by), 'at', a.adjusted_at);
      v_data := jsonb_set(v_data, string_to_array(a.path, '.'), to_jsonb(a.adjusted));
    end if;
  end loop;
  v_ver := v_rep.current_version + 1;
  insert into otp_weekly_report_versions (report_id, version, data, issues, comments, amendment, amendment_reason, submitted_by, adjustments)
  values (v_rep.id, v_ver, v_data, v_calc -> 'issues', coalesce(p_comments, '{}'::jsonb), v_rep.amendment, nullif(trim(p_amendment_reason), ''), auth.uid(), v_adj);
  update otp_weekly_reports set status = 'submitted', current_version = v_ver, draft_comments = coalesce(p_comments, '{}'::jsonb), updated_at = now() where id = v_rep.id;
  for c in select id from otp_state_coordinators(v_rep.state_id) loop
    perform otp_notify(c.id, format('Weekly OTP report from %s for the week of %s is waiting for your review%s', v_site.name, to_char(v_rep.week_start, 'DD Mon'),
                       case when v_rep.amendment then ' (amendment)' else '' end), '/weekly-reports/' || v_rep.id);
  end loop;
  return jsonb_build_object('report_id', v_rep.id, 'version', v_ver, 'status', 'submitted', 'adjustments', jsonb_array_length(v_adj));
end;
$$;

-- An approved or rejected report changes only by an amendment (replaces 0126).
create or replace function otp_report_start_amendment(p_report_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_rep otp_weekly_reports;
begin
  select * into v_rep from otp_weekly_reports where id = p_report_id and facility_id = v_site.id for update;
  if v_rep.id is null then raise exception 'Report not found at your OTP site'; end if;
  if v_rep.status not in ('approved', 'rejected') then raise exception 'Only an approved or rejected report is amended'; end if;
  update otp_weekly_reports set status = 'draft', amendment = true, updated_at = now() where id = v_rep.id;
end;
$$;

-- The State Coordinator opens a submitted report for review: "under review".
create or replace function otp_report_start_review(p_report_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rep otp_weekly_reports;
begin
  select * into v_rep from otp_weekly_reports where id = p_report_id for update;
  if v_rep.id is null then raise exception 'Report not found'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and role = 'state_coordinator' and status = 'active' and managed_state_id = v_rep.state_id) then
    raise exception 'Only the State Coordinator for this state reviews the report';
  end if;
  if v_rep.status = 'submitted' then
    update otp_weekly_reports set status = 'under_review', updated_at = now() where id = v_rep.id;
    update otp_weekly_report_versions set review_started_by = auth.uid(), review_started_at = now()
    where report_id = v_rep.id and version = v_rep.current_version and review_started_at is null;
    return jsonb_build_object('report_id', v_rep.id, 'status', 'under_review');
  end if;
  return jsonb_build_object('report_id', v_rep.id, 'status', v_rep.status);
end;
$$;

-- Approve, return for correction or reject (replaces 0126).
create or replace function otp_report_decide(p_report_id uuid, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rep otp_weekly_reports; v_ver otp_weekly_report_versions; v_blocking int; u record;
begin
  select * into v_rep from otp_weekly_reports where id = p_report_id for update;
  if v_rep.id is null then raise exception 'Report not found'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and role = 'state_coordinator' and status = 'active' and managed_state_id = v_rep.state_id) then
    raise exception 'Only the State Coordinator for this state may approve, return or reject the report';
  end if;
  if v_rep.status not in ('submitted', 'under_review') then raise exception 'This report is %, not waiting for review', v_rep.status; end if;
  if p_decision not in ('approved', 'returned', 'rejected') then raise exception 'Decision must be approved, returned or rejected'; end if;
  if p_decision = 'returned' and coalesce(trim(p_note), '') = '' then raise exception 'Say what needs correcting'; end if;
  if p_decision = 'rejected' and coalesce(trim(p_note), '') = '' then raise exception 'Give the reason for rejecting the report'; end if;
  select * into v_ver from otp_weekly_report_versions where report_id = v_rep.id and version = v_rep.current_version;
  if v_ver.submitted_by = auth.uid() then raise exception 'You cannot decide on a report you submitted'; end if;
  if p_decision = 'approved' then
    select count(*) into v_blocking from jsonb_array_elements(v_ver.issues) x
    where x ->> 'severity' = 'blocking' and coalesce(trim(v_ver.comments ->> (x ->> 'code')), '') = '';
    if v_blocking > 0 then raise exception 'Unexplained blocking issues remain: return the report for correction'; end if;
  end if;
  update otp_weekly_report_versions set decision = p_decision, decision_note = nullif(trim(p_note), ''), decided_by = auth.uid(), decided_at = now(),
         review_started_by = coalesce(review_started_by, auth.uid()), review_started_at = coalesce(review_started_at, now())
  where id = v_ver.id;
  update otp_weekly_reports set status = p_decision, amendment = case when p_decision = 'approved' then false else amendment end, updated_at = now() where id = v_rep.id;
  for u in select id from profiles where role = 'dri' and status = 'active' and facility_id = v_rep.facility_id loop
    perform otp_notify(u.id, case p_decision
      when 'approved' then format('Your weekly OTP report for the week of %s was approved', to_char(v_rep.week_start, 'DD Mon'))
      when 'returned' then format('Your weekly OTP report for the week of %s was returned for correction: %s', to_char(v_rep.week_start, 'DD Mon'), trim(p_note))
      else format('Your weekly OTP report for the week of %s was rejected: %s. Start an amendment to submit a new version.', to_char(v_rep.week_start, 'DD Mon'), trim(p_note)) end, null);
  end loop;
  return jsonb_build_object('report_id', v_rep.id, 'status', p_decision, 'version', v_ver.version);
end;
$$;

-- Overview (replaces 0126): adds under review and rejected.
create or replace function otp_reports_overview(p_week_start date, p_lga_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_role user_role := current_user_role(); v_state uuid; ws date := lower(otp_week_of(p_week_start))::date; v_out jsonb;
begin
  if v_role not in ('state_coordinator', 'super_admin', 'project_admin') then raise exception 'Only the State Coordinator and administrators see the weekly reports'; end if;
  select managed_state_id into v_state from profiles where id = auth.uid();
  with sites as (
    select f.* from facilities f
    where f.facility_type = 'health_facility' and f.is_otp_site and f.is_active and f.status = 'approved'
      and (v_role <> 'state_coordinator' or f.state_id = v_state) and (select in_scope(f.project_id))
      and (p_lga_id is null or f.lga_id = p_lga_id)
  ), rows as (
    select s.id facility_id, s.name facility, l.name lga, r.id report_id, coalesce(r.status, 'not_started') status, r.current_version, r.amendment,
           v.submitted_at, v.decided_at, v.issues, v.data, jsonb_array_length(coalesce(v.adjustments, '[]'::jsonb)) adjustments
    from sites s join lgas l on l.id = s.lga_id
    left join otp_weekly_reports r on r.facility_id = s.id and r.week_start = ws
    left join otp_weekly_report_versions v on v.report_id = r.id and v.version = r.current_version
  )
  select jsonb_build_object('week_start', ws, 'week_end', ws + 6,
    'due', ws + 6 + rutf_threshold(current_project_id(), 'otp_report_due_days_after', 2)::int,
    'expected', count(*), 'submitted', count(*) filter (where status = 'submitted'), 'under_review', count(*) filter (where status = 'under_review'),
    'approved', count(*) filter (where status = 'approved'), 'returned', count(*) filter (where status = 'returned'),
    'rejected', count(*) filter (where status = 'rejected'), 'not_submitted', count(*) filter (where status in ('not_started', 'draft')),
    'with_issues', count(*) filter (where jsonb_array_length(coalesce(issues, '[]'::jsonb)) > 0),
    'with_corrections', count(*) filter (where adjustments > 0),
    'stock_discrepancies', count(*) filter (where exists (select 1 from jsonb_array_elements(coalesce(issues, '[]'::jsonb)) x where x ->> 'code' like '%count_discrepancy')),
    'totals', jsonb_build_object(
      'new_cases', coalesce(sum((data -> 'C' -> 'SAM' ->> 'total')::numeric), 0),
      'closing', coalesce(sum((data -> 'F' -> 'SAM' -> 'actual' ->> 'total')::numeric), 0),
      'cured', coalesce(sum((data -> 'E' -> 'SAM' -> 'cured' ->> 'total')::numeric), 0),
      'screened', coalesce(sum((data -> 'I' -> 'total' ->> 'total')::numeric), 0),
      'referrals', coalesce(sum((data -> 'L' -> 'referrals' ->> 'made')::numeric), 0),
      'overdue_visits', coalesce(sum((data -> 'L' -> 'appointments' ->> 'overdue_at_week_end')::numeric), 0)),
    'sites', coalesce(jsonb_agg(jsonb_build_object('facility_id', facility_id, 'facility', facility, 'lga', lga, 'report_id', report_id, 'status', status,
       'version', current_version, 'amendment', amendment, 'submitted_at', submitted_at, 'decided_at', decided_at,
       'issues', coalesce(jsonb_array_length(issues), 0), 'corrections', adjustments,
       'new_cases', data -> 'C' -> 'SAM' ->> 'total', 'closing', data -> 'F' -> 'SAM' -> 'actual' ->> 'total') order by status, lga, facility), '[]'::jsonb))
  into v_out from rows;
  return v_out;
end;
$$;

-- One report (replaces 0126): adds corrections and the review start; can_decide while under review.
create or replace function otp_report_get(p_report_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rep otp_weekly_reports; v_role user_role := current_user_role(); v_me profiles; v_coord boolean;
begin
  select * into v_rep from otp_weekly_reports where id = p_report_id;
  if v_rep.id is null then raise exception 'Report not found'; end if;
  select * into v_me from profiles where id = auth.uid();
  v_coord := v_role = 'state_coordinator' and v_me.managed_state_id = v_rep.state_id;
  if not (v_coord or (v_role in ('super_admin', 'project_admin') and in_scope(v_rep.project_id))
          or (v_role = 'dri' and v_me.facility_id = v_rep.facility_id)) then
    raise exception 'You do not have access to this report';
  end if;
  return jsonb_build_object('report_id', v_rep.id, 'status', v_rep.status, 'amendment', v_rep.amendment, 'week_start', v_rep.week_start, 'week_end', v_rep.week_end,
    'facility', (select name from facilities where id = v_rep.facility_id), 'lga', (select name from lgas where id = v_rep.lga_id),
    'can_decide', v_coord and v_rep.status in ('submitted', 'under_review'),
    'can_start_review', v_coord and v_rep.status = 'submitted',
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', version, 'data', data, 'issues', issues, 'comments', comments, 'adjustments', adjustments,
        'amendment', amendment, 'amendment_reason', amendment_reason, 'submitted_by', (select name from profiles where id = submitted_by), 'submitted_at', submitted_at,
        'review_started_by', (select name from profiles where id = review_started_by), 'review_started_at', review_started_at,
        'decision', decision, 'decision_note', decision_note, 'decided_by', (select name from profiles where id = decided_by), 'decided_at', decided_at) order by version desc)
      from otp_weekly_report_versions where report_id = v_rep.id), '[]'::jsonb));
end;
$$;

-- ── Grants: functions only ───────────────────────────────────────────────────────────────────
revoke execute on function otp_oedema_grade(text), otp_direction(numeric, numeric, int), otp_recovery_assessment(uuid, int, jsonb),
  otp_next_step(uuid), otp_weekly_report_compute(uuid, date), otp_weekly_report_compute_base(uuid, date), otp_report_adjustments_list(uuid)
  from public, anon, authenticated;
revoke execute on function otp_record_visit(jsonb), otp_attach_visit_photo(uuid, text, boolean), otp_visit_photo_paths(uuid), otp_reschedule_visit(jsonb),
  otp_refer_child(jsonb), otp_update_referral(uuid, text, text), otp_my_visits(), otp_child_lookup(text),
  otp_followup_aggregates(date, date, uuid, uuid), otp_report_adjust(uuid, text, numeric, text), otp_report_open(date),
  otp_report_submit(uuid, jsonb, boolean, text), otp_report_start_amendment(uuid), otp_report_start_review(uuid), otp_report_decide(uuid, text, text),
  otp_reports_overview(date, uuid), otp_report_get(uuid) from public, anon;
grant execute on function otp_record_visit(jsonb), otp_attach_visit_photo(uuid, text, boolean), otp_visit_photo_paths(uuid), otp_reschedule_visit(jsonb),
  otp_refer_child(jsonb), otp_update_referral(uuid, text, text), otp_my_visits(), otp_child_lookup(text),
  otp_followup_aggregates(date, date, uuid, uuid), otp_report_adjust(uuid, text, numeric, text), otp_report_open(date),
  otp_report_submit(uuid, jsonb, boolean, text), otp_report_start_amendment(uuid), otp_report_start_review(uuid), otp_report_decide(uuid, text, text),
  otp_reports_overview(date, uuid), otp_report_get(uuid) to authenticated;
