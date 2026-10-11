-- RUTF Monitoring Platform — migration 0137: the OTP Officer sees a query on their report (R171)
-- otp_report_open (what the app's Weekly OTP Report screen reads) also returns the open query
-- (status 'queried', 0136) and the report's history, so the officer can answer it in the app
-- (otp_report_act(id, 'answer', text)).

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
    'open_query', case when v_rep.status = 'queried' then otp_report_open_query(v_rep.id) end,
    'events', report_events_list('otp', v_rep.id),
    'adjustments', otp_report_adjustments_list(v_rep.id),
    'last_decision', (select jsonb_build_object('decision', decision, 'note', decision_note, 'at', decided_at, 'by', (select name from profiles where id = decided_by))
                      from otp_weekly_report_versions where report_id = v_rep.id and decision is not null order by version desc limit 1),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', version, 'submitted_at', submitted_at, 'decision', decision, 'decided_at', decided_at, 'amendment', amendment) order by version)
                          from otp_weekly_report_versions where report_id = v_rep.id), '[]'::jsonb))
    || v_calc;
end;
$$;
