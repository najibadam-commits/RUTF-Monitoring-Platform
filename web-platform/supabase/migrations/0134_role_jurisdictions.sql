-- RUTF Monitoring Platform — migration 0134: role jurisdictions (DECISIONS R169)
-- Each role sees the stock, facilities, supervision visits and OTP aggregates of its own
-- jurisdiction (the user's role standardisation, 11 Oct 2026):
--   State Nutrition Officer (officer at the State store) — every facility in the state
--   LGA Nutrition Officer   (officer at an LGA store)    — their store and the health facilities of its LGA
--   OTP Officer             (officer at an OTP site)     — the site only (unchanged)
--   Supervisor                                           — the LGAs in supervisor_lgas
--   State Coordinator                                    — the state in managed_state_id
--   Super Admin / Project Admin / Viewer                 — the project (unchanged)
-- Before this, a facility officer saw only their own facility's stock, and Supervisors and State
-- Coordinators the whole project. Child-level OTP data is unchanged: it stays with the OTP
-- Officer at the child's site (otp_child_at_my_site); others see aggregates only.

-- ── The jurisdiction ──────────────────────────────────────────────────────────────────────────
-- Used as `facility_id in (select rutf_scope_facility_ids())`, which Postgres evaluates once per
-- query (an uncorrelated subquery), so the RLS stays as cheap as 0107's.
create or replace function rutf_scope_facility_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  with me as (
    select p.id, p.role, p.project_id, p.facility_id, p.managed_state_id from profiles p where p.id = auth.uid()
  ), mine as (
    select f.id, f.facility_type, f.lga_id, f.state_id from facilities f join me on f.id = me.facility_id
  )
  select f.id
  from facilities f cross join me left join mine on true
  where case
    when me.role = 'super_admin' then true
    when me.role in ('project_admin', 'viewer') or (me.role = 'state_coordinator' and me.managed_state_id is null)
      then me.project_id is null or f.project_id = me.project_id
    when me.role = 'state_coordinator'
      then f.state_id = me.managed_state_id and (me.project_id is null or f.project_id = me.project_id)
    when me.role = 'tpm_supervisor'
      then f.lga_id in (select s.lga_id from supervisor_lgas s where s.profile_id = me.id)
           and (me.project_id is null or f.project_id = me.project_id)
    when me.role = 'dri' then
      f.id = me.facility_id
      -- an LGA store's officer: the health facilities (OTP sites) of the LGA — never another store,
      -- even the State store when it stands in the same LGA
      or (mine.facility_type = 'lga_store' and f.facility_type = 'health_facility'
          and (f.lga_id = mine.lga_id or f.supplied_by_facility_id = mine.id))
      or (mine.facility_type = 'state_store' and (f.state_id = mine.state_id or f.supplied_by_facility_id = mine.id))
    else false
  end;
$$;
comment on function rutf_scope_facility_ids() is
  'The facilities whose stock, visits and aggregates the caller may see — their jurisdiction (DECISIONS R169).';

-- The caller's officer level: 'state' / 'lga' / 'otp' for a facility officer, null otherwise.
create or replace function rutf_officer_level()
returns text language sql stable security definer set search_path = public as $$
  select case f.facility_type when 'state_store' then 'state' when 'lga_store' then 'lga' else 'otp' end
  from profiles p join facilities f on f.id = p.facility_id
  where p.id = auth.uid() and p.role = 'dri';
$$;

-- May the caller see this facility's records? (for functions; RLS uses the set form above)
create or replace function rutf_can_see_facility(p_facility_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from rutf_scope_facility_ids() x where x = p_facility_id);
$$;

revoke execute on function rutf_scope_facility_ids(), rutf_officer_level(), rutf_can_see_facility(uuid) from public, anon;
grant execute on function rutf_scope_facility_ids(), rutf_officer_level(), rutf_can_see_facility(uuid) to authenticated;

-- ── Read policies ─────────────────────────────────────────────────────────────────────────────
-- Facilities: the jurisdiction, plus (for a facility officer) their supplier and the facilities
-- they supply — what the app needs to receive and issue. Pending rows: submitter and approvers.
drop policy if exists facilities_select on facilities;
create policy facilities_select on facilities for select to authenticated
  using (
    (select is_super_admin())
    or submitted_by = (select auth.uid())
    or ((select current_user_role()) = 'project_admin'
        and ((select current_project_id()) is null or project_id = (select current_project_id())))
    or (
      status = 'approved'
      and (
        id in (select rutf_scope_facility_ids())
        or ((select current_user_role()) = 'dri'
            and (id = (select current_facility_supplier_id()) or supplied_by_facility_id = (select current_facility_id())))
      )
    )
  );

-- Transfers: either end in the jurisdiction.
drop policy if exists transfers_select on transfers;
create policy transfers_select on transfers for select to authenticated
  using (from_facility_id in (select rutf_scope_facility_ids()) or to_facility_id in (select rutf_scope_facility_ids()));

-- Ledger: the facility in the jurisdiction. (A facility officer does not see the supplier's issue
-- rows addressed to them — incoming_transfer_lines() pre-fills the receipt instead, 0108/R44.)
drop policy if exists stock_transactions_select on stock_transactions;
create policy stock_transactions_select on stock_transactions for select to authenticated
  using (facility_id in (select rutf_scope_facility_ids()));

drop policy if exists otp_daily_dispensing_select on otp_daily_dispensing_entries;
create policy otp_daily_dispensing_select on otp_daily_dispensing_entries for select to authenticated
  using (facility_id in (select rutf_scope_facility_ids()));

drop policy if exists ledger_photos_select on ledger_photos;
create policy ledger_photos_select on ledger_photos for select to authenticated
  using (facility_id in (select rutf_scope_facility_ids()));

drop policy if exists dhis2_reports_select on dhis2_reports;
create policy dhis2_reports_select on dhis2_reports for select to authenticated
  using (facility_id in (select rutf_scope_facility_ids()));

-- Supervision visits: the supervisor's own, or at a facility in the jurisdiction.
drop policy if exists monitoring_visits_select on monitoring_visits;
create policy monitoring_visits_select on monitoring_visits for select to authenticated
  using (supervisor_id = (select auth.uid()) or facility_id in (select rutf_scope_facility_ids()));

create or replace function can_see_visit(p_visit_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from monitoring_visits v where v.id = p_visit_id
      and (v.supervisor_id = auth.uid() or v.facility_id in (select rutf_scope_facility_ids()))
  );
$$;

-- ── OTP aggregates: limited to the jurisdiction (no child-level data either way) ──────────────
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
    where (select in_scope(c.project_id)) and a.facility_id in (select rutf_scope_facility_ids()) and (p_lga_id is null or f.lga_id = p_lga_id) and (p_facility_id is null or a.facility_id = p_facility_id)
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

create or replace function otp_followup_aggregates(p_start date, p_end date, p_lga_id uuid default null, p_facility_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_project uuid := current_project_id(); v_min int; v_out jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to see OTP figures'; end if;
  v_min := rutf_threshold(v_project, 'otp_min_cell_count', 5)::int;
  with scope as (
    select a.id, a.facility_id from otp_admissions a join otp_children c on c.id = a.child_id join facilities f on f.id = a.facility_id
    where (select in_scope(c.project_id)) and a.facility_id in (select rutf_scope_facility_ids()) and (p_lga_id is null or f.lga_id = p_lga_id) and (p_facility_id is null or a.facility_id = p_facility_id)
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
