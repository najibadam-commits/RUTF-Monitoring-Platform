-- RUTF Monitoring Platform — migration 0125
-- OTP Caseload privacy fix (DECISIONS R144): complementary suppression in otp_aggregates(). With the
-- admissions total shown, a single hidden cell in the sex × age table (a count of 1–4) could be
-- worked out by subtraction; when exactly one cell is small, the next smallest is now hidden too.

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
  ), grp as (
    select sex || ':' || case when age < 12 then '6-11' when age < 24 then '12-23' else '24-59' end as g, count(*) as n,
           count(*) between 1 and v_min - 1 as small
    from scope where admitted_on between p_start and p_end group by 1
  ), compl as (
    -- Complementary suppression: one hidden cell could be worked out from the total by
    -- subtraction, so when exactly one cell is small, the next smallest cell is hidden too.
    select g from grp where not small and (select count(*) from grp where small) = 1 order by n, g limit 1
  ), by_group as (
    select coalesce(jsonb_object_agg(g, case when small or g in (select g from compl) then null else n end), '{}'::jsonb) as cells,
           bool_or(small) as suppressed
    from grp
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

revoke execute on function otp_aggregates(date, date, uuid, uuid) from public, anon;
grant execute on function otp_aggregates(date, date, uuid, uuid) to authenticated;
