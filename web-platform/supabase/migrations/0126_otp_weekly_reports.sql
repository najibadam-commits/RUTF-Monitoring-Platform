-- RUTF Monitoring Platform — migration 0126
-- Weekly OTP Site Report and State Coordinator approval (DECISIONS R147;
-- docs/otp-digitisation/WEEKLY_REPORT_DESIGN.md).
--
-- Every figure comes from records already in the platform: the Digital OTP Admission Card (0124:
-- admissions, visits, outcomes, screenings) and the stock ledger (RUTF). Two minimal forms are
-- added for what was not recorded anywhere: MNP stock and doses, and IYCF / health education
-- sessions. A figure that can't be computed is returned as missing / not applicable / pending,
-- never as 0. HR MAM has no admission rule in the guidelines, so its rows are "not applicable".
--
-- Workflow: draft (generated) → submitted (locked, a version is kept) → approved | returned →
-- (returned) resubmitted … An approved report changes only by an amendment, a new version for
-- approval. Every version is kept. The OTP Officer of the site prepares and submits; the State
-- Coordinator of the site's state approves or returns. Tables: RLS on, no policies, no API
-- privileges — functions only. The report is aggregate: no child is named and no Child ID appears.

-- ── New forms (minimal) ──────────────────────────────────────────────────────────────────────

create table mnp_stock_movements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  facility_id uuid not null references facilities(id),
  movement_date date not null,
  kind text not null check (kind in ('receipt', 'distributed', 'loss', 'adjustment', 'physical_count')),
  sachets int not null,                            -- adjustment may be negative; the others ≥ 0
  note text,
  recorded_by uuid references profiles(id),
  recorded_at timestamptz not null default now(),
  client_id uuid unique,
  check (kind = 'adjustment' or sachets >= 0)
);
create index mnp_stock_facility_idx on mnp_stock_movements(facility_id, movement_date);

create table mnp_doses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  facility_id uuid not null references facilities(id),
  given_on date not null,
  dose_number int not null check (dose_number between 1 and 3),
  children int not null check (children >= 0),     -- beneficiaries, not stock units
  recorded_by uuid references profiles(id),
  recorded_at timestamptz not null default now(),
  client_id uuid unique
);
create index mnp_doses_facility_idx on mnp_doses(facility_id, given_on);

create table iycf_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  facility_id uuid not null references facilities(id),
  held_on date not null,
  kind text not null check (kind in ('iycf_support_group', 'health_education')),
  topic text,
  pregnant_women int check (pregnant_women >= 0),
  breastfeeding_women int check (breastfeeding_women >= 0),
  other_women int check (other_women >= 0),
  total_participants int check (total_participants >= 0), -- as counted by the officer (categories may overlap: W8)
  recorded_by uuid references profiles(id),
  recorded_at timestamptz not null default now(),
  client_id uuid unique
);
create index iycf_sessions_facility_idx on iycf_sessions(facility_id, held_on);

-- ── Reports and their versions ───────────────────────────────────────────────────────────────

create table otp_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  state_id uuid not null references states(id),
  lga_id uuid not null references lgas(id),
  facility_id uuid not null references facilities(id),
  week_start date not null,
  week_end date not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'returned', 'approved')),
  amendment boolean not null default false,        -- a draft reopening an approved report
  current_version int not null default 0,          -- the latest submitted version (0 = never submitted)
  draft_comments jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, week_start)
);
create index otp_weekly_reports_state_idx on otp_weekly_reports(state_id, week_start);

create table otp_weekly_report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references otp_weekly_reports(id),
  version int not null,
  data jsonb not null,                              -- every section, as computed
  issues jsonb not null,                            -- the data-quality checks at submission
  comments jsonb not null,                          -- the officer's explanations
  amendment boolean not null default false,
  amendment_reason text,
  submitted_by uuid not null references profiles(id),
  submitted_at timestamptz not null default now(),
  decision text check (decision in ('approved', 'returned')),
  decision_note text,
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  unique (report_id, version)
);

do $$
declare t text;
begin
  foreach t in array array['mnp_stock_movements', 'mnp_doses', 'iycf_sessions', 'otp_weekly_reports', 'otp_weekly_report_versions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
    execute format('create trigger %1$s_audit after insert or update or delete on %1$s for each row execute function audit_row_change()', t);
  end loop;
end $$;

-- ── Helpers ──────────────────────────────────────────────────────────────────────────────────

-- The reporting week containing a date (default Monday–Sunday; threshold otp_report_week_start_dow, 1 = Monday).
create or replace function otp_week_of(p_date date, p_project uuid default null)
returns daterange language sql stable security definer set search_path = public as $$
  select daterange(s, s + 6, '[]') from (
    select (p_date - (((extract(isodow from p_date)::int - rutf_threshold(p_project, 'otp_report_week_start_dow', 1)::int) + 7) % 7))::date as s
  ) x;
$$;

-- The State Coordinators for a state (and their names, for the report).
create or replace function otp_state_coordinators(p_state_id uuid)
returns setof profiles language sql stable security definer set search_path = public as $$
  select * from profiles where role = 'state_coordinator' and status = 'active' and managed_state_id = p_state_id order by name;
$$;

create or replace function otp_notify(p_user uuid, p_text text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, type, text, link) values (p_user, 'weekly_report', p_text, p_link);
$$;

-- ── The calculation engine (one site, one week) ──────────────────────────────────────────────
-- Returns {sections: {...}, issues: [...]} . Issue severity: blocking (must be explained before
-- submission; reconciled before approval), warning, info.

create or replace function otp_weekly_report_compute(p_facility_id uuid, p_week_start date)
returns jsonb language plpgsql volatile security definer set search_path = public as $$  -- volatile: uses a temporary table
declare
  f facilities; v_lga lgas; v_state states;
  ws date := (lower(otp_week_of(p_week_start)))::date;
  we date := ws + 6;
  v_issues jsonb := '[]'::jsonb;
  s jsonb := '{}'::jsonb;
  b jsonb; c jsonb; d jsonb; e jsonb; fcl jsonb; g jsonb; h jsonb; i jsonb; j jsonb;
  v_calc jsonb; v_actual jsonb; v_per_carton int; v_mnp_carton numeric;
  r record; v_count int; v_any_mnp boolean; v_disp_ledger int; v_disp_visits int; v_days int;
begin
  select * into f from facilities where id = p_facility_id;
  select * into v_lga from lgas where id = f.lga_id;
  select * into v_state from states where id = f.state_id;

  -- One row per admission at the site, with sex and age at admission (months).
  create temporary table if not exists _adm (id uuid, sex text, age int, admitted_on date, admission_type text, outcome text, outcome_on date) on commit drop;
  truncate _adm;
  insert into _adm
  select a.id, ch.sex,
         ch.age_months_at_registration + (extract(year from age(a.admitted_on, ch.registered_at::date)) * 12 + extract(month from age(a.admitted_on, ch.registered_at::date)))::int,
         a.admitted_on, a.admission_type, a.outcome, a.outcome_on
  from otp_admissions a join otp_children ch on ch.id = a.child_id
  where a.facility_id = p_facility_id;

  -- by sex: {"M": n, "F": n, "total": n}
  -- B. Opening caseload (active at the start of the week).
  select jsonb_build_object('M', count(*) filter (where sex = 'M'), 'F', count(*) filter (where sex = 'F'), 'total', count(*)) into b
  from _adm where admitted_on < ws and (outcome_on is null or outcome_on >= ws);

  -- C. New enrollment (new cases admitted in the week), by sex × age group; other admissions shown apart.
  select jsonb_build_object(
    'M_6_23', count(*) filter (where admission_type = 'new_case' and sex = 'M' and age between 6 and 23),
    'M_24_59', count(*) filter (where admission_type = 'new_case' and sex = 'M' and age between 24 and 59),
    'F_6_23', count(*) filter (where admission_type = 'new_case' and sex = 'F' and age between 6 and 23),
    'F_24_59', count(*) filter (where admission_type = 'new_case' and sex = 'F' and age between 24 and 59),
    'M', count(*) filter (where admission_type = 'new_case' and sex = 'M'),
    'F', count(*) filter (where admission_type = 'new_case' and sex = 'F'),
    'total', count(*) filter (where admission_type = 'new_case'),
    'outside_6_59', count(*) filter (where admission_type = 'new_case' and (age < 6 or age > 59)),
    'other_admissions', jsonb_build_object(
      'returned_defaulter', count(*) filter (where admission_type = 'returned_defaulter'),
      'from_stabilisation', count(*) filter (where admission_type = 'from_stabilisation'))) into c
  from _adm where admitted_on between ws and we;
  if (c ->> 'outside_6_59')::int > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'age_outside', 'severity', 'warning', 'section', 'C',
      'message', format('%s new case(s) aged outside 6–59 months at admission', c ->> 'outside_6_59'));
  end if;

  -- D. Transfers (by sex).
  select jsonb_build_object(
    'in', jsonb_build_object('M', count(*) filter (where admission_type = 'transfer_from_otp' and admitted_on between ws and we and sex = 'M'),
                             'F', count(*) filter (where admission_type = 'transfer_from_otp' and admitted_on between ws and we and sex = 'F'),
                             'total', count(*) filter (where admission_type = 'transfer_from_otp' and admitted_on between ws and we)),
    'out', jsonb_build_object('M', count(*) filter (where outcome = 'transferred_otp' and outcome_on between ws and we and sex = 'M'),
                              'F', count(*) filter (where outcome = 'transferred_otp' and outcome_on between ws and we and sex = 'F'),
                              'total', count(*) filter (where outcome = 'transferred_otp' and outcome_on between ws and we))) into d
  from _adm;

  -- E. Outcomes recorded in the week (by sex) and absentees (unique children absent at a visit).
  select jsonb_object_agg(o, jsonb_build_object('M', m, 'F', fe, 'total', m + fe)) into e from (
    select o, count(*) filter (where x.sex = 'M') m, count(*) filter (where x.sex = 'F') fe
    from unnest(array['cured', 'non_recovered', 'died', 'defaulted', 'transferred_inpatient', 'refused_inpatient']) o
    left join _adm x on x.outcome = o and x.outcome_on between ws and we
    group by o) y;
  select e || jsonb_build_object('absent', jsonb_build_object(
      'M', count(distinct v.admission_id) filter (where x.sex = 'M'),
      'F', count(distinct v.admission_id) filter (where x.sex = 'F'),
      'total', count(distinct v.admission_id))) into e
  from otp_visits v join _adm x on x.id = v.admission_id where not v.attended and v.visit_on between ws and we;

  -- F. Closing caseload: calculated vs the active records at the end of the week.
  select jsonb_build_object('M', count(*) filter (where sex = 'M'), 'F', count(*) filter (where sex = 'F'), 'total', count(*)) into v_actual
  from _adm where admitted_on <= we and (outcome_on is null or outcome_on > we);
  select jsonb_build_object(k, (b ->> k)::int + (c ->> k)::int
      + (c -> 'other_admissions' ->> 'returned_defaulter')::int * (case when k = 'total' then 1 else 0 end)
      + (c -> 'other_admissions' ->> 'from_stabilisation')::int * (case when k = 'total' then 1 else 0 end)
      + (d -> 'in' ->> k)::int - (d -> 'out' ->> k)::int
      - (select sum((e -> o ->> k)::int) from unnest(array['cured','non_recovered','died','defaulted','transferred_inpatient','refused_inpatient']) o))
    into v_calc from (values ('total')) t(k);
  -- by sex: recompute other admissions by sex for the calculated figure
  for r in select k from (values ('M'), ('F')) t(k) loop
    select count(*) into v_count from _adm where admitted_on between ws and we and admission_type in ('returned_defaulter', 'from_stabilisation') and sex = r.k;
    v_calc := v_calc || jsonb_build_object(r.k, (b ->> r.k)::int + (c ->> r.k)::int + v_count + (d -> 'in' ->> r.k)::int - (d -> 'out' ->> r.k)::int
      - (select sum((e -> o ->> r.k)::int) from unnest(array['cured','non_recovered','died','defaulted','transferred_inpatient','refused_inpatient']) o));
  end loop;
  fcl := jsonb_build_object('calculated', v_calc, 'actual', v_actual,
    'formula', 'opening + new cases + other admissions + transfers in − transfers out − exits (cured, non-recovered, died, defaulted, to inpatient, refused inpatient); absentees stay active (W5)');
  if v_calc ->> 'total' <> v_actual ->> 'total' or v_calc ->> 'M' <> v_actual ->> 'M' or v_calc ->> 'F' <> v_actual ->> 'F' then
    v_issues := v_issues || jsonb_build_object('code', 'caseload_mismatch', 'severity', 'blocking', 'section', 'F',
      'message', format('Calculated closing caseload %s does not match the %s children under treatment at the end of the week: explain the difference',
                        v_calc ->> 'total', v_actual ->> 'total'));
  end if;
  -- Children under treatment with no visit recorded in the week (follow-up is weekly: W2).
  select count(*) into v_count from _adm x
  where x.admitted_on < ws and (x.outcome_on is null or x.outcome_on > we)
    and not exists (select 1 from otp_visits v where v.admission_id = x.id and v.visit_on between ws and we);
  if v_count > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'no_visit', 'severity', 'warning', 'section', 'E',
      'message', format('%s child(ren) under treatment have no visit or absence recorded this week', v_count));
  end if;
  -- A visit recorded after an admission was closed.
  select count(*) into v_count from otp_visits v join _adm x on x.id = v.admission_id
  where x.outcome_on is not null and v.visit_on > x.outcome_on and v.visit_on between ws and we;
  if v_count > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'visit_after_outcome', 'severity', 'blocking', 'section', 'E',
      'message', format('%s visit(s) recorded after the child''s outcome', v_count));
  end if;

  -- G. RUTF stock (ledger; cartons from the product's pack size).
  select max(p.units_per_carton) into v_per_carton from products p;
  select jsonb_build_object(
      'opening', coalesce(sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)) filter (where t.txn_date < ws), 0),
      'received', coalesce(sum(t.quantity_sachets) filter (where t.txn_type = 'receipt' and t.txn_date between ws and we), 0),
      'dispensed', coalesce(sum(t.quantity_sachets) filter (where t.txn_type = 'dispensed' and t.txn_date between ws and we), 0),
      'issued', coalesce(sum(t.quantity_sachets) filter (where t.txn_type = 'issue' and t.txn_date between ws and we), 0),
      'losses', coalesce(sum(t.quantity_sachets) filter (where t.txn_type::text like 'loss%' and t.txn_date between ws and we), 0),
      'adjustments', coalesce(sum(t.quantity_sachets) filter (where t.txn_type = 'adjustment' and t.txn_date between ws and we), 0),
      'expected_closing', coalesce(sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)) filter (where t.txn_date <= we), 0))
    into g
  from stock_transactions t where t.facility_id = p_facility_id and t.status <> 'voided';
  select t.quantity_sachets, t.txn_date into r from stock_transactions t
  where t.facility_id = p_facility_id and t.status <> 'voided' and t.txn_type = 'physical_count' and t.txn_date between ws and we
  order by t.txn_date desc, t.created_at desc limit 1;
  if r.quantity_sachets is not null then
    -- The count is compared with the balance on the day of the count (entries after it excluded).
    g := g || jsonb_build_object('physical_count', r.quantity_sachets, 'count_date', r.txn_date,
      -- balance on the count day, before that day's reconciling adjustment
      'discrepancy', r.quantity_sachets - (select coalesce(sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)), 0) from stock_transactions t
        where t.facility_id = p_facility_id and t.status <> 'voided'
          and (t.txn_date < r.txn_date or (t.txn_date = r.txn_date and t.txn_type <> 'adjustment'))));
    if (g ->> 'discrepancy')::int <> 0 then
      v_issues := v_issues || jsonb_build_object('code', 'rutf_count_discrepancy', 'severity', 'blocking', 'section', 'G',
        'message', format('RUTF physical count differs from the ledger by %s sachets: explain it', g ->> 'discrepancy'));
    end if;
  else
    g := g || jsonb_build_object('physical_count', null, 'discrepancy', null, 'count_status', 'pending: no physical count recorded this week');
  end if;
  g := g || jsonb_build_object('sachets_per_carton', v_per_carton);
  if (g ->> 'expected_closing')::int < 0 then
    v_issues := v_issues || jsonb_build_object('code', 'rutf_negative', 'severity', 'blocking', 'section', 'G', 'message', 'The ledger balance is negative at the end of the week');
  end if;
  -- Daily dispensing recorded? and does it agree with the RUTF handed to children at visits?
  select count(distinct dispense_date) into v_days from otp_daily_dispensing where facility_id = p_facility_id and dispense_date between ws and we;
  if v_days = 0 and f.is_otp_site then
    v_issues := v_issues || jsonb_build_object('code', 'no_daily_dispensing', 'severity', 'warning', 'section', 'G',
      'message', 'No daily dispensing recorded this week: RUTF dispensed is missing, not zero');
    g := g || jsonb_build_object('dispensed_status', 'missing');
  end if;
  v_disp_ledger := (g ->> 'dispensed')::int;
  select coalesce(sum(v.rutf_dispensed), 0) into v_disp_visits from otp_visits v join _adm x on x.id = v.admission_id where v.visit_on between ws and we;
  g := g || jsonb_build_object('dispensed_at_child_visits', v_disp_visits);
  if v_days > 0 and v_disp_visits > 0 and v_disp_visits <> v_disp_ledger then
    v_issues := v_issues || jsonb_build_object('code', 'rutf_visits_vs_ledger', 'severity', 'warning', 'section', 'G',
      'message', format('RUTF dispensed per the daily register (%s) differs from the total at child visits (%s)', v_disp_ledger, v_disp_visits));
  end if;

  -- H. MNP (new form). If the site has never recorded MNP, the section is "not recorded", not zeros.
  select exists (select 1 from mnp_stock_movements where facility_id = p_facility_id) or exists (select 1 from mnp_doses where facility_id = p_facility_id) into v_any_mnp;
  v_mnp_carton := nullif(rutf_threshold(f.project_id, 'mnp_sachets_per_carton', 0), 0);
  if not v_any_mnp then
    h := jsonb_build_object('status', 'not_recorded', 'note', 'No MNP stock or doses recorded at this site yet');
  else
    select jsonb_build_object(
      'opening', coalesce(sum(case when kind = 'receipt' then sachets when kind = 'adjustment' then sachets when kind in ('distributed', 'loss') then -sachets else 0 end) filter (where movement_date < ws), 0),
      'received', coalesce(sum(sachets) filter (where kind = 'receipt' and movement_date between ws and we), 0),
      'distributed', coalesce(sum(sachets) filter (where kind = 'distributed' and movement_date between ws and we), 0),
      'losses', coalesce(sum(sachets) filter (where kind = 'loss' and movement_date between ws and we), 0),
      'adjustments', coalesce(sum(sachets) filter (where kind = 'adjustment' and movement_date between ws and we), 0),
      'expected_closing', coalesce(sum(case when kind = 'receipt' then sachets when kind = 'adjustment' then sachets when kind in ('distributed', 'loss') then -sachets else 0 end) filter (where movement_date <= we), 0),
      'physical_count', (select m.sachets from mnp_stock_movements m where m.facility_id = p_facility_id and m.kind = 'physical_count' and m.movement_date between ws and we order by m.movement_date desc, m.recorded_at desc limit 1),
      'sachets_per_carton', v_mnp_carton)
      into h from mnp_stock_movements where facility_id = p_facility_id;
    h := h || jsonb_build_object('doses', (select jsonb_build_object(
        'dose_1', coalesce(sum(children) filter (where dose_number = 1), 0),
        'dose_2', coalesce(sum(children) filter (where dose_number = 2), 0),
        'dose_3', coalesce(sum(children) filter (where dose_number = 3), 0))
      from mnp_doses where facility_id = p_facility_id and given_on between ws and we));
    if h ->> 'physical_count' is not null then
      h := h || jsonb_build_object('discrepancy', (h ->> 'physical_count')::int - (h ->> 'expected_closing')::int);
      if (h ->> 'discrepancy')::int <> 0 then
        v_issues := v_issues || jsonb_build_object('code', 'mnp_count_discrepancy', 'severity', 'blocking', 'section', 'H',
          'message', format('MNP physical count differs from the expected balance by %s sachets: explain it', h ->> 'discrepancy'));
      end if;
    end if;
    if v_mnp_carton is null then
      v_issues := v_issues || jsonb_build_object('code', 'mnp_pack_size', 'severity', 'info', 'section', 'H',
        'message', 'MNP sachets per carton is not configured (W6): cartons are not shown');
    end if;
    if (h ->> 'expected_closing')::int < 0 then
      v_issues := v_issues || jsonb_build_object('code', 'mnp_negative', 'severity', 'blocking', 'section', 'H', 'message', 'The MNP balance is negative at the end of the week');
    end if;
  end if;

  -- I. MUAC screening (events in the week, by the colour band the engine computed, by sex).
  select jsonb_object_agg(band, jsonb_build_object('M', m, 'F', fe, 'total', m + fe)) into i from (
    select band, count(*) filter (where sc.sex = 'M') m, count(*) filter (where sc.sex = 'F') fe
    from unnest(array['green', 'yellow', 'red', 'boundary', 'not_measured']) band
    left join otp_screenings sc on sc.facility_id = p_facility_id and sc.screened_on between ws and we
      and coalesce(sc.result ->> 'muac_band', 'not_measured') = band
    group by band) y;
  select i || jsonb_build_object('total', jsonb_build_object('M', count(*) filter (where sex = 'M'), 'F', count(*) filter (where sex = 'F'), 'total', count(*)),
      'counting', 'screening events (W7)') into i
  from otp_screenings where facility_id = p_facility_id and screened_on between ws and we;

  -- J. IYCF and health education (new form): sessions and participants as recorded; categories not summed (W8).
  select jsonb_build_object(
      'sessions', count(*), 'support_groups', count(*) filter (where kind = 'iycf_support_group'), 'health_education', count(*) filter (where kind = 'health_education'),
      'pregnant_women', sum(pregnant_women), 'breastfeeding_women', sum(breastfeeding_women), 'other_women', sum(other_women),
      'total_participants', sum(total_participants),
      'counting', 'as recorded per session; a woman attending twice is counted twice (W8)') into j
  from iycf_sessions where facility_id = p_facility_id and held_on between ws and we;
  if (j ->> 'sessions')::int = 0 then j := j || jsonb_build_object('status', 'none_recorded'); end if;

  return jsonb_build_object(
    'sections', jsonb_build_object(
      'A', jsonb_build_object('state', v_state.name, 'lga', v_lga.name, 'facility', f.name, 'facility_code', f.facility_code, 'otp_site', f.name,
                              'week_start', ws, 'week_end', we, 'generated_at', now(),
                              'coordinators', (select jsonb_agg(name) from otp_state_coordinators(f.state_id))),
      'B', jsonb_build_object('SAM', b, 'HR_MAM', jsonb_build_object('status', 'not_applicable', 'note', 'No HR MAM admission rule in the guidelines (W4)')),
      'C', jsonb_build_object('SAM', c, 'HR_MAM', jsonb_build_object('status', 'not_applicable')),
      'D', jsonb_build_object('SAM', d, 'HR_MAM', jsonb_build_object('status', 'not_applicable')),
      'E', jsonb_build_object('SAM', e, 'HR_MAM', jsonb_build_object('status', 'not_applicable')),
      'F', jsonb_build_object('SAM', fcl, 'HR_MAM', jsonb_build_object('status', 'not_applicable')),
      'G', g, 'H', h, 'I', i, 'J', j),
    'issues', v_issues);
end;
$$;

-- ── Workflow functions ───────────────────────────────────────────────────────────────────────

-- The OTP Officer opens (or creates) the draft for a week and gets the computed report.
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
    'last_decision', (select jsonb_build_object('decision', decision, 'note', decision_note, 'at', decided_at, 'by', (select name from profiles where id = decided_by))
                      from otp_weekly_report_versions where report_id = v_rep.id and decision is not null order by version desc limit 1),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', version, 'submitted_at', submitted_at, 'decision', decision, 'decided_at', decided_at, 'amendment', amendment) order by version)
                          from otp_weekly_report_versions where report_id = v_rep.id), '[]'::jsonb))
    || v_calc;
end;
$$;

-- Save the officer's explanations on a draft (no submission).
create or replace function otp_report_save_comments(p_report_id uuid, p_comments jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_rep otp_weekly_reports;
begin
  select * into v_rep from otp_weekly_reports where id = p_report_id and facility_id = v_site.id;
  if v_rep.id is null then raise exception 'Report not found at your OTP site'; end if;
  if v_rep.status not in ('draft', 'returned') then raise exception 'This report is % and cannot be changed', v_rep.status; end if;
  update otp_weekly_reports set draft_comments = coalesce(p_comments, '{}'::jsonb), updated_at = now() where id = v_rep.id;
end;
$$;

-- Submit: recompute, require an explanation for every blocking issue and the officer's confirmation,
-- keep the version, lock the report, notify the State Coordinators.
-- p_comments: {"general": "...", "<issue code>": "explanation", ...}
create or replace function otp_report_submit(p_report_id uuid, p_comments jsonb, p_confirm_reviewed boolean, p_amendment_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_rep otp_weekly_reports; v_calc jsonb; v_missing text; v_ver int; c record;
begin
  select * into v_rep from otp_weekly_reports where id = p_report_id and facility_id = v_site.id for update;
  if v_rep.id is null then raise exception 'Report not found at your OTP site'; end if;
  if v_rep.status not in ('draft', 'returned') then raise exception 'This report is % and cannot be submitted again', v_rep.status; end if;
  if v_rep.week_end >= current_date then raise exception 'The week is not over yet: submit from %', v_rep.week_end + 1; end if;
  if coalesce(p_confirm_reviewed, false) is not true then raise exception 'Confirm that you have reviewed the report'; end if;
  if v_rep.amendment and coalesce(trim(p_amendment_reason), '') = '' then raise exception 'Give the reason for amending an approved report'; end if;
  v_calc := otp_weekly_report_compute(v_site.id, v_rep.week_start);
  select string_agg(x ->> 'message', '; ') into v_missing from jsonb_array_elements(v_calc -> 'issues') x
  where x ->> 'severity' = 'blocking' and coalesce(trim(p_comments ->> (x ->> 'code')), '') = '';
  if v_missing is not null then raise exception 'Explain each flagged issue before submitting: %', v_missing; end if;
  v_ver := v_rep.current_version + 1;
  insert into otp_weekly_report_versions (report_id, version, data, issues, comments, amendment, amendment_reason, submitted_by)
  values (v_rep.id, v_ver, v_calc -> 'sections', v_calc -> 'issues', coalesce(p_comments, '{}'::jsonb), v_rep.amendment, nullif(trim(p_amendment_reason), ''), auth.uid());
  update otp_weekly_reports set status = 'submitted', current_version = v_ver, draft_comments = coalesce(p_comments, '{}'::jsonb), updated_at = now() where id = v_rep.id;
  for c in select id from otp_state_coordinators(v_rep.state_id) loop
    perform otp_notify(c.id, format('Weekly OTP report from %s for the week of %s is waiting for your review%s', v_site.name, to_char(v_rep.week_start, 'DD Mon'),
                       case when v_rep.amendment then ' (amendment)' else '' end), '/weekly-reports/' || v_rep.id);
  end loop;
  return jsonb_build_object('report_id', v_rep.id, 'version', v_ver, 'status', 'submitted');
end;
$$;

-- An approved report can only change by an amendment: the officer reopens it as a draft.
create or replace function otp_report_start_amendment(p_report_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_rep otp_weekly_reports;
begin
  select * into v_rep from otp_weekly_reports where id = p_report_id and facility_id = v_site.id for update;
  if v_rep.id is null then raise exception 'Report not found at your OTP site'; end if;
  if v_rep.status <> 'approved' then raise exception 'Only an approved report is amended'; end if;
  update otp_weekly_reports set status = 'draft', amendment = true, updated_at = now() where id = v_rep.id;
end;
$$;

-- The State Coordinator approves or returns the latest submitted version.
create or replace function otp_report_decide(p_report_id uuid, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rep otp_weekly_reports; v_ver otp_weekly_report_versions; v_blocking int; u record; v_site text;
begin
  select * into v_rep from otp_weekly_reports where id = p_report_id for update;
  if v_rep.id is null then raise exception 'Report not found'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and role = 'state_coordinator' and status = 'active' and managed_state_id = v_rep.state_id) then
    raise exception 'Only the State Coordinator for this state may approve or return the report';
  end if;
  if v_rep.status <> 'submitted' then raise exception 'This report is %, not waiting for review', v_rep.status; end if;
  if p_decision not in ('approved', 'returned') then raise exception 'Decision must be approved or returned'; end if;
  if p_decision = 'returned' and coalesce(trim(p_note), '') = '' then raise exception 'Say what needs correcting'; end if;
  select * into v_ver from otp_weekly_report_versions where report_id = v_rep.id and version = v_rep.current_version;
  if v_ver.submitted_by = auth.uid() then raise exception 'You cannot approve a report you submitted'; end if;
  if p_decision = 'approved' then
    select count(*) into v_blocking from jsonb_array_elements(v_ver.issues) x
    where x ->> 'severity' = 'blocking' and coalesce(trim(v_ver.comments ->> (x ->> 'code')), '') = '';
    if v_blocking > 0 then raise exception 'Unexplained blocking issues remain: return the report for correction'; end if;
  end if;
  update otp_weekly_report_versions set decision = p_decision, decision_note = nullif(trim(p_note), ''), decided_by = auth.uid(), decided_at = now() where id = v_ver.id;
  update otp_weekly_reports set status = p_decision, amendment = case when p_decision = 'approved' then false else amendment end, updated_at = now() where id = v_rep.id;
  select name into v_site from facilities where id = v_rep.facility_id;
  for u in select id from profiles where role = 'dri' and status = 'active' and facility_id = v_rep.facility_id loop
    perform otp_notify(u.id, case when p_decision = 'approved'
      then format('Your weekly OTP report for the week of %s was approved', to_char(v_rep.week_start, 'DD Mon'))
      else format('Your weekly OTP report for the week of %s was returned: %s', to_char(v_rep.week_start, 'DD Mon'), trim(p_note)) end, null);
  end loop;
  return jsonb_build_object('report_id', v_rep.id, 'status', p_decision, 'version', v_ver.version);
end;
$$;

-- The coordinator's (and administrators') view of one week across their OTP sites: every site
-- expected to report, its status and headline figures. Aggregate; no child data.
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
           v.submitted_at, v.decided_at, v.issues, v.data
    from sites s join lgas l on l.id = s.lga_id
    left join otp_weekly_reports r on r.facility_id = s.id and r.week_start = ws
    left join otp_weekly_report_versions v on v.report_id = r.id and v.version = r.current_version
  )
  select jsonb_build_object('week_start', ws, 'week_end', ws + 6,
    'due', ws + 6 + rutf_threshold(current_project_id(), 'otp_report_due_days_after', 2)::int,
    'expected', count(*), 'submitted', count(*) filter (where status = 'submitted'), 'approved', count(*) filter (where status = 'approved'),
    'returned', count(*) filter (where status = 'returned'), 'not_submitted', count(*) filter (where status in ('not_started', 'draft')),
    'with_issues', count(*) filter (where jsonb_array_length(coalesce(issues, '[]'::jsonb)) > 0),
    'stock_discrepancies', count(*) filter (where exists (select 1 from jsonb_array_elements(coalesce(issues, '[]'::jsonb)) x where x ->> 'code' like '%count_discrepancy')),
    'totals', jsonb_build_object(
      'new_cases', coalesce(sum((data -> 'C' -> 'SAM' ->> 'total')::int), 0),
      'closing', coalesce(sum((data -> 'F' -> 'SAM' -> 'actual' ->> 'total')::int), 0),
      'cured', coalesce(sum((data -> 'E' -> 'SAM' -> 'cured' ->> 'total')::int), 0),
      'screened', coalesce(sum((data -> 'I' -> 'total' ->> 'total')::int), 0)),
    'sites', coalesce(jsonb_agg(jsonb_build_object('facility_id', facility_id, 'facility', facility, 'lga', lga, 'report_id', report_id, 'status', status,
       'version', current_version, 'amendment', amendment, 'submitted_at', submitted_at, 'decided_at', decided_at,
       'issues', coalesce(jsonb_array_length(issues), 0),
       'new_cases', data -> 'C' -> 'SAM' ->> 'total', 'closing', data -> 'F' -> 'SAM' -> 'actual' ->> 'total') order by status, lga, facility), '[]'::jsonb))
  into v_out from rows;
  return v_out;
end;
$$;

-- One report with every version (the coordinator in scope, administrators, or the site's officer).
create or replace function otp_report_get(p_report_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rep otp_weekly_reports; v_role user_role := current_user_role(); v_me profiles;
begin
  select * into v_rep from otp_weekly_reports where id = p_report_id;
  if v_rep.id is null then raise exception 'Report not found'; end if;
  select * into v_me from profiles where id = auth.uid();
  if not ((v_role = 'state_coordinator' and v_me.managed_state_id = v_rep.state_id)
          or (v_role in ('super_admin', 'project_admin') and in_scope(v_rep.project_id))
          or (v_role = 'dri' and v_me.facility_id = v_rep.facility_id)) then
    raise exception 'You do not have access to this report';
  end if;
  return jsonb_build_object('report_id', v_rep.id, 'status', v_rep.status, 'amendment', v_rep.amendment, 'week_start', v_rep.week_start, 'week_end', v_rep.week_end,
    'facility', (select name from facilities where id = v_rep.facility_id), 'lga', (select name from lgas where id = v_rep.lga_id),
    'can_decide', v_role = 'state_coordinator' and v_me.managed_state_id = v_rep.state_id and v_rep.status = 'submitted',
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', version, 'data', data, 'issues', issues, 'comments', comments,
        'amendment', amendment, 'amendment_reason', amendment_reason, 'submitted_by', (select name from profiles where id = submitted_by), 'submitted_at', submitted_at,
        'decision', decision, 'decision_note', decision_note, 'decided_by', (select name from profiles where id = decided_by), 'decided_at', decided_at) order by version desc)
      from otp_weekly_report_versions where report_id = v_rep.id), '[]'::jsonb));
end;
$$;

-- New forms, OTP Officer at their own site.
create or replace function otp_record_mnp_stock(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_id uuid;
begin
  if nullif(p ->> 'client_id', '') is not null then
    select id into v_id from mnp_stock_movements where client_id = (p ->> 'client_id')::uuid; if v_id is not null then return v_id; end if;
  end if;
  if (p ->> 'movement_date')::date > current_date then raise exception 'The date cannot be in the future'; end if;
  if p ->> 'kind' = 'adjustment' and coalesce(trim(p ->> 'note'), '') = '' then raise exception 'Give the reason for the adjustment'; end if;
  insert into mnp_stock_movements (project_id, facility_id, movement_date, kind, sachets, note, recorded_by, client_id)
  values (v_site.project_id, v_site.id, (p ->> 'movement_date')::date, p ->> 'kind', (p ->> 'sachets')::int, nullif(trim(p ->> 'note'), ''), auth.uid(), nullif(p ->> 'client_id', '')::uuid)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function otp_record_mnp_doses(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_id uuid;
begin
  if nullif(p ->> 'client_id', '') is not null then
    select id into v_id from mnp_doses where client_id = (p ->> 'client_id')::uuid; if v_id is not null then return v_id; end if;
  end if;
  if (p ->> 'given_on')::date > current_date then raise exception 'The date cannot be in the future'; end if;
  insert into mnp_doses (project_id, facility_id, given_on, dose_number, children, recorded_by, client_id)
  values (v_site.project_id, v_site.id, (p ->> 'given_on')::date, (p ->> 'dose_number')::int, (p ->> 'children')::int, auth.uid(), nullif(p ->> 'client_id', '')::uuid)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function otp_record_iycf_session(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_id uuid;
begin
  if nullif(p ->> 'client_id', '') is not null then
    select id into v_id from iycf_sessions where client_id = (p ->> 'client_id')::uuid; if v_id is not null then return v_id; end if;
  end if;
  if (p ->> 'held_on')::date > current_date then raise exception 'The date cannot be in the future'; end if;
  insert into iycf_sessions (project_id, facility_id, held_on, kind, topic, pregnant_women, breastfeeding_women, other_women, total_participants, recorded_by, client_id)
  values (v_site.project_id, v_site.id, (p ->> 'held_on')::date, p ->> 'kind', nullif(trim(p ->> 'topic'), ''),
          nullif(p ->> 'pregnant_women', '')::int, nullif(p ->> 'breastfeeding_women', '')::int, nullif(p ->> 'other_women', '')::int,
          nullif(p ->> 'total_participants', '')::int, auth.uid(), nullif(p ->> 'client_id', '')::uuid)
  returning id into v_id;
  return v_id;
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────
revoke execute on function otp_week_of(date, uuid), otp_state_coordinators(uuid), otp_notify(uuid, text, text),
  otp_weekly_report_compute(uuid, date) from public, anon, authenticated;
revoke execute on function otp_report_open(date), otp_report_save_comments(uuid, jsonb), otp_report_submit(uuid, jsonb, boolean, text),
  otp_report_start_amendment(uuid), otp_report_decide(uuid, text, text), otp_reports_overview(date, uuid), otp_report_get(uuid),
  otp_record_mnp_stock(jsonb), otp_record_mnp_doses(jsonb), otp_record_iycf_session(jsonb) from public, anon;
grant execute on function otp_report_open(date), otp_report_save_comments(uuid, jsonb), otp_report_submit(uuid, jsonb, boolean, text),
  otp_report_start_amendment(uuid), otp_report_decide(uuid, text, text), otp_reports_overview(date, uuid), otp_report_get(uuid),
  otp_record_mnp_stock(jsonb), otp_record_mnp_doses(jsonb), otp_record_iycf_session(jsonb) to authenticated;
