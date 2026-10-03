-- RUTF Monitoring Platform — migration 0107 (performance, no change in who sees what)
-- The RUTF read policies called current_user_role() / in_scope() / current_facility_id() once
-- per row; each call looks up the caller's profile. Over the ~17k-row ledger that made
-- rutf_kpis() hit the API's statement timeout for a reviewer. Wrapping the per-caller values in
-- (select …) lets Postgres evaluate them once per query (an initplan) — Supabase's documented RLS
-- pattern. The rules are identical; test-mobile-role-access, test-ledger, test-findings and
-- test-visits still pass (DECISIONS R40).

-- "In my project" with the caller's values evaluated once: same as in_scope(project_id).
-- in_scope(p) = is_super_admin() or current_project_id() is null or current_project_id() = p

drop policy if exists facilities_select on facilities;
create policy facilities_select on facilities for select to authenticated
  using (
    (select is_super_admin())
    or submitted_by = (select auth.uid())
    or ((select current_user_role()) = 'project_admin'
        and ((select current_project_id()) is null or project_id = (select current_project_id())))
    or (
      status = 'approved'
      and case
        when (select current_user_role()) = 'dri' then
          id = (select current_facility_id())
          or id = (select current_facility_supplier_id())
          or supplied_by_facility_id = (select current_facility_id())
        else (select current_project_id()) is null or project_id = (select current_project_id())
      end
    )
  );

drop policy if exists transfers_select on transfers;
create policy transfers_select on transfers for select to authenticated
  using (case when (select current_user_role()) = 'dri'
              then (select current_facility_id()) in (from_facility_id, to_facility_id)
              else (select is_super_admin()) or (select current_project_id()) is null or project_id = (select current_project_id()) end);

drop policy if exists stock_transactions_select on stock_transactions;
create policy stock_transactions_select on stock_transactions for select to authenticated
  using (case when (select current_user_role()) = 'dri'
              then facility_id = (select current_facility_id())
                   or (txn_type = 'issue' and counterparty_facility_id = (select current_facility_id()))
              else (select is_super_admin()) or (select current_project_id()) is null or project_id = (select current_project_id()) end);

drop policy if exists otp_daily_dispensing_select on otp_daily_dispensing;
create policy otp_daily_dispensing_select on otp_daily_dispensing for select to authenticated
  using (case when (select current_user_role()) = 'dri' then facility_id = (select current_facility_id())
              else (select is_super_admin()) or (select current_project_id()) is null or project_id = (select current_project_id()) end);

drop policy if exists monitoring_visits_select on monitoring_visits;
create policy monitoring_visits_select on monitoring_visits for select to authenticated
  using (case when (select current_user_role()) = 'dri' then facility_id = (select current_facility_id())
              else supervisor_id = (select auth.uid()) or (select is_super_admin())
                   or (select current_project_id()) is null or project_id = (select current_project_id()) end);

-- Visit child rows: visible when their visit is (the visit policy above does the scoping).
drop policy if exists stock_check_lines_select on stock_check_lines;
create policy stock_check_lines_select on stock_check_lines for select to authenticated
  using (exists (select 1 from monitoring_visits v where v.id = visit_id));
drop policy if exists store_checks_select on store_checks;
create policy store_checks_select on store_checks for select to authenticated
  using (exists (select 1 from monitoring_visits v where v.id = visit_id));
drop policy if exists otp_verifications_select on otp_verifications;
create policy otp_verifications_select on otp_verifications for select to authenticated
  using (exists (select 1 from monitoring_visits v where v.id = visit_id));

drop policy if exists dhis2_reports_select on dhis2_reports;
create policy dhis2_reports_select on dhis2_reports for select to authenticated
  using ((select is_super_admin()) or (select current_project_id()) is null or project_id = (select current_project_id()));
