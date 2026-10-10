-- RUTF Monitoring Platform — migration 0124
-- Digital OTP Admission Card: child registry, admission episodes, visits, routine medication,
-- RUTF ration and outcomes, with a rules engine built from the approved guideline booklet
-- (docs/otp-digitisation/RULEBOOK.md; DECISIONS R142).
--
-- PRIVACY (the user's rule, 10 Oct 2026): a child's and caregiver's details can be seen ONLY by an
-- OTP Officer, and only by entering that child's Child ID. Everyone else on the platform — and an
-- OTP Officer who has not entered an ID — sees aggregate figures only (by sex, age group, place,
-- period), with small counts suppressed.
--   • Every table here has row-level security ON and NO policies, and no table privileges for
--     anon/authenticated: nothing is readable or writable directly through the API.
--   • All access goes through SECURITY DEFINER functions that check the caller:
--       otp_child_lookup(child_code)   — OTP Officer at the child's current OTP site; logged
--       register / admit / visit / medication / outcome / transfer functions — same check
--       otp_aggregates(...)            — any signed-in user in scope; counts only, no rows
--   • Names, caregiver, address and phone live in their own table (otp_child_identity).
--   • The audit trail records who changed what and when, but NOT the values (the platform's
--     audit_row_change() copies values, which administrators can read).
--
-- CLINICAL RULES: thresholds and the RUTF ration table are data in a versioned rule set
-- (otp_rule_sets), seeded as status 'draft' with their source references. Rules the clinical
-- authority has not settled (RULEBOOK Q1–Q22) are not guessed: the engine returns
-- "needs clinical review" for those cases, and every result states the rule set and its status.
-- Child IDs are issued by the server only (registration needs a connection), so two phones can
-- never issue the same ID.

-- ── Configuration ────────────────────────────────────────────────────────────────────────────

create table otp_rule_sets (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,                   -- e.g. 2026-10-draft
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  effective_from date,
  approved_by text,                               -- the clinical authority, by name and role
  approved_at timestamptz,
  source text not null,                           -- the documents the rules come from
  params jsonb not null,                          -- thresholds; see the seed below
  created_at timestamptz not null default now()
);

create table otp_ration_bands (
  rule_set_id uuid not null references otp_rule_sets(id) on delete cascade,
  min_kg numeric(5,1) not null,
  max_kg numeric(5,1),                            -- null = and above
  packets_per_day numeric(3,1) not null,
  packets_per_week int not null,
  source_ref text not null,                       -- e.g. "G6 row X1"
  primary key (rule_set_id, min_kg)
);

-- Child ID per LGA: prefix (default STATE-LGA abbreviation, e.g. KT-DAU), year and a running number.
create table otp_child_id_config (
  lga_id uuid primary key references lgas(id),
  prefix text not null check (prefix ~ '^[A-Z0-9-]{2,20}$'),
  include_year boolean not null default true,
  digits int not null default 5 check (digits between 4 and 8),
  next_number int not null default 1 check (next_number > 0),
  updated_at timestamptz not null default now()
);

-- Which OTP sites also use weight-for-height (G5: MUAC and oedema everywhere; WFH "if used").
alter table facilities add column if not exists otp_uses_wfh boolean not null default false;

-- ── Records (no direct access: functions only) ───────────────────────────────────────────────

create table otp_children (
  id uuid primary key default gen_random_uuid(),
  child_code text not null unique,                -- the Child ID: permanent, never reused
  project_id uuid references projects(id),
  state_id uuid not null references states(id),
  lga_id uuid not null references lgas(id),
  facility_id uuid not null references facilities(id),   -- current OTP site (changes on transfer)
  registered_facility_id uuid not null references facilities(id),
  sex text not null check (sex in ('M', 'F')),
  date_of_birth date,                             -- if known
  age_months_at_registration int not null check (age_months_at_registration between 0 and 120),
  registered_at timestamptz not null default now(),
  registered_by uuid references profiles(id),
  client_id uuid unique                           -- the phone's id for the submission (idempotent sync)
);
create index otp_children_facility_idx on otp_children(facility_id);
create index otp_children_lga_idx on otp_children(lga_id);

create table otp_child_identity (
  child_id uuid primary key references otp_children(id) on delete cascade,
  child_name text not null,
  caregiver_name text,
  physical_address text,
  mobile_number text,
  updated_at timestamptz not null default now()
);

-- Every screening, admitted or not: no identity, for the screening-outcome figures.
create table otp_screenings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  facility_id uuid not null references facilities(id),
  lga_id uuid not null references lgas(id),
  screened_on date not null default current_date,
  sex text check (sex in ('M', 'F')),
  age_months int,
  inputs jsonb not null,                          -- measurements and checks as entered
  result jsonb not null,                          -- the engine's answer, with the rule set
  classification text,
  pathway text,
  child_id uuid references otp_children(id),      -- set when the screening led to registration
  recorded_by uuid references profiles(id),
  recorded_at timestamptz not null default now(),
  client_id uuid unique
);
create index otp_screenings_facility_idx on otp_screenings(facility_id, screened_on);

-- One treatment episode per admission (a child may have several over time).
create table otp_admissions (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references otp_children(id),
  facility_id uuid not null references facilities(id),
  admitted_on date not null default current_date,
  admission_type text not null check (admission_type in ('new_case', 'from_stabilisation', 'transfer_from_otp', 'returned_defaulter')),
  admission_source text check (admission_source in ('community', 'self', 'other_centre', 'inpatient')),
  readmission boolean not null default false,     -- as on the card (C1); meaning awaits RULEBOOK Q8
  relapse boolean not null default false,
  walking_hours numeric(4,1),
  admission_criteria text[] not null default '{}',-- muac / oedema / wfh
  weight_kg numeric(5,1),
  height_cm numeric(5,1),
  muac_cm numeric(4,1),
  oedema text check (oedema in ('absent', '+', '++', '+++')),
  wfh_z numeric(4,2),
  screening_id uuid references otp_screenings(id),
  rule_set_id uuid not null references otp_rule_sets(id),
  status text not null default 'active' check (status in ('active', 'closed')),
  outcome text check (outcome in ('cured', 'defaulted', 'died', 'non_recovered', 'transferred_inpatient', 'refused_inpatient', 'transferred_otp')),
  outcome_on date,
  outcome_reason text,
  outcome_confirmed_by uuid references profiles(id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create unique index otp_admissions_one_active on otp_admissions(child_id) where status = 'active';
create index otp_admissions_facility_idx on otp_admissions(facility_id, admitted_on);

create table otp_visits (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references otp_admissions(id),
  visit_number int not null check (visit_number between 1 and 52),
  visit_on date not null,
  attended boolean not null default true,         -- false = absent (outcome code A)
  weight_kg numeric(5,1),
  height_cm numeric(5,1),
  muac_cm numeric(4,1),
  oedema text check (oedema in ('absent', '+', '++', '+++')),
  wfh_z numeric(4,2),
  diarrhoea_days int, vomiting_days int, fever_days int, cough_days int,
  appetite_test text check (appetite_test in ('good', 'poor', 'refused')),
  temperature_c numeric(4,1),
  respiratory_rate int,
  dehydrated boolean, pallor boolean, superficial_infection boolean,
  action_required boolean, action_details text,
  ration_band_min_kg numeric(5,1),                -- the ration rule used
  rutf_prescribed int,                            -- packets, from the ration table
  rutf_dispensed int,                             -- packets actually given
  dispense_note text,                             -- required when dispensed ≠ prescribed
  alerts text[] not null default '{}',
  examiner_initials text,
  rule_set_id uuid not null references otp_rule_sets(id),
  recorded_by uuid references profiles(id),
  recorded_at timestamptz not null default now(),
  client_id uuid unique,
  unique (admission_id, visit_number)
);

create table otp_medications (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references otp_admissions(id),
  medication text not null check (medication in ('amoxicillin', 'malaria_test', 'antimalarial', 'measles', 'deworming', 'vitamin_a', 'other')),
  status text not null check (status in ('given', 'not_given', 'already_given', 'test_positive', 'test_negative')),
  given_on date not null default current_date,
  visit_number int,
  dose_text text,                                 -- as given: the booklet states no doses (RULEBOOK Q10)
  reason text,
  recorded_by uuid references profiles(id),
  recorded_at timestamptz not null default now(),
  client_id uuid unique
);

create table otp_access_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid not null,
  child_id uuid not null references otp_children(id),
  action text not null                            -- 'lookup', 'register', 'update_identity', 'transfer'
);

do $$
declare t text;
begin
  foreach t in array array['otp_rule_sets', 'otp_ration_bands', 'otp_child_id_config', 'otp_children',
                           'otp_child_identity', 'otp_screenings', 'otp_admissions', 'otp_visits',
                           'otp_medications', 'otp_access_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
  end loop;
end $$;

-- Audit without values: the table, the row, the action and the names of the fields changed.
create or replace function otp_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_fields jsonb := '[]'::jsonb;
  k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if k <> 'updated_at' and (v_old -> k) is distinct from (v_new -> k) then v_fields := v_fields || to_jsonb(k); end if;
    end loop;
    if v_fields = '[]'::jsonb then return null; end if;
  end if;
  insert into audit_log (actor, table_name, row_id, action, changes, project_id)
  values (auth.uid(), tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'child_id', v_row ->> 'lga_id'), lower(tg_op),
          jsonb_build_object('fields_changed', v_fields, 'values', 'not recorded (child-level data)'),
          (select project_id from otp_children where id = coalesce((v_row ->> 'child_id')::uuid, (v_row ->> 'id')::uuid)
           union all select null limit 1));
  return null;
end;
$$;
revoke execute on function otp_audit() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['otp_children', 'otp_child_identity', 'otp_admissions', 'otp_visits', 'otp_medications'] loop
    execute format('create trigger %1$s_audit after update or delete on %1$s for each row execute function otp_audit()', t);
  end loop;
  -- configuration changes are recorded with their values (not child data)
  foreach t in array array['otp_rule_sets', 'otp_ration_bands', 'otp_child_id_config'] loop
    execute format('create trigger %1$s_audit after insert or update or delete on %1$s for each row execute function audit_row_change()', t);
  end loop;
end $$;

-- ── Seed: the rule set from the guideline booklet (status draft until the clinical authority signs) ──

insert into otp_rule_sets (version, status, source, params) values (
  '2026-10-draft', 'draft',
  'Plan of admission and Rate of Distribution RUTF (UNICEF/FMOH booklet, pages G1–G7); RUTP OTP Admission Card (C1–C2). See docs/otp-digitisation/RULEBOOK.md.',
  jsonb_build_object(
    'min_age_months', 6,                 -- G4/G5: < 6 months → stabilisation
    'max_age_months', 59,                -- G5: children 6–59 months
    'muac_sam_below', 11.5,              -- G1 S1: MUAC < 11.5 cm
    'muac_normal_above', 12.5,           -- G1 S3: MUAC > 12.5 cm
    'wfh_sam_below', -3,                 -- G1 S1: WFH < −3 Z
    'wfh_normal_above', -2,              -- G1 S3: WFH > −2 Z
    'stabilisation_weight_below', 3.5,   -- G4 P2: > 6 months and < 3.5 kg (RULEBOOK Q2: may be 4 kg)
    'discharge_min_weeks_muac', 8,       -- G7 D1
    'discharge_muac_above', 11.5,        -- G7 D1–D3 (RULEBOOK Q15)
    'discharge_wfh_above', -2,           -- G7 D3
    'discharge_consecutive_visits', 2,   -- G7 D2, D3
    'defaulter_consecutive_absences', 3, -- C2 outcome D
    'no_weight_change_visit', 4,         -- C2 footnote F2
    'deworming_visit', 2,                -- G6 R5
    'plausible', jsonb_build_object(     -- data-entry checks only, not clinical rules (RULEBOOK Q4)
      'weight_kg', jsonb_build_array(1.0, 30.0), 'height_cm', jsonb_build_array(40.0, 130.0),
      'muac_cm', jsonb_build_array(6.0, 25.0), 'wfh_z', jsonb_build_array(-6.0, 6.0),
      'temperature_c', jsonb_build_array(30.0, 43.0), 'respiratory_rate', jsonb_build_array(10, 120)),
    'open_questions', jsonb_build_array('Q1','Q2','Q3','Q4','Q5','Q6','Q7','Q8','Q9','Q10','Q11','Q12','Q13','Q14','Q15','Q16','Q17','Q18','Q19','Q20','Q21','Q22')
  ));

insert into otp_ration_bands (rule_set_id, min_kg, max_kg, packets_per_day, packets_per_week, source_ref)
select r.id, b.min_kg, b.max_kg, b.per_day, b.per_week, b.ref
from otp_rule_sets r,
  (values (4.0, 5.4, 2.0, 14, 'G6 row X1'), (5.5, 6.9, 2.5, 18, 'G6 row X2'), (7.0, 8.4, 3.0, 21, 'G6 row X3'),
          (8.5, 9.4, 3.5, 25, 'G6 row X4'), (9.5, 10.4, 4.0, 28, 'G6 row X5'), (10.5, 11.9, 4.5, 32, 'G6 row X6'),
          (12.0, null, 5.0, 35, 'G6 row X7')) as b(min_kg, max_kg, per_day, per_week, ref)
where r.version = '2026-10-draft';
-- Row X0 (3.5–3.9 kg, 1½ a day, 11 a week) is struck through by hand in the booklet: not seeded (RULEBOOK Q2).

-- Child ID prefixes: STATE-LGA abbreviation for every LGA (editable per LGA).
insert into otp_child_id_config (lga_id, prefix)
select l.id, left(upper(regexp_replace(s.code || '-' || coalesce(l.abbr, l.code), '[^A-Za-z0-9-]', '', 'g')), 20) from lgas l join states s on s.id = l.state_id
where length(regexp_replace(s.code || '-' || coalesce(l.abbr, l.code, ''), '[^A-Za-z0-9-]', '', 'g')) >= 2
on conflict (lga_id) do nothing;

-- ── Helpers ──────────────────────────────────────────────────────────────────────────────────

-- The rule set in force: the latest approved one effective today, else the latest draft.
create or replace function otp_current_rule_set()
returns otp_rule_sets language sql stable security definer set search_path = public as $$
  select * from otp_rule_sets
  where status = 'draft' or (status = 'approved' and (effective_from is null or effective_from <= current_date))
  order by (status = 'approved') desc, effective_from desc nulls last, created_at desc
  limit 1;
$$;

-- The calling OTP Officer's OTP site, or an error.
create or replace function otp_officer_site()
returns facilities language plpgsql stable security definer set search_path = public as $$
declare v_fac facilities;
begin
  select f.* into v_fac from profiles p join facilities f on f.id = p.facility_id
  where p.id = auth.uid() and p.role = 'dri' and p.status = 'active'
    and f.facility_type = 'health_facility' and f.is_otp_site and f.is_active;
  if v_fac.id is null then
    raise exception 'Only an OTP Officer at an active OTP site may use the OTP Admission Card';
  end if;
  return v_fac;
end;
$$;

-- The child with this ID, at the calling OTP Officer's own site, or an error.
create or replace function otp_child_at_my_site(p_child_code text)
returns otp_children language plpgsql stable security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_child otp_children;
begin
  select * into v_child from otp_children where child_code = upper(trim(p_child_code));
  if v_child.id is null then raise exception 'No child with this Child ID'; end if;
  if v_child.facility_id <> v_site.id then
    raise exception 'This child is registered at another OTP site; a transfer is needed before you can open the record';
  end if;
  return v_child;
end;
$$;

-- RUTF ration for a weight, from the rule set's table. Null band = no rule for this weight.
create or replace function otp_ration(p_weight_kg numeric, p_rule_set_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rs otp_rule_sets; v_band otp_ration_bands;
begin
  if p_rule_set_id is null then v_rs := otp_current_rule_set(); else select * into v_rs from otp_rule_sets where id = p_rule_set_id; end if;
  if p_weight_kg is null then
    return jsonb_build_object('ok', false, 'reason', 'A valid weight is needed before the ration can be worked out', 'rule_set', v_rs.version, 'rule_status', v_rs.status);
  end if;
  select * into v_band from otp_ration_bands
  where rule_set_id = v_rs.id and p_weight_kg >= min_kg and (max_kg is null or p_weight_kg <= max_kg)
  order by min_kg desc limit 1;
  if v_band.min_kg is null then
    return jsonb_build_object('ok', false, 'weight_kg', p_weight_kg,
      'reason', 'No ration rule for this weight in the approved table (below 4 kg the row is struck out, RULEBOOK Q2; or between bands, Q4): refer for clinical review',
      'rule_set', v_rs.version, 'rule_status', v_rs.status);
  end if;
  return jsonb_build_object('ok', true, 'weight_kg', p_weight_kg, 'band_min_kg', v_band.min_kg, 'band_max_kg', v_band.max_kg,
    'packets_per_day', v_band.packets_per_day, 'packets_per_week', v_band.packets_per_week,
    'source', v_band.source_ref || ' (92 g packets)', 'rule_set', v_rs.version, 'rule_status', v_rs.status);
end;
$$;

-- ── The screening and pathway engine (RULEBOOK §1–§3) ─────────────────────────────────────────
-- Input (jsonb): age_months, sex, weight_kg, height_cm, muac_cm, oedema (absent|+|++|+++),
--   wfh_z (only where the site uses WFH), medical_complications (true/false), appetite_test (pass|fail).
-- Output: classification, pathway, next_action, reasons[], missing[], errors[], review[] (open rules).

create or replace function otp_evaluate_screening(p jsonb, p_uses_wfh boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_rs otp_rule_sets := otp_current_rule_set();
  pr jsonb := v_rs.params;
  age int := nullif(p ->> 'age_months', '')::int;
  wt numeric := nullif(p ->> 'weight_kg', '')::numeric;
  muac numeric := nullif(p ->> 'muac_cm', '')::numeric;
  wfh numeric := case when p_uses_wfh then nullif(p ->> 'wfh_z', '')::numeric end;
  oed text := nullif(p ->> 'oedema', '');
  comp boolean := (p ->> 'medical_complications')::boolean;
  appetite text := nullif(p ->> 'appetite_test', '');
  missing text[] := '{}'; errors text[] := '{}'; reasons text[] := '{}'; review text[] := '{}';
  sam boolean := false; mam boolean := false; normal boolean := false; muac_band text; wfh_band text;
  pathway text; classification text; next_action text;
  k text; rng jsonb;
begin
  -- Required inputs (G5: every centre uses MUAC and oedema; age decides eligibility).
  if age is null then missing := missing || 'Age in months'::text; end if;
  if muac is null then missing := missing || 'MUAC (cm)'::text; end if;
  if oed is null then missing := missing || 'Bilateral pitting oedema'::text; end if;
  if wt is null then missing := missing || 'Weight (kg)'::text; end if;
  if p_uses_wfh and wfh is null then missing := missing || 'Weight-for-height Z-score (this site uses WFH)'::text; end if;
  if oed is not null and oed not in ('absent', '+', '++', '+++') then errors := errors || 'Oedema must be absent, +, ++ or +++'::text; end if;

  -- Plausibility (data-entry checks, RULEBOOK Q4).
  foreach k in array array['weight_kg', 'height_cm', 'muac_cm', 'wfh_z'] loop
    rng := pr -> 'plausible' -> k;
    if nullif(p ->> k, '') is not null and rng is not null and
       ((p ->> k)::numeric < (rng ->> 0)::numeric or (p ->> k)::numeric > (rng ->> 1)::numeric) then
      errors := errors || format('%s of %s is outside %s–%s: check the measurement', k, p ->> k, rng ->> 0, rng ->> 1);
    end if;
  end loop;

  if array_length(errors, 1) > 0 then
    return jsonb_build_object('classification', null, 'pathway', 'correct_inputs', 'next_action', 'Correct the values marked, then evaluate again',
      'errors', to_jsonb(errors), 'missing', to_jsonb(missing), 'reasons', '[]'::jsonb, 'review', '[]'::jsonb,
      'rule_set', v_rs.version, 'rule_status', v_rs.status);
  end if;

  -- Age (G4, G5).
  if age is not null and age < (pr ->> 'min_age_months')::int then
    return jsonb_build_object('classification', 'under_6_months', 'pathway', 'stabilisation',
      'next_action', 'Refer to stabilisation care: children under 6 months are not treated in OTP (G4)',
      'reasons', jsonb_build_array('Age under 6 months'), 'missing', to_jsonb(missing), 'errors', '[]'::jsonb, 'review', '[]'::jsonb,
      'rule_set', v_rs.version, 'rule_status', v_rs.status);
  end if;
  if age is not null and age > (pr ->> 'max_age_months')::int then
    return jsonb_build_object('classification', 'over_59_months', 'pathway', 'clinical_review',
      'next_action', 'Refer for qualified clinical review: this protocol covers children 6–59 months',
      'reasons', jsonb_build_array('Age over 59 months'), 'missing', to_jsonb(missing), 'errors', '[]'::jsonb, 'review', jsonb_build_array('Outside 6–59 months'),
      'rule_set', v_rs.version, 'rule_status', v_rs.status);
  end if;

  if muac is null or oed is null then
    return jsonb_build_object('classification', null, 'pathway', 'incomplete', 'next_action', 'Record the missing measurements before any decision',
      'missing', to_jsonb(missing), 'errors', '[]'::jsonb, 'reasons', '[]'::jsonb, 'review', '[]'::jsonb, 'rule_set', v_rs.version, 'rule_status', v_rs.status);
  end if;

  -- MUAC band (G1). Exactly 11.5 or 12.5 falls in no band (RULEBOOK Q1).
  if muac < (pr ->> 'muac_sam_below')::numeric then muac_band := 'red';
  elsif muac > (pr ->> 'muac_sam_below')::numeric and muac < (pr ->> 'muac_normal_above')::numeric then muac_band := 'yellow';
  elsif muac > (pr ->> 'muac_normal_above')::numeric then muac_band := 'green';
  else muac_band := 'boundary'; review := review || format('MUAC exactly %s cm is not classified by the booklet (Q1)', muac); end if;
  if wfh is not null then
    if wfh < (pr ->> 'wfh_sam_below')::numeric then wfh_band := 'sam';
    elsif wfh > (pr ->> 'wfh_sam_below')::numeric and wfh < (pr ->> 'wfh_normal_above')::numeric then wfh_band := 'mam';
    elsif wfh > (pr ->> 'wfh_normal_above')::numeric then wfh_band := 'normal';
    else wfh_band := 'boundary'; review := review || format('WFH exactly %s Z is not classified by the booklet (Q1)', wfh); end if;
  end if;

  sam := muac_band = 'red' or wfh_band = 'sam' or oed in ('+', '++', '+++');
  if sam then
    classification := 'SAM';
    if muac_band = 'red' then reasons := reasons || 'MUAC under 11.5 cm'::text; end if;
    if wfh_band = 'sam' then reasons := reasons || 'WFH under −3 Z'::text; end if;
    if oed in ('+', '++', '+++') then reasons := reasons || format('Bilateral pitting oedema %s', oed); end if;
  else
    mam := (muac_band = 'yellow' or wfh_band = 'mam') and oed = 'absent';
    normal := muac_band = 'green' and (wfh_band is null or wfh_band = 'normal') and oed = 'absent';
    if mam then classification := 'MAM'; elsif normal then classification := 'Normal'; else classification := 'undetermined'; end if;
  end if;

  if array_length(review, 1) > 0 and not sam then
    return jsonb_build_object('classification', classification, 'pathway', 'clinical_review',
      'next_action', 'Refer for qualified clinical review: the measurements fall on a boundary the booklet does not classify',
      'reasons', to_jsonb(reasons), 'missing', to_jsonb(missing), 'errors', '[]'::jsonb, 'review', to_jsonb(review), 'rule_set', v_rs.version, 'rule_status', v_rs.status);
  end if;

  if sam then
    -- Stabilisation criteria (G4 P2): any one sends the child to stabilisation care.
    if oed = '+++' then pathway := 'stabilisation'; reasons := reasons || 'Severe oedema (+++)'::text; end if;
    if oed in ('+', '++', '+++') and (muac_band = 'red' or wfh_band = 'sam') then
      pathway := 'stabilisation'; reasons := reasons || 'Marasmic kwashiorkor: wasting with oedema (Q3 to confirm)'::text;
    end if;
    if wt is not null and wt < (pr ->> 'stabilisation_weight_below')::numeric then
      pathway := 'stabilisation'; reasons := reasons || format('Weight under %s kg', pr ->> 'stabilisation_weight_below');
    elsif wt is not null and wt < 4.0 then
      review := review || 'Weight 3.5–3.9 kg: the ration row is struck out and the threshold may be 4 kg (Q2)'::text;
    end if;
    if comp is true then pathway := 'stabilisation'; reasons := reasons || 'Medical complications'::text; end if;
    if appetite = 'fail' then pathway := 'stabilisation'; reasons := reasons || 'Failed the appetite test for RUTF'::text; end if;

    if pathway = 'stabilisation' then
      next_action := 'Refer urgently to stabilisation care. Do not start routine OTP treatment (G4)';
    else
      if comp is null then missing := missing || 'Medical complications: yes or no'::text; end if;
      if appetite is null then missing := missing || 'Appetite test for RUTF: pass or fail'::text; end if;
      if array_length(review, 1) > 0 then
        pathway := 'clinical_review'; next_action := 'Refer for qualified clinical review before admission';
      elsif array_length(missing, 1) > 0 then
        pathway := 'incomplete'; next_action := 'Record the missing checks: admission to OTP needs every OTP criterion met (G5)';
      else
        pathway := 'otp'; next_action := 'Admit to the Outpatient Therapeutic Programme: SAM, no medical complications, passed the appetite test (G4, G5)';
        reasons := reasons || 'No medical complications'::text || 'Passed the appetite test'::text;
      end if;
    end if;
  elsif classification = 'MAM' then
    if comp is true then pathway := 'inpatient_paediatric'; next_action := 'Refer to inpatient paediatric care: moderate acute malnutrition with medical complications (G1)';
    else pathway := 'nutrition_advice'; next_action := 'Give nutritional advice or refer to the Supplementary Feeding Programme if available (G1)'; end if;
    reasons := reasons || 'Moderate acute malnutrition'::text;
  elsif classification = 'Normal' then
    pathway := 'praise_advice'; next_action := 'Praise the caregiver and give advice so good nutrition is sustained (G1)';
  else
    pathway := 'clinical_review'; next_action := 'Refer for qualified clinical review: the findings do not match a class in the booklet';
  end if;

  return jsonb_build_object('classification', classification, 'pathway', pathway, 'next_action', next_action,
    'muac_band', muac_band, 'wfh_band', wfh_band,
    'reasons', to_jsonb(reasons), 'missing', to_jsonb(missing), 'errors', '[]'::jsonb, 'review', to_jsonb(review),
    'rule_set', v_rs.version, 'rule_status', v_rs.status);
end;
$$;

-- ── OTP Officer functions ────────────────────────────────────────────────────────────────────

-- Screen a child (any child presented; no identity stored). Returns the engine's answer and the
-- screening id to register with.
create or replace function otp_screen(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_res jsonb; v_id uuid;
begin
  if nullif(p ->> 'client_id', '') is not null then
    select id, result into v_id, v_res from otp_screenings where client_id = (p ->> 'client_id')::uuid;
    if v_id is not null then return v_res || jsonb_build_object('screening_id', v_id, 'duplicate_submission', true); end if;
  end if;
  v_res := otp_evaluate_screening(p, v_site.otp_uses_wfh);
  insert into otp_screenings (project_id, facility_id, lga_id, sex, age_months, inputs, result, classification, pathway, recorded_by, client_id)
  values (v_site.project_id, v_site.id, v_site.lga_id, nullif(p ->> 'sex', ''), nullif(p ->> 'age_months', '')::int,
          p - 'client_id', v_res, v_res ->> 'classification', v_res ->> 'pathway', auth.uid(), nullif(p ->> 'client_id', '')::uuid)
  returning id into v_id;
  return v_res || jsonb_build_object('screening_id', v_id);
end;
$$;

-- Register and admit a new case after a screening whose pathway is OTP. Issues the Child ID.
-- p: screening_id, child_name, caregiver_name, physical_address, mobile_number, sex, date_of_birth,
--    admission_source, walking_hours, readmission, relapse, confirm_not_duplicate, client_id.
create or replace function otp_register_child(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_site facilities := otp_officer_site();
  v_scr otp_screenings; v_cfg otp_child_id_config; v_rs otp_rule_sets := otp_current_rule_set();
  v_code text; v_child uuid; v_adm uuid; v_dups jsonb; v_criteria text[] := '{}';
begin
  if nullif(p ->> 'client_id', '') is not null then
    select c.child_code into v_code from otp_children c where c.client_id = (p ->> 'client_id')::uuid;
    if v_code is not null then return jsonb_build_object('child_code', v_code, 'duplicate_submission', true); end if;
  end if;
  select * into v_scr from otp_screenings where id = (p ->> 'screening_id')::uuid and facility_id = v_site.id;
  if v_scr.id is null then raise exception 'Screen the child at this OTP site first'; end if;
  if v_scr.pathway <> 'otp' then
    raise exception 'This child is not eligible for OTP admission: %', v_scr.result ->> 'next_action';
  end if;
  if v_scr.child_id is not null then raise exception 'This screening has already been used to register a child'; end if;
  if coalesce(trim(p ->> 'child_name'), '') = '' then raise exception 'The child''s name is required'; end if;
  if coalesce(p ->> 'sex', v_scr.sex) is null or coalesce(p ->> 'sex', v_scr.sex) not in ('M', 'F') then raise exception 'Sex is required (M or F)'; end if;

  -- Possible duplicate: same LGA, same sex, a similar name and caregiver, age within 3 months.
  if coalesce((p ->> 'confirm_not_duplicate')::boolean, false) is not true then
    select jsonb_agg(c.child_code) into v_dups from otp_children c join otp_child_identity i on i.child_id = c.id
    where c.lga_id = v_site.lga_id and c.sex = coalesce(p ->> 'sex', v_scr.sex)
      and lower(i.child_name) = lower(trim(p ->> 'child_name'))
      and (coalesce(lower(i.caregiver_name), '') = coalesce(lower(trim(p ->> 'caregiver_name')), '') or i.caregiver_name is null)
      and abs((c.age_months_at_registration + (extract(year from age(now(), c.registered_at)) * 12 + extract(month from age(now(), c.registered_at)))::int)
              - v_scr.age_months) <= 3;
    if v_dups is not null then
      return jsonb_build_object('possible_duplicate', true, 'child_codes', v_dups,
        'next_action', 'A child with the same name, caregiver, sex and age is already registered in this LGA. Open that Child ID to check; register again only if it is a different child (confirm_not_duplicate).');
    end if;
  end if;

  -- The Child ID: the LGA's prefix, the year and the next number, under a row lock (no duplicates
  -- under concurrent registration).
  select * into v_cfg from otp_child_id_config where lga_id = v_site.lga_id for update;
  if v_cfg.lga_id is null then raise exception 'No Child ID settings for this LGA: ask an administrator to set them'; end if;
  v_code := v_cfg.prefix || case when v_cfg.include_year then '-' || to_char(current_date, 'YY') else '' end
            || '-' || lpad(v_cfg.next_number::text, v_cfg.digits, '0');
  update otp_child_id_config set next_number = next_number + 1, updated_at = now() where lga_id = v_site.lga_id;

  insert into otp_children (child_code, project_id, state_id, lga_id, facility_id, registered_facility_id, sex, date_of_birth,
                            age_months_at_registration, registered_by, client_id)
  values (v_code, v_site.project_id, v_site.state_id, v_site.lga_id, v_site.id, v_site.id, coalesce(p ->> 'sex', v_scr.sex),
          nullif(p ->> 'date_of_birth', '')::date, v_scr.age_months, auth.uid(), nullif(p ->> 'client_id', '')::uuid)
  returning id into v_child;
  insert into otp_child_identity (child_id, child_name, caregiver_name, physical_address, mobile_number)
  values (v_child, trim(p ->> 'child_name'), nullif(trim(p ->> 'caregiver_name'), ''), nullif(trim(p ->> 'physical_address'), ''), nullif(trim(p ->> 'mobile_number'), ''));

  if v_scr.result ->> 'muac_band' = 'red' then v_criteria := v_criteria || 'muac'::text; end if;
  if v_scr.inputs ->> 'oedema' in ('+', '++') then v_criteria := v_criteria || 'oedema'::text; end if;
  if v_scr.result ->> 'wfh_band' = 'sam' then v_criteria := v_criteria || 'wfh'::text; end if;
  insert into otp_admissions (child_id, facility_id, admission_type, admission_source, readmission, relapse, walking_hours,
                              admission_criteria, weight_kg, height_cm, muac_cm, oedema, wfh_z, screening_id, rule_set_id, created_by)
  values (v_child, v_site.id, 'new_case', nullif(p ->> 'admission_source', ''), coalesce((p ->> 'readmission')::boolean, false),
          coalesce((p ->> 'relapse')::boolean, false), nullif(p ->> 'walking_hours', '')::numeric, v_criteria,
          nullif(v_scr.inputs ->> 'weight_kg', '')::numeric, nullif(v_scr.inputs ->> 'height_cm', '')::numeric,
          nullif(v_scr.inputs ->> 'muac_cm', '')::numeric, v_scr.inputs ->> 'oedema', nullif(v_scr.inputs ->> 'wfh_z', '')::numeric,
          v_scr.id, v_rs.id, auth.uid())
  returning id into v_adm;
  update otp_screenings set child_id = v_child where id = v_scr.id;
  insert into otp_access_log (actor, child_id, action) values (auth.uid(), v_child, 'register');

  return jsonb_build_object('child_code', v_code, 'admission_type', 'new_case',
    'ration', otp_ration(nullif(v_scr.inputs ->> 'weight_kg', '')::numeric, v_rs.id),
    'due_medications', otp_due_medications_for(v_adm));
end;
$$;

-- Routine medication due for an admission (G6), with what is already recorded. Doses are not
-- calculated: the booklet gives none (RULEBOOK Q10).
create or replace function otp_due_medications_for(p_admission_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_adm otp_admissions; v_rs otp_rule_sets; v_out jsonb := '[]'::jsonb; v_given jsonb; m record;
begin
  select * into v_adm from otp_admissions where id = p_admission_id;
  select * into v_rs from otp_rule_sets where id = v_adm.rule_set_id;
  select coalesce(jsonb_object_agg(medication, status), '{}'::jsonb) into v_given from otp_medications where admission_id = p_admission_id;
  for m in select * from (values
      ('amoxicillin', 'Antibiotic: amoxicillin', 'At admission', 1, 'G6 R1'),
      ('malaria_test', 'Malaria test (e.g. Paracheck)', 'At admission; give an anti-malarial if positive (National Malaria Treatment Guide)', 1, 'G6 R3'),
      ('measles', 'Measles vaccination', 'At admission, if not already given at 9 months', 1, 'G6 R4'),
      ('deworming', 'Deworming: albendazole or mebendazole', 'Single dose at the 2nd visit', (v_rs.params ->> 'deworming_visit')::int, 'G6 R5')
    ) as t(key, label, timing, visit, ref) loop
    v_out := v_out || jsonb_build_object('medication', m.key, 'label', m.label, 'when', m.timing, 'visit', m.visit, 'source', m.ref,
      'recorded', v_given ->> m.key,
      'note', case when v_adm.admission_type = 'from_stabilisation' then 'Ask whether it was already given in stabilisation care; do not repeat it (G6 note)' end);
  end loop;
  if (v_given ->> 'malaria_test') = 'test_positive' then
    v_out := v_out || jsonb_build_object('medication', 'antimalarial', 'label', 'Anti-malarial', 'when', 'Malaria test positive: treat per the National Malaria Treatment Guide', 'visit', 1, 'source', 'G6 R3', 'recorded', v_given ->> 'antimalarial');
  end if;
  v_out := v_out || jsonb_build_object('medication', 'vitamin_a', 'label', 'Vitamin A', 'when', 'Awaiting clinical sign-off: struck through in the booklet (RULEBOOK Q11)', 'visit', null, 'source', 'G6 R2', 'pending_rule', true);
  return v_out;
end;
$$;

-- Open a child's record by Child ID (OTP Officer at the child's site only). Logged.
create or replace function otp_child_lookup(p_child_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_child otp_children := otp_child_at_my_site(p_child_code); v_adm otp_admissions; v_out jsonb;
begin
  insert into otp_access_log (actor, child_id, action) values (auth.uid(), v_child.id, 'lookup');
  select * into v_adm from otp_admissions where child_id = v_child.id order by (status = 'active') desc, admitted_on desc limit 1;
  select jsonb_build_object(
    'child_code', v_child.child_code, 'sex', v_child.sex, 'date_of_birth', v_child.date_of_birth,
    'age_months_at_registration', v_child.age_months_at_registration, 'registered_at', v_child.registered_at,
    'identity', (select to_jsonb(i) - 'child_id' - 'updated_at' from otp_child_identity i where i.child_id = v_child.id),
    'admission', to_jsonb(v_adm),
    'visits', coalesce((select jsonb_agg(to_jsonb(v) - 'admission_id' order by v.visit_number) from otp_visits v where v.admission_id = v_adm.id), '[]'::jsonb),
    'medications', coalesce((select jsonb_agg(to_jsonb(m) - 'admission_id' order by m.given_on) from otp_medications m where m.admission_id = v_adm.id), '[]'::jsonb),
    'due_medications', case when v_adm.id is not null then otp_due_medications_for(v_adm.id) end,
    'past_admissions', (select count(*) from otp_admissions where child_id = v_child.id and id <> coalesce(v_adm.id, gen_random_uuid())),
    'discharge_check', case when v_adm.status = 'active' then otp_discharge_check(v_adm.id) end
  ) into v_out;
  return v_out;
end;
$$;

-- Record a follow-up visit (or an absence). The ration comes from the table at this visit's weight.
-- p: child_code, visit_on, attended, the card's visit fields, rutf_dispensed, dispense_note, examiner_initials, client_id.
create or replace function otp_record_visit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_child otp_children := otp_child_at_my_site(p ->> 'child_code');
  v_adm otp_admissions; v_rs otp_rule_sets; v_n int; v_ration jsonb; v_alerts text[] := '{}';
  v_wt numeric := nullif(p ->> 'weight_kg', '')::numeric; v_disp int := nullif(p ->> 'rutf_dispensed', '')::int;
  v_att boolean := coalesce((p ->> 'attended')::boolean, true); v_id uuid; v_absent int;
begin
  if nullif(p ->> 'client_id', '') is not null then
    select id into v_id from otp_visits where client_id = (p ->> 'client_id')::uuid;
    if v_id is not null then return jsonb_build_object('visit_id', v_id, 'duplicate_submission', true); end if;
  end if;
  select * into v_adm from otp_admissions where child_id = v_child.id and status = 'active';
  if v_adm.id is null then raise exception 'This child has no active OTP admission'; end if;
  select * into v_rs from otp_rule_sets where id = v_adm.rule_set_id;
  select coalesce(max(visit_number), 1) + 1 into v_n from otp_visits where admission_id = v_adm.id;

  if v_att then
    if v_wt is null then raise exception 'A valid weight is needed for each visit: the ration depends on it'; end if;
    if v_wt < ((v_rs.params -> 'plausible' -> 'weight_kg') ->> 0)::numeric or v_wt > ((v_rs.params -> 'plausible' -> 'weight_kg') ->> 1)::numeric then
      raise exception 'Weight of % kg is outside the plausible range: check the measurement', v_wt;
    end if;
    v_ration := otp_ration(v_wt, v_rs.id);
    -- Card footnotes (C2): weight below admission weight; no change by the 4th visit.
    if v_adm.weight_kg is not null and v_wt < v_adm.weight_kg then
      v_alerts := v_alerts || 'Weight below admission weight: arrange a home visit or refer to inpatient care (card footnote)'::text;
    end if;
    if v_n = (v_rs.params ->> 'no_weight_change_visit')::int and v_adm.weight_kg is not null and v_wt = v_adm.weight_kg then
      v_alerts := v_alerts || 'No change in weight by the 4th visit: arrange a home visit or refer to inpatient care (card footnote; "no change" awaits Q14)'::text;
    end if;
    if nullif(p ->> 'oedema', '') = '+++' then v_alerts := v_alerts || 'Severe oedema (+++): refer to stabilisation care (G4)'::text; end if;
    if p ->> 'appetite_test' in ('poor', 'refused') then v_alerts := v_alerts || 'Poor or refused appetite test: assess for referral to stabilisation care (G4)'::text; end if;
    if v_ration ->> 'ok' = 'false' then v_alerts := v_alerts || (v_ration ->> 'reason'); end if;
    if v_disp is not null and v_ration ->> 'ok' = 'true' and v_disp <> (v_ration ->> 'packets_per_week')::int and coalesce(trim(p ->> 'dispense_note'), '') = '' then
      raise exception 'Dispensed % packets but the ration is %: record the reason', v_disp, v_ration ->> 'packets_per_week';
    end if;
  else
    -- Absent: count consecutive absences for the defaulter rule (C2: 3 consecutive absences).
    -- consecutive absences immediately before this one
    select count(*) into v_absent from otp_visits
    where admission_id = v_adm.id and not attended
      and visit_number > coalesce((select max(visit_number) from otp_visits where admission_id = v_adm.id and attended), 1);
    if v_absent + 1 >= (v_rs.params ->> 'defaulter_consecutive_absences')::int then
      v_alerts := v_alerts || format('%s consecutive absences: the child meets the card''s defaulter definition; record the outcome', v_absent + 1);
    end if;
  end if;

  insert into otp_visits (admission_id, visit_number, visit_on, attended, weight_kg, height_cm, muac_cm, oedema, wfh_z,
    diarrhoea_days, vomiting_days, fever_days, cough_days, appetite_test, temperature_c, respiratory_rate, dehydrated, pallor,
    superficial_infection, action_required, action_details, ration_band_min_kg, rutf_prescribed, rutf_dispensed, dispense_note,
    alerts, examiner_initials, rule_set_id, recorded_by, client_id)
  values (v_adm.id, v_n, coalesce(nullif(p ->> 'visit_on', '')::date, current_date), v_att, v_wt,
    nullif(p ->> 'height_cm', '')::numeric, nullif(p ->> 'muac_cm', '')::numeric, nullif(p ->> 'oedema', ''), nullif(p ->> 'wfh_z', '')::numeric,
    nullif(p ->> 'diarrhoea_days', '')::int, nullif(p ->> 'vomiting_days', '')::int, nullif(p ->> 'fever_days', '')::int, nullif(p ->> 'cough_days', '')::int,
    nullif(p ->> 'appetite_test', ''), nullif(p ->> 'temperature_c', '')::numeric, nullif(p ->> 'respiratory_rate', '')::int,
    (p ->> 'dehydrated')::boolean, (p ->> 'pallor')::boolean, (p ->> 'superficial_infection')::boolean,
    (p ->> 'action_required')::boolean, nullif(p ->> 'action_details', ''),
    nullif(v_ration ->> 'band_min_kg', '')::numeric, nullif(v_ration ->> 'packets_per_week', '')::int, v_disp, nullif(trim(p ->> 'dispense_note'), ''),
    v_alerts, nullif(p ->> 'examiner_initials', ''), v_rs.id, auth.uid(), nullif(p ->> 'client_id', '')::uuid)
  returning id into v_id;

  return jsonb_build_object('visit_id', v_id, 'visit_number', v_n, 'ration', v_ration, 'alerts', to_jsonb(v_alerts),
    'due_medications', otp_due_medications_for(v_adm.id), 'discharge_check', otp_discharge_check(v_adm.id));
end;
$$;

-- Record a routine medication (as given by the officer).
create or replace function otp_record_medication(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_child otp_children := otp_child_at_my_site(p ->> 'child_code'); v_adm otp_admissions; v_id uuid;
begin
  if nullif(p ->> 'client_id', '') is not null then
    select id into v_id from otp_medications where client_id = (p ->> 'client_id')::uuid;
    if v_id is not null then return jsonb_build_object('medication_id', v_id, 'duplicate_submission', true); end if;
  end if;
  select * into v_adm from otp_admissions where child_id = v_child.id and status = 'active';
  if v_adm.id is null then raise exception 'This child has no active OTP admission'; end if;
  if p ->> 'medication' = 'vitamin_a' then raise exception 'Vitamin A awaits clinical sign-off (RULEBOOK Q11)'; end if;
  if p ->> 'medication' = 'antimalarial' and not exists (select 1 from otp_medications where admission_id = v_adm.id and medication = 'malaria_test' and status = 'test_positive') then
    raise exception 'Record a positive malaria test before an anti-malarial (G6: test at admission, give if positive)';
  end if;
  if p ->> 'status' = 'given' and coalesce(trim(p ->> 'dose_text'), '') = '' and p ->> 'medication' not in ('malaria_test') then
    raise exception 'Record the dose given';
  end if;
  insert into otp_medications (admission_id, medication, status, given_on, visit_number, dose_text, reason, recorded_by, client_id)
  values (v_adm.id, p ->> 'medication', p ->> 'status', coalesce(nullif(p ->> 'given_on', '')::date, current_date),
          nullif(p ->> 'visit_number', '')::int, nullif(trim(p ->> 'dose_text'), ''), nullif(trim(p ->> 'reason'), ''), auth.uid(), nullif(p ->> 'client_id', '')::uuid)
  returning id into v_id;
  return jsonb_build_object('medication_id', v_id, 'due_medications', otp_due_medications_for(v_adm.id));
end;
$$;

-- Discharge-as-cured check (G7): each criterion met / not met / pending. Never sets the outcome.
create or replace function otp_discharge_check(p_admission_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_adm otp_admissions; v_rs otp_rule_sets; pr jsonb; v_last otp_visits; v_prev otp_visits;
  v_weeks numeric; c jsonb := '[]'::jsonb; v_all boolean := true;
  mk_ok boolean; n int;
begin
  select * into v_adm from otp_admissions where id = p_admission_id;
  select * into v_rs from otp_rule_sets where id = v_adm.rule_set_id; pr := v_rs.params;
  select * into v_last from otp_visits where admission_id = p_admission_id and attended order by visit_number desc limit 1;
  select * into v_prev from otp_visits where admission_id = p_admission_id and attended and visit_number < coalesce(v_last.visit_number, 0) order by visit_number desc limit 1;
  n := (pr ->> 'discharge_consecutive_visits')::int;
  mk_ok := v_last.muac_cm is not null and v_last.muac_cm > (pr ->> 'discharge_muac_above')::numeric;
  c := c || jsonb_build_object('criterion', format('MUAC above %s cm at the latest visit', pr ->> 'discharge_muac_above'),
    'state', case when v_last.muac_cm is null then 'pending' when mk_ok then 'met' else 'not_met' end, 'source', 'G7 (Q15)');
  if 'muac' = any(v_adm.admission_criteria) then
    v_weeks := (coalesce(v_last.visit_on, current_date) - v_adm.admitted_on) / 7.0;
    c := c || jsonb_build_object('criterion', format('Minimum stay of %s weeks', pr ->> 'discharge_min_weeks_muac'),
      'state', case when v_weeks >= (pr ->> 'discharge_min_weeks_muac')::numeric then 'met' else 'not_met' end, 'source', 'G7 D1 (Q16)');
    c := c || jsonb_build_object('criterion', 'Sustained weight gain', 'state', 'officer_confirms', 'source', 'G7 D1: definition awaits Q14');
  end if;
  if 'oedema' = any(v_adm.admission_criteria) then
    c := c || jsonb_build_object('criterion', format('No oedema for %s consecutive visits', n),
      'state', case when v_prev.id is null then 'pending'
                    when v_last.oedema = 'absent' and v_prev.oedema = 'absent' then 'met' else 'not_met' end, 'source', 'G7 D2');
  end if;
  if 'wfh' = any(v_adm.admission_criteria) then
    c := c || jsonb_build_object('criterion', format('WFH above %s for %s consecutive visits', pr ->> 'discharge_wfh_above', n),
      'state', case when v_prev.id is null or v_last.wfh_z is null or v_prev.wfh_z is null then 'pending'
                    when v_last.wfh_z > (pr ->> 'discharge_wfh_above')::numeric and v_prev.wfh_z > (pr ->> 'discharge_wfh_above')::numeric then 'met' else 'not_met' end, 'source', 'G7 D3');
  end if;
  c := c || jsonb_build_object('criterion', 'Clinically well', 'state', 'officer_confirms', 'source', 'G7: definition awaits Q17');
  select bool_and(x ->> 'state' in ('met', 'officer_confirms')) into v_all from jsonb_array_elements(c) x;
  return jsonb_build_object('criteria', c, 'can_discharge_as_cured', coalesce(v_all, false), 'rule_set', v_rs.version, 'rule_status', v_rs.status);
end;
$$;

-- Record the outcome of an admission. "Cured" only when every measurable criterion is met and the
-- officer confirms the ones awaiting definition.
-- p: child_code, outcome, reason, confirm_weight_gain, confirm_clinically_well, outcome_on.
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
    if coalesce((p ->> 'confirm_clinically_well')::boolean, false) is not true
       or ('muac' = any(v_adm.admission_criteria) and coalesce((p ->> 'confirm_weight_gain')::boolean, false) is not true) then
      raise exception 'Confirm the child is clinically well (and, for a MUAC admission, has sustained weight gain)';
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

-- Transfer an active child to another OTP site (same Child ID and history; G5 T3).
create or replace function otp_transfer_child(p_child_code text, p_to_facility uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_child otp_children := otp_child_at_my_site(p_child_code); v_to facilities; v_adm otp_admissions;
begin
  select * into v_to from facilities where id = p_to_facility and facility_type = 'health_facility' and is_otp_site and is_active;
  if v_to.id is null then raise exception 'The receiving facility is not an active OTP site'; end if;
  if v_to.id = v_child.facility_id then raise exception 'The child is already at this OTP site'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Record the reason for the transfer'; end if;
  select * into v_adm from otp_admissions where child_id = v_child.id and status = 'active';
  if v_adm.id is not null then
    update otp_admissions set status = 'closed', outcome = 'transferred_otp', outcome_on = current_date, outcome_reason = trim(p_reason), outcome_confirmed_by = auth.uid() where id = v_adm.id;
    insert into otp_admissions (child_id, facility_id, admission_type, admission_source, admission_criteria, weight_kg, height_cm, muac_cm, oedema, wfh_z, rule_set_id, created_by)
    values (v_child.id, v_to.id, 'transfer_from_otp', 'other_centre', v_adm.admission_criteria, v_adm.weight_kg, v_adm.height_cm, v_adm.muac_cm, v_adm.oedema, v_adm.wfh_z, v_adm.rule_set_id, auth.uid());
  end if;
  update otp_children set facility_id = v_to.id, lga_id = v_to.lga_id, state_id = v_to.state_id where id = v_child.id;
  insert into otp_access_log (actor, child_id, action) values (auth.uid(), v_child.id, 'transfer');
  return jsonb_build_object('child_code', v_child.child_code, 'transferred_to', v_to.name);
end;
$$;

-- Re-admit a child already registered (returned defaulter, back from stabilisation care, or a
-- relapse), on the same Child ID. p: child_code, admission_type, screening_id, readmission, relapse.
create or replace function otp_readmit_child(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_child otp_children := otp_child_at_my_site(p ->> 'child_code'); v_scr otp_screenings; v_rs otp_rule_sets := otp_current_rule_set(); v_adm uuid;
begin
  if exists (select 1 from otp_admissions where child_id = v_child.id and status = 'active') then raise exception 'This child already has an active admission'; end if;
  if p ->> 'admission_type' not in ('new_case', 'from_stabilisation', 'returned_defaulter') then raise exception 'Unknown admission type'; end if;
  select * into v_scr from otp_screenings where id = (p ->> 'screening_id')::uuid and facility_id = v_child.facility_id;
  if v_scr.id is null then raise exception 'Screen the child at this OTP site first'; end if;
  -- A new case must meet the OTP criteria; a child returning from stabilisation or after defaulting
  -- continues treatment, but not if the screening sends the child to stabilisation care.
  if p ->> 'admission_type' = 'new_case' and v_scr.pathway <> 'otp' then raise exception 'Not eligible for OTP admission: %', v_scr.result ->> 'next_action'; end if;
  if v_scr.pathway = 'stabilisation' then raise exception 'The screening sends this child to stabilisation care: %', v_scr.result ->> 'next_action'; end if;
  insert into otp_admissions (child_id, facility_id, admission_type, readmission, relapse, weight_kg, height_cm, muac_cm, oedema, wfh_z, screening_id, rule_set_id, created_by,
    admission_criteria)
  values (v_child.id, v_child.facility_id, p ->> 'admission_type', coalesce((p ->> 'readmission')::boolean, false), coalesce((p ->> 'relapse')::boolean, false),
    nullif(v_scr.inputs ->> 'weight_kg', '')::numeric, nullif(v_scr.inputs ->> 'height_cm', '')::numeric, nullif(v_scr.inputs ->> 'muac_cm', '')::numeric,
    v_scr.inputs ->> 'oedema', nullif(v_scr.inputs ->> 'wfh_z', '')::numeric, v_scr.id, v_rs.id, auth.uid(),
    array_remove(array[case when v_scr.result ->> 'muac_band' = 'red' then 'muac' end, case when v_scr.inputs ->> 'oedema' in ('+','++') then 'oedema' end,
                       case when v_scr.result ->> 'wfh_band' = 'sam' then 'wfh' end], null))
  returning id into v_adm;
  update otp_screenings set child_id = v_child.id where id = v_scr.id;
  return jsonb_build_object('child_code', v_child.child_code, 'admission_type', p ->> 'admission_type',
    'ration', otp_ration(nullif(v_scr.inputs ->> 'weight_kg', '')::numeric, v_rs.id), 'due_medications', otp_due_medications_for(v_adm));
end;
$$;

-- ── Aggregates for everyone in scope (no child-level rows) ───────────────────────────────────
-- Counts for a period by place, sex and age group, with small counts suppressed: a count from 1
-- to (min_cell − 1) is returned as null with "suppressed": true. min_cell = threshold
-- 'otp_min_cell_count' (default 5).
create or replace function otp_aggregates(p_start date, p_end date, p_lga_id uuid default null, p_facility_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_project uuid := current_project_id();
  v_min int;
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to see OTP figures'; end if;
  v_min := rutf_threshold(v_project, 'otp_min_cell_count', 5)::int;
  with scope as (
    select a.*, c.sex, c.age_months_at_registration as age, f.lga_id
    from otp_admissions a join otp_children c on c.id = a.child_id join facilities f on f.id = a.facility_id
    where (select in_scope(c.project_id)) and (p_lga_id is null or f.lga_id = p_lga_id) and (p_facility_id is null or a.facility_id = p_facility_id)
  ), counts as (
    select
      count(*) filter (where admitted_on < p_start and (outcome_on is null or outcome_on >= p_start)) as opening,
      count(*) filter (where admitted_on between p_start and p_end) as admissions,
      count(*) filter (where admitted_on between p_start and p_end and admission_type = 'new_case') as new_cases,
      count(*) filter (where outcome_on between p_start and p_end and outcome = 'cured') as cured,
      count(*) filter (where outcome_on between p_start and p_end and outcome = 'defaulted') as defaulted,
      count(*) filter (where outcome_on between p_start and p_end and outcome = 'died') as died,
      count(*) filter (where outcome_on between p_start and p_end and outcome = 'non_recovered') as non_recovered,
      count(*) filter (where outcome_on between p_start and p_end and outcome in ('transferred_inpatient', 'refused_inpatient', 'transferred_otp')) as transferred_or_other,
      count(*) filter (where admitted_on <= p_end and (outcome_on is null or outcome_on > p_end)) as closing
    from scope
  ), by_group as (
    select coalesce(jsonb_object_agg(g, case when n between 1 and v_min - 1 then null else n end), '{}'::jsonb) as cells,
           bool_or(n between 1 and v_min - 1) as suppressed
    from (select sex || ':' || case when age < 12 then '6-11' when age < 24 then '12-23' else '24-59' end as g, count(*) as n
          from scope where admitted_on between p_start and p_end group by 1) x
  ), rutf as (
    select coalesce(sum(v.rutf_prescribed), 0) as prescribed, coalesce(sum(v.rutf_dispensed), 0) as dispensed,
           count(*) filter (where v.rutf_dispensed is not null and v.rutf_prescribed is not null and v.rutf_dispensed <> v.rutf_prescribed) as visits_differing
    from otp_visits v join scope s on s.id = v.admission_id where v.visit_on between p_start and p_end
  ), screen as (
    select coalesce(jsonb_object_agg(coalesce(pathway, 'unknown'), case when n between 1 and v_min - 1 then null else n end), '{}'::jsonb) as by_pathway
    from (select pathway, count(*) as n from otp_screenings s join facilities f on f.id = s.facility_id
          where (select in_scope(s.project_id)) and s.screened_on between p_start and p_end
            and (p_lga_id is null or f.lga_id = p_lga_id) and (p_facility_id is null or s.facility_id = p_facility_id) group by 1) y
  )
  select jsonb_build_object('period', jsonb_build_array(p_start, p_end), 'min_cell_count', v_min,
    'cohort', to_jsonb(counts), 'admissions_by_sex_age', by_group.cells, 'suppressed', coalesce(by_group.suppressed, false),
    'rutf_packets', to_jsonb(rutf), 'screenings_by_pathway', screen.by_pathway,
    'note', 'Aggregate figures only. Counts from 1 to ' || (v_min - 1) || ' are hidden to protect children''s privacy.')
  into v_out from counts, by_group, rutf, screen;
  return v_out;
end;
$$;

-- ── Grants: functions only ───────────────────────────────────────────────────────────────────
revoke execute on function otp_current_rule_set(), otp_officer_site(), otp_child_at_my_site(text),
  otp_due_medications_for(uuid), otp_discharge_check(uuid) from public, anon, authenticated;
revoke execute on function otp_ration(numeric, uuid), otp_evaluate_screening(jsonb, boolean), otp_screen(jsonb),
  otp_register_child(jsonb), otp_child_lookup(text), otp_record_visit(jsonb), otp_record_medication(jsonb),
  otp_record_outcome(jsonb), otp_transfer_child(text, uuid, text), otp_readmit_child(jsonb),
  otp_aggregates(date, date, uuid, uuid) from public, anon;
grant execute on function otp_ration(numeric, uuid), otp_evaluate_screening(jsonb, boolean), otp_screen(jsonb),
  otp_register_child(jsonb), otp_child_lookup(text), otp_record_visit(jsonb), otp_record_medication(jsonb),
  otp_record_outcome(jsonb), otp_transfer_child(text, uuid, text), otp_readmit_child(jsonb),
  otp_aggregates(date, date, uuid, uuid) to authenticated;
