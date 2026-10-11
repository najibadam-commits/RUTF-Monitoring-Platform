-- RUTF Monitoring Platform — migration 0136: the report review chain (DECISIONS R171)
-- The user's role standardisation, 11 Oct 2026:
--   OTP weekly report  -> reviewed by the LGA Nutrition Officer of its LGA (accept, query, return, reject)
--                         (until now the State Coordinator reviewed every OTP report)
--   LGA weekly report  -> combined automatically from the LGA's accepted OTP reports, reviewed and
--                         submitted by the LGA Nutrition Officer, accepted by the State Nutrition Officer
--   Statewide report   -> combined automatically from the accepted LGA reports
-- The State Coordinator keeps technical oversight: sees every report in the state, may query or
-- return an OTP or LGA report, but does not accept. Supervisors see the reports of their LGAs.
-- New status 'queried': a question to the submitter, answered without reopening the figures; the
-- answer resubmits the same version. 'returned' still reopens the figures for correction.
-- Every step is a row in report_events (who, role, when, note, status before/after).

-- ── Status and history ────────────────────────────────────────────────────────────────────────
alter table otp_weekly_reports drop constraint otp_weekly_reports_status_check;
alter table otp_weekly_reports add constraint otp_weekly_reports_status_check
  check (status in ('draft', 'submitted', 'under_review', 'queried', 'returned', 'approved', 'rejected'));

create table report_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('otp', 'lga')),
  report_id uuid not null,
  version int,
  action text not null check (action in ('submitted', 'review_started', 'queried', 'answered', 'returned',
                                         'accepted', 'rejected', 'reopened', 'comment')),
  actor uuid references profiles(id),
  actor_role text,
  note text,
  status_before text,
  status_after text,
  created_at timestamptz not null default now()
);
create index report_events_report_idx on report_events(kind, report_id, created_at);
alter table report_events enable row level security;
revoke all on table report_events from anon, authenticated;

create or replace function report_log(p_kind text, p_report_id uuid, p_version int, p_action text, p_note text, p_before text, p_after text)
returns void language sql security definer set search_path = public as $$
  insert into report_events (kind, report_id, version, action, actor, actor_role, note, status_before, status_after)
  values (p_kind, p_report_id, p_version, p_action, auth.uid(), rutf_role_title(), nullif(trim(p_note), ''), p_before, p_after);
$$;

create or replace function report_events_list(p_kind text, p_report_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('version', e.version, 'action', e.action, 'actor', p.name, 'actor_role', e.actor_role,
           'note', e.note, 'status_before', e.status_before, 'status_after', e.status_after, 'at', e.created_at) order by e.created_at), '[]'::jsonb)
  from report_events e left join profiles p on p.id = e.actor where e.kind = p_kind and e.report_id = p_report_id;
$$;

-- ── Who is who ────────────────────────────────────────────────────────────────────────────────
create or replace function rutf_lga_nutritionists(p_lga_id uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from profiles p join facilities f on f.id = p.facility_id
  where p.role = 'dri' and p.status = 'active' and f.facility_type = 'lga_store' and f.lga_id = p_lga_id;
$$;
create or replace function rutf_state_nutritionists(p_state_id uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from profiles p join facilities f on f.id = p.facility_id
  where p.role = 'dri' and p.status = 'active' and f.facility_type = 'state_store' and f.state_id = p_state_id;
$$;
create or replace function rutf_is_lga_nutritionist(p_lga_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() in (select rutf_lga_nutritionists(p_lga_id));
$$;
create or replace function rutf_is_state_nutritionist(p_state_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() in (select rutf_state_nutritionists(p_state_id));
$$;
create or replace function rutf_is_state_coordinator(p_state_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'state_coordinator' and status = 'active' and managed_state_id = p_state_id);
$$;
-- May the caller see this LGA's reports? (any of its facilities in their jurisdiction)
create or replace function rutf_can_see_lga(p_lga_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from facilities f where f.lga_id = p_lga_id and f.id in (select rutf_scope_facility_ids()));
$$;

create or replace function otp_report_officers(p_facility_id uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from profiles where role = 'dri' and status = 'active' and facility_id = p_facility_id;
$$;

-- ── OTP weekly report: submit goes to the LGA Nutrition Officer ────────────────────────────────────
create or replace function otp_report_submit(p_report_id uuid, p_comments jsonb, p_confirm_reviewed boolean, p_amendment_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_rep otp_weekly_reports; v_calc jsonb; v_data jsonb; v_adj jsonb := '[]'::jsonb; v_missing text; v_ver int; c uuid; a record;
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
  perform report_log('otp', v_rep.id, v_ver, 'submitted', p_amendment_reason, v_rep.status, 'submitted');
  for c in select rutf_lga_nutritionists(v_rep.lga_id) loop
    perform otp_notify(c, format('Weekly OTP report from %s for the week of %s is waiting for your review%s', v_site.name, to_char(v_rep.week_start, 'DD Mon'),
                       case when v_rep.amendment then ' (amendment)' when v_ver > 1 then ' (resubmitted)' else '' end), '/weekly-reports/' || v_rep.id);
  end loop;
  return jsonb_build_object('report_id', v_rep.id, 'version', v_ver, 'status', 'submitted', 'adjustments', jsonb_array_length(v_adj));
end;
$$;

-- ── OTP weekly report: the LGA Nutrition Officer reviews ───────────────────────────────────────────
create or replace function otp_report_start_review(p_report_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rep otp_weekly_reports;
begin
  select * into v_rep from otp_weekly_reports where id = p_report_id for update;
  if v_rep.id is null then raise exception 'Report not found'; end if;
  if not rutf_is_lga_nutritionist(v_rep.lga_id) then raise exception 'Only the LGA Nutrition Officer for this LGA reviews the report'; end if;
  if v_rep.status = 'submitted' then
    update otp_weekly_reports set status = 'under_review', updated_at = now() where id = v_rep.id;
    update otp_weekly_report_versions set review_started_by = auth.uid(), review_started_at = now()
    where report_id = v_rep.id and version = v_rep.current_version and review_started_at is null;
    perform report_log('otp', v_rep.id, v_rep.current_version, 'review_started', null, 'submitted', 'under_review');
    return jsonb_build_object('report_id', v_rep.id, 'status', 'under_review');
  end if;
  return jsonb_build_object('report_id', v_rep.id, 'status', v_rep.status);
end;
$$;

-- approved (shown as Accepted) and rejected: the LGA Nutrition Officer. returned: the LGA Nutrition Officer,
-- or the State Coordinator (technical oversight).
create or replace function otp_report_decide(p_report_id uuid, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rep otp_weekly_reports; v_ver otp_weekly_report_versions; v_blocking int; u uuid; v_lga boolean; v_sc boolean;
begin
  select * into v_rep from otp_weekly_reports where id = p_report_id for update;
  if v_rep.id is null then raise exception 'Report not found'; end if;
  v_lga := rutf_is_lga_nutritionist(v_rep.lga_id);
  v_sc := rutf_is_state_coordinator(v_rep.state_id);
  if p_decision not in ('approved', 'returned', 'rejected') then raise exception 'Decision must be approved, returned or rejected'; end if;
  if not (v_lga or (v_sc and p_decision = 'returned')) then
    raise exception 'Only the LGA Nutrition Officer for this LGA accepts or rejects the report; the State Coordinator may return it for correction';
  end if;
  if v_rep.status not in ('submitted', 'under_review') then raise exception 'This report is %, not waiting for review', v_rep.status; end if;
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
  perform report_log('otp', v_rep.id, v_ver.version, case p_decision when 'approved' then 'accepted' else p_decision end, p_note, v_rep.status, p_decision);
  for u in select otp_report_officers(v_rep.facility_id) loop
    perform otp_notify(u, case p_decision
      when 'approved' then format('Your weekly OTP report for the week of %s was accepted', to_char(v_rep.week_start, 'DD Mon'))
      when 'returned' then format('Your weekly OTP report for the week of %s was returned for correction: %s', to_char(v_rep.week_start, 'DD Mon'), trim(p_note))
      else format('Your weekly OTP report for the week of %s was rejected: %s. Start an amendment to submit a new version.', to_char(v_rep.week_start, 'DD Mon'), trim(p_note)) end, null);
  end loop;
  return jsonb_build_object('report_id', v_rep.id, 'status', p_decision, 'version', v_ver.version);
end;
$$;

-- query: the LGA Nutrition Officer or the State Coordinator asks; answer: the OTP Officer replies
-- (the same version goes back for review — shown as resubmitted).
create or replace function otp_report_act(p_report_id uuid, p_action text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rep otp_weekly_reports; u uuid; v_querier uuid;
begin
  select * into v_rep from otp_weekly_reports where id = p_report_id for update;
  if v_rep.id is null then raise exception 'Report not found'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Write the %', case p_action when 'answer' then 'answer' else 'question' end; end if;
  if p_action = 'query' then
    if not (rutf_is_lga_nutritionist(v_rep.lga_id) or rutf_is_state_coordinator(v_rep.state_id)) then
      raise exception 'Only the LGA Nutrition Officer or the State Coordinator queries the report';
    end if;
    if v_rep.status not in ('submitted', 'under_review') then raise exception 'This report is %, not waiting for review', v_rep.status; end if;
    update otp_weekly_reports set status = 'queried', updated_at = now() where id = v_rep.id;
    perform report_log('otp', v_rep.id, v_rep.current_version, 'queried', p_note, v_rep.status, 'queried');
    for u in select otp_report_officers(v_rep.facility_id) loop
      perform otp_notify(u, format('Your weekly OTP report for the week of %s was queried: %s', to_char(v_rep.week_start, 'DD Mon'), left(trim(p_note), 160)), null);
    end loop;
    return jsonb_build_object('report_id', v_rep.id, 'status', 'queried');
  elsif p_action = 'answer' then
    if not exists (select 1 from profiles where id = auth.uid() and role = 'dri' and status = 'active' and facility_id = v_rep.facility_id) then
      raise exception 'Only the OTP Officer at the site answers the query';
    end if;
    if v_rep.status <> 'queried' then raise exception 'This report is not queried'; end if;
    update otp_weekly_reports set status = 'submitted', updated_at = now() where id = v_rep.id;
    perform report_log('otp', v_rep.id, v_rep.current_version, 'answered', p_note, 'queried', 'submitted');
    select actor into v_querier from report_events where kind = 'otp' and report_id = v_rep.id and action = 'queried' order by created_at desc limit 1;
    for u in select x from (select rutf_lga_nutritionists(v_rep.lga_id) x union select v_querier) y where x is not null loop
      perform otp_notify(u, format('The query on the weekly OTP report from %s (week of %s) was answered',
        (select name from facilities where id = v_rep.facility_id), to_char(v_rep.week_start, 'DD Mon')), '/weekly-reports/' || v_rep.id);
    end loop;
    return jsonb_build_object('report_id', v_rep.id, 'status', 'submitted');
  end if;
  raise exception 'Unknown action %', p_action;
end;
$$;

-- The OTP Officer's report screen shows the open query (the app reads it from otp_report_open).
create or replace function otp_report_open_query(p_report_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('note', e.note, 'by', p.name, 'role', e.actor_role, 'at', e.created_at)
  from report_events e left join profiles p on p.id = e.actor
  where e.kind = 'otp' and e.report_id = p_report_id and e.action = 'queried'
  order by e.created_at desc limit 1;
$$;

create or replace function otp_report_get_query(p_report_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_site facilities := otp_officer_site(); v_rep otp_weekly_reports;
begin
  select * into v_rep from otp_weekly_reports where id = p_report_id and facility_id = v_site.id;
  if v_rep.id is null then raise exception 'Report not found at your OTP site'; end if;
  return jsonb_build_object('status', v_rep.status,
    'query', case when v_rep.status = 'queried' then otp_report_open_query(v_rep.id) end,
    'events', report_events_list('otp', v_rep.id));
end;
$$;

-- ── OTP weekly report: who sees the overview and a report ─────────────────────────────────────
create or replace function otp_reports_overview(p_week_start date, p_lga_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_role user_role := current_user_role(); ws date := lower(otp_week_of(p_week_start))::date; v_out jsonb;
begin
  if not (v_role in ('state_coordinator', 'super_admin', 'project_admin', 'tpm_supervisor') or rutf_officer_level() in ('lga', 'state')) then
    raise exception 'Your role does not review weekly OTP reports';
  end if;
  with sites as (
    select f.* from facilities f
    where f.facility_type = 'health_facility' and f.is_otp_site and f.is_active and f.status = 'approved'
      and f.id in (select rutf_scope_facility_ids())
      and (p_lga_id is null or f.lga_id = p_lga_id)
  ), rows as (
    select s.id facility_id, s.name facility, s.lga_id, l.name lga, r.id report_id, coalesce(r.status, 'not_started') status, r.current_version, r.amendment,
           v.submitted_at, v.decided_at, v.issues, v.data, jsonb_array_length(coalesce(v.adjustments, '[]'::jsonb)) adjustments
    from sites s join lgas l on l.id = s.lga_id
    left join otp_weekly_reports r on r.facility_id = s.id and r.week_start = ws
    left join otp_weekly_report_versions v on v.report_id = r.id and v.version = r.current_version
  )
  select jsonb_build_object('week_start', ws, 'week_end', ws + 6,
    'due', ws + 6 + rutf_threshold(current_project_id(), 'otp_report_due_days_after', 2)::int,
    'expected', count(*), 'submitted', count(*) filter (where status = 'submitted'), 'under_review', count(*) filter (where status = 'under_review'),
    'queried', count(*) filter (where status = 'queried'),
    'approved', count(*) filter (where status = 'approved'), 'returned', count(*) filter (where status = 'returned'),
    'rejected', count(*) filter (where status = 'rejected'), 'not_submitted', count(*) filter (where status in ('not_started', 'draft')),
    'with_issues', count(*) filter (where jsonb_array_length(coalesce(issues, '[]'::jsonb)) > 0),
    'with_corrections', count(*) filter (where adjustments > 0),
    'stock_discrepancies', count(*) filter (where exists (select 1 from jsonb_array_elements(coalesce(issues, '[]'::jsonb)) x where x ->> 'code' like '%count_discrepancy')),
    'i_review', exists (select 1 from rows x where rutf_is_lga_nutritionist(x.lga_id)),
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

create or replace function otp_report_get(p_report_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rep otp_weekly_reports; v_role user_role := current_user_role(); v_me profiles; v_lga boolean; v_sc boolean;
begin
  select * into v_rep from otp_weekly_reports where id = p_report_id;
  if v_rep.id is null then raise exception 'Report not found'; end if;
  select * into v_me from profiles where id = auth.uid();
  v_lga := rutf_is_lga_nutritionist(v_rep.lga_id);
  v_sc := rutf_is_state_coordinator(v_rep.state_id);
  if not ((v_role = 'dri' and v_me.facility_id = v_rep.facility_id)
          or ((v_role in ('super_admin', 'project_admin', 'state_coordinator', 'tpm_supervisor') or rutf_officer_level() in ('lga', 'state'))
              and rutf_can_see_facility(v_rep.facility_id))) then
    raise exception 'You do not have access to this report';
  end if;
  return jsonb_build_object('report_id', v_rep.id, 'status', v_rep.status, 'amendment', v_rep.amendment, 'week_start', v_rep.week_start, 'week_end', v_rep.week_end,
    'facility', (select name from facilities where id = v_rep.facility_id), 'lga', (select name from lgas where id = v_rep.lga_id), 'lga_id', v_rep.lga_id,
    'can_decide', v_lga and v_rep.status in ('submitted', 'under_review'),
    'can_return', (v_lga or v_sc) and v_rep.status in ('submitted', 'under_review'),
    'can_query', (v_lga or v_sc) and v_rep.status in ('submitted', 'under_review'),
    'can_start_review', v_lga and v_rep.status = 'submitted',
    'open_query', case when v_rep.status = 'queried' then otp_report_open_query(v_rep.id) end,
    'events', report_events_list('otp', v_rep.id),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', version, 'data', data, 'issues', issues, 'comments', comments, 'adjustments', adjustments,
        'amendment', amendment, 'amendment_reason', amendment_reason, 'submitted_by', (select name from profiles where id = submitted_by), 'submitted_at', submitted_at,
        'review_started_by', (select name from profiles where id = review_started_by), 'review_started_at', review_started_at,
        'decision', decision, 'decision_note', decision_note, 'decided_by', (select name from profiles where id = decided_by), 'decided_at', decided_at) order by version desc)
      from otp_weekly_report_versions where report_id = v_rep.id), '[]'::jsonb));
end;
$$;

-- ── LGA weekly report ─────────────────────────────────────────────────────────────────────────
create table lga_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  state_id uuid not null references states(id),
  lga_id uuid not null references lgas(id),
  week_start date not null,
  week_end date not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'under_review', 'queried', 'returned', 'accepted', 'rejected')),
  amendment boolean not null default false,
  current_version int not null default 0,
  draft_comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lga_id, week_start)
);
create table lga_weekly_report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references lga_weekly_reports(id),
  version int not null,
  data jsonb not null,          -- the combined sections, the LGA store's stock, supply requests
  sites jsonb not null,         -- every OTP site: its report, status and the version included
  comments text,                -- the LGA Nutrition Officer's comments and explanations
  amendment boolean not null default false,
  amendment_reason text,
  submitted_by uuid not null references profiles(id),
  submitted_at timestamptz not null default now(),
  decision text check (decision in ('accepted', 'returned', 'rejected')),
  decision_note text,
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  unique (report_id, version)
);
do $$
declare t text;
begin
  foreach t in array array['lga_weekly_reports', 'lga_weekly_report_versions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
    execute format('create trigger %1$s_audit after insert or update or delete on %1$s for each row execute function audit_row_change()', t);
  end loop;
end $$;

-- Adds two report sections: numbers are summed at the same place, everything else is kept from
-- the first. Fixed facts (sachets per carton) are not summed.
create or replace function jsonb_deep_sum(a jsonb, b jsonb)
returns jsonb language plpgsql immutable as $$
declare k text; v_out jsonb;
begin
  if a is null then return b; end if;
  if b is null then return a; end if;
  if jsonb_typeof(a) = 'number' and jsonb_typeof(b) = 'number' then return to_jsonb((a #>> '{}')::numeric + (b #>> '{}')::numeric); end if;
  if jsonb_typeof(a) <> 'object' or jsonb_typeof(b) <> 'object' then return a; end if;
  v_out := a;
  for k in select jsonb_object_keys(b) loop
    if k in ('sachets_per_carton', 'mnp_sachets_per_carton', 'mnp_sachets_per_box') then
      v_out := v_out || jsonb_build_object(k, coalesce(a -> k, b -> k));
    else
      v_out := v_out || jsonb_build_object(k, jsonb_deep_sum(a -> k, b -> k));
    end if;
  end loop;
  return v_out;
end;
$$;

-- The combined LGA report for a week, live. Eligible: each site's latest accepted version (an
-- amendment in progress keeps its last accepted version until the new one is accepted), each
-- counted once. Every site is listed with its status, so missing, pending, queried, returned and
-- rejected reports are visible.
create or replace function lga_weekly_report_compute(p_lga_id uuid, p_week_start date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ws date := lower(otp_week_of(p_week_start))::date; we date; v_sum jsonb; v_sites jsonb; v_store facilities;
  v_issues jsonb := '[]'::jsonb; v_lga lgas; s record; v_n int := 0; v_store_sec jsonb; v_supply jsonb;
begin
  we := ws + 6;
  select * into v_lga from lgas where id = p_lga_id;
  select * into v_store from facilities where lga_id = p_lga_id and facility_type = 'lga_store' and status = 'approved' order by is_active desc, name limit 1;
  v_sites := '[]'::jsonb;
  for s in
    select f.id, f.name, f.facility_code, r.id report_id, coalesce(r.status, 'not_started') status, r.current_version, r.amendment,
           acc.version acc_version, acc.data acc_data
    from facilities f
    left join otp_weekly_reports r on r.facility_id = f.id and r.week_start = ws
    left join lateral (select v.version, v.data from otp_weekly_report_versions v where v.report_id = r.id and v.decision = 'approved'
                       order by v.version desc limit 1) acc on true
    where f.lga_id = p_lga_id and f.facility_type = 'health_facility' and f.is_otp_site and f.is_active and f.status = 'approved'
    order by f.name
  loop
    v_sites := v_sites || jsonb_build_object('facility_id', s.id, 'facility', s.name, 'facility_code', s.facility_code, 'report_id', s.report_id,
      'status', s.status, 'current_version', s.current_version, 'amendment', s.amendment,
      'included_version', s.acc_version, 'included', s.acc_version is not null,
      'new_cases', s.acc_data -> 'C' -> 'SAM' ->> 'total', 'closing', s.acc_data -> 'F' -> 'SAM' -> 'actual' ->> 'total',
      'dispensed', s.acc_data -> 'G' ->> 'dispensed', 'physical_count', s.acc_data -> 'G' ->> 'physical_count');
    if s.acc_version is not null then
      v_sum := jsonb_deep_sum(v_sum, s.acc_data - 'A');
      v_n := v_n + 1;
    end if;
  end loop;

  if v_store.id is not null then
    select jsonb_build_object('store', v_store.name, 'opening', ledger_balance(v_store.id, null, ws - 1),
      'received', coalesce(sum(quantity_sachets) filter (where txn_type = 'receipt'), 0),
      'issued', coalesce(sum(quantity_sachets) filter (where txn_type = 'issue'), 0),
      'losses', coalesce(sum(quantity_sachets) filter (where txn_type in ('loss_damaged', 'loss_expired', 'loss_other')), 0),
      'adjustments', coalesce(sum(quantity_sachets) filter (where txn_type = 'adjustment'), 0),
      'closing', ledger_balance(v_store.id, null, we))
    into v_store_sec
    from stock_transactions where facility_id = v_store.id and status <> 'voided' and txn_date between ws and we;
  end if;

  select jsonb_build_object(
    'from_otp_sites', jsonb_build_object('count', count(*) filter (where r.level = 'otp_to_lga'),
       'sachets_requested', coalesce(sum(l.req) filter (where r.level = 'otp_to_lga'), 0),
       'sachets_approved', coalesce(sum(l.appr) filter (where r.level = 'otp_to_lga'), 0)),
    'to_state', jsonb_build_object('count', count(*) filter (where r.level = 'lga_to_state'),
       'sachets_requested', coalesce(sum(l.req) filter (where r.level = 'lga_to_state'), 0),
       'sachets_approved', coalesce(sum(l.appr) filter (where r.level = 'lga_to_state'), 0)))
  into v_supply
  from supply_requests r
  join facilities f on f.id = r.from_facility_id
  left join lateral (select sum(requested_qty) req, sum(approved_qty) appr from supply_request_lines where request_id = r.id) l on true
  where f.lga_id = p_lga_id and r.submitted_at::date between ws and we and r.status <> 'cancelled';

  select coalesce(jsonb_agg(jsonb_build_object('code', 'site_' || (x ->> 'status'), 'severity',
            case when x ->> 'status' in ('submitted', 'under_review', 'queried') then 'blocking' else 'warning' end,
            'facility', x ->> 'facility',
            'message', (x ->> 'facility') || ': ' || case x ->> 'status'
               when 'not_started' then 'no report' when 'draft' then 'report not submitted'
               when 'submitted' then 'waiting for your review' when 'under_review' then 'review not finished'
               when 'queried' then 'query not yet answered' when 'returned' then 'returned for correction, not resubmitted'
               when 'rejected' then 'report rejected' else x ->> 'status' end
               || case when (x ->> 'included')::boolean then ' (its last accepted version is included)' else '' end)), '[]'::jsonb)
  into v_issues
  from jsonb_array_elements(v_sites) x where x ->> 'status' <> 'approved';

  return jsonb_build_object(
    'header', jsonb_build_object('lga', v_lga.name, 'state', (select name from states where id = v_lga.state_id),
      'week_start', ws, 'week_end', we, 'otp_sites', jsonb_array_length(v_sites), 'sites_included', v_n,
      'lga_nutritionists', (select coalesce(jsonb_agg(name order by name), '[]') from profiles where id in (select rutf_lga_nutritionists(p_lga_id))),
      'generated_at', now()),
    'sections', coalesce(v_sum, '{}'::jsonb),
    'store', v_store_sec,
    'supply_requests', v_supply,
    'sites', v_sites,
    'issues', v_issues);
end;
$$;

-- The LGA Nutrition Officer opens (creates) the LGA report for a week.
create or replace function lga_report_open(p_week_start date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_store facilities; ws date := lower(otp_week_of(p_week_start))::date; v_id uuid;
begin
  select f.* into v_store from profiles p join facilities f on f.id = p.facility_id
  where p.id = auth.uid() and p.role = 'dri' and p.status = 'active' and f.facility_type = 'lga_store';
  if v_store.id is null then raise exception 'Only an LGA Nutrition Officer prepares the LGA weekly report'; end if;
  insert into lga_weekly_reports (project_id, state_id, lga_id, week_start, week_end)
  values (v_store.project_id, v_store.state_id, v_store.lga_id, ws, ws + 6)
  on conflict (lga_id, week_start) do nothing;
  select id into v_id from lga_weekly_reports where lga_id = v_store.lga_id and week_start = ws;
  return lga_report_get(v_id);
end;
$$;

create or replace function lga_report_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r lga_weekly_reports; v_role user_role := current_user_role(); v_lgan boolean; v_sn boolean; v_sc boolean; v_live jsonb; v_cur lga_weekly_report_versions; v_changed jsonb;
begin
  select * into r from lga_weekly_reports where id = p_id;
  if r.id is null then raise exception 'LGA report not found'; end if;
  if not ((v_role in ('super_admin', 'project_admin', 'state_coordinator', 'tpm_supervisor') or rutf_officer_level() in ('lga', 'state'))
          and rutf_can_see_lga(r.lga_id)) then
    raise exception 'You do not have access to this LGA report';
  end if;
  v_lgan := rutf_is_lga_nutritionist(r.lga_id);
  v_sn := rutf_is_state_nutritionist(r.state_id);
  v_sc := rutf_is_state_coordinator(r.state_id);
  v_live := lga_weekly_report_compute(r.lga_id, r.week_start);
  select * into v_cur from lga_weekly_report_versions where report_id = r.id and version = r.current_version;
  -- A source OTP report accepted again (a new version) after this LGA report was submitted.
  if v_cur.id is not null then
    select coalesce(jsonb_agg(x ->> 'facility'), '[]') into v_changed
    from jsonb_array_elements(v_live -> 'sites') x
    where (x ->> 'included_version') is distinct from
          (select y ->> 'included_version' from jsonb_array_elements(v_cur.sites) y where y ->> 'facility_id' = x ->> 'facility_id');
  end if;
  return jsonb_build_object('id', r.id, 'lga_id', r.lga_id, 'state_id', r.state_id, 'status', r.status, 'amendment', r.amendment,
    'week_start', r.week_start, 'week_end', r.week_end, 'draft_comments', r.draft_comments,
    'lga', (select name from lgas where id = r.lga_id),
    'live', v_live,
    'sources_changed', coalesce(v_changed, '[]'::jsonb),
    'can_edit', v_lgan and r.status in ('draft', 'returned'),
    'can_submit', v_lgan and r.status in ('draft', 'returned') and r.week_end < current_date,
    'can_answer', v_lgan and r.status = 'queried',
    'can_reopen', v_lgan and r.status in ('accepted', 'rejected'),
    'can_start_review', v_sn and r.status = 'submitted',
    'can_decide', v_sn and r.status in ('submitted', 'under_review'),
    'can_return', (v_sn or v_sc) and r.status in ('submitted', 'under_review'),
    'can_query', (v_sn or v_sc) and r.status in ('submitted', 'under_review'),
    'open_query', case when r.status = 'queried' then (select jsonb_build_object('note', e.note, 'by', p.name, 'role', e.actor_role, 'at', e.created_at)
        from report_events e left join profiles p on p.id = e.actor where e.kind = 'lga' and e.report_id = r.id and e.action = 'queried' order by e.created_at desc limit 1) end,
    'events', report_events_list('lga', r.id),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', version, 'data', data, 'sites', sites, 'comments', comments,
        'amendment', amendment, 'amendment_reason', amendment_reason, 'submitted_by', (select name from profiles where id = submitted_by), 'submitted_at', submitted_at,
        'decision', decision, 'decision_note', decision_note, 'decided_by', (select name from profiles where id = decided_by), 'decided_at', decided_at) order by version desc)
      from lga_weekly_report_versions where report_id = r.id), '[]'::jsonb));
end;
$$;

create or replace function lga_report_save_comments(p_id uuid, p_comments text)
returns void language plpgsql security definer set search_path = public as $$
declare r lga_weekly_reports;
begin
  select * into r from lga_weekly_reports where id = p_id for update;
  if r.id is null or not rutf_is_lga_nutritionist(r.lga_id) then raise exception 'LGA report not found'; end if;
  if r.status not in ('draft', 'returned') then raise exception 'This report is % and cannot be changed', r.status; end if;
  update lga_weekly_reports set draft_comments = nullif(trim(p_comments), ''), updated_at = now() where id = r.id;
end;
$$;

-- Submit: the week is over, no OTP report is waiting for the LGA Nutrition Officer (submitted, under
-- review or queried), and any site not included is explained in the comments.
create or replace function lga_report_submit(p_id uuid, p_comments text, p_confirm_reviewed boolean, p_amendment_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r lga_weekly_reports; v_calc jsonb; v_pending text; v_missing int; v_ver int; u uuid;
begin
  select * into r from lga_weekly_reports where id = p_id for update;
  if r.id is null or not rutf_is_lga_nutritionist(r.lga_id) then raise exception 'LGA report not found'; end if;
  if r.status not in ('draft', 'returned') then raise exception 'This report is % and cannot be submitted again', r.status; end if;
  if r.week_end >= current_date then raise exception 'The week is not over yet: submit from %', r.week_end + 1; end if;
  if coalesce(p_confirm_reviewed, false) is not true then raise exception 'Confirm that you have compared the combined figures with the OTP reports'; end if;
  if r.amendment and coalesce(trim(p_amendment_reason), '') = '' then raise exception 'Give the reason for amending the report'; end if;
  v_calc := lga_weekly_report_compute(r.lga_id, r.week_start);
  select string_agg(x ->> 'facility', ', ') into v_pending from jsonb_array_elements(v_calc -> 'sites') x
  where x ->> 'status' in ('submitted', 'under_review', 'queried');
  if v_pending is not null then raise exception 'Finish reviewing these OTP reports first: %', v_pending; end if;
  select count(*) into v_missing from jsonb_array_elements(v_calc -> 'sites') x where not (x ->> 'included')::boolean;
  if v_missing > 0 and coalesce(trim(p_comments), '') = '' then
    raise exception '% OTP site(s) have no accepted report: explain in the comments', v_missing;
  end if;
  v_ver := r.current_version + 1;
  insert into lga_weekly_report_versions (report_id, version, data, sites, comments, amendment, amendment_reason, submitted_by)
  values (r.id, v_ver, v_calc - 'sites', v_calc -> 'sites', nullif(trim(p_comments), ''), r.amendment, nullif(trim(p_amendment_reason), ''), auth.uid());
  update lga_weekly_reports set status = 'submitted', current_version = v_ver, draft_comments = nullif(trim(p_comments), ''), updated_at = now() where id = r.id;
  perform report_log('lga', r.id, v_ver, 'submitted', p_amendment_reason, r.status, 'submitted');
  for u in select x from (select rutf_state_nutritionists(r.state_id) x union select id from otp_state_coordinators(r.state_id)) y loop
    perform otp_notify(u, format('The %s LGA weekly report for the week of %s is waiting for review%s', (select name from lgas where id = r.lga_id),
      to_char(r.week_start, 'DD Mon'), case when r.amendment then ' (amendment)' when v_ver > 1 then ' (resubmitted)' else '' end), '/lga-reports/' || r.id);
  end loop;
  return jsonb_build_object('id', r.id, 'version', v_ver, 'status', 'submitted');
end;
$$;

-- start_review / accept / reject: the State Nutrition Officer. query / return: the State Nutrition Officer
-- or the State Coordinator. answer / reopen: the LGA Nutrition Officer.
create or replace function lga_report_act(p_id uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r lga_weekly_reports; v_after text; v_sn boolean; v_sc boolean; v_lgan boolean; u uuid; v_lga text; v_querier uuid;
begin
  select * into r from lga_weekly_reports where id = p_id for update;
  if r.id is null then raise exception 'LGA report not found'; end if;
  v_sn := rutf_is_state_nutritionist(r.state_id); v_sc := rutf_is_state_coordinator(r.state_id); v_lgan := rutf_is_lga_nutritionist(r.lga_id);
  select name into v_lga from lgas where id = r.lga_id;
  if p_action in ('start_review', 'accept', 'reject') and not v_sn then raise exception 'Only the State Nutrition Officer accepts or rejects the LGA report'; end if;
  if p_action in ('query', 'return') and not (v_sn or v_sc) then raise exception 'Only the State Nutrition Officer or the State Coordinator queries or returns the LGA report'; end if;
  if p_action in ('answer', 'reopen') and not v_lgan then raise exception 'Only the LGA Nutrition Officer answers or reopens the LGA report'; end if;
  if p_action in ('start_review', 'accept', 'reject', 'query', 'return') and r.status not in ('submitted', 'under_review') then
    raise exception 'This report is %, not waiting for review', r.status;
  end if;
  if p_action in ('query', 'return', 'reject', 'answer') and coalesce(trim(p_note), '') = '' then
    raise exception '%', case p_action when 'query' then 'Write the question' when 'answer' then 'Write the answer'
                                       when 'return' then 'Say what needs correcting' else 'Give the reason for rejecting the report' end;
  end if;
  if p_action = 'start_review' then
    if r.status = 'under_review' then return jsonb_build_object('status', r.status); end if;
    v_after := 'under_review';
  elsif p_action = 'accept' then
    if (select submitted_by from lga_weekly_report_versions where report_id = r.id and version = r.current_version) = auth.uid() then
      raise exception 'You cannot accept a report you submitted';
    end if;
    v_after := 'accepted';
  elsif p_action = 'reject' then v_after := 'rejected';
  elsif p_action = 'return' then v_after := 'returned';
  elsif p_action = 'query' then v_after := 'queried';
  elsif p_action = 'answer' then
    if r.status <> 'queried' then raise exception 'This report is not queried'; end if;
    v_after := 'submitted';
  elsif p_action = 'reopen' then
    if r.status not in ('accepted', 'rejected') then raise exception 'Only an accepted or rejected report is reopened for amendment'; end if;
    v_after := 'draft';
  else raise exception 'Unknown action %', p_action;
  end if;

  if p_action in ('accept', 'reject', 'return') then
    update lga_weekly_report_versions set decision = case p_action when 'accept' then 'accepted' when 'reject' then 'rejected' else 'returned' end,
      decision_note = nullif(trim(p_note), ''), decided_by = auth.uid(), decided_at = now()
    where report_id = r.id and version = r.current_version;
  end if;
  update lga_weekly_reports set status = v_after, amendment = case when p_action = 'reopen' then true when p_action = 'accept' then false else amendment end,
    updated_at = now() where id = r.id;
  perform report_log('lga', r.id, r.current_version,
    case p_action when 'start_review' then 'review_started' when 'accept' then 'accepted' when 'reject' then 'rejected' when 'return' then 'returned'
                  when 'query' then 'queried' when 'answer' then 'answered' else 'reopened' end, p_note, r.status, v_after);

  if p_action in ('accept', 'reject', 'return', 'query') then
    for u in select rutf_lga_nutritionists(r.lga_id) loop
      perform otp_notify(u, format('The %s LGA weekly report for the week of %s was %s%s', v_lga, to_char(r.week_start, 'DD Mon'),
        case p_action when 'accept' then 'accepted' when 'reject' then 'rejected' when 'return' then 'returned for correction' else 'queried' end,
        case when p_note is not null and trim(p_note) <> '' then ': ' || left(trim(p_note), 160) else '' end), '/lga-reports/' || r.id);
    end loop;
  elsif p_action = 'answer' then
    select actor into v_querier from report_events where kind = 'lga' and report_id = r.id and action = 'queried' order by created_at desc limit 1;
    for u in select x from (select rutf_state_nutritionists(r.state_id) x union select v_querier) y where x is not null loop
      perform otp_notify(u, format('The query on the %s LGA weekly report (week of %s) was answered', v_lga, to_char(r.week_start, 'DD Mon')), '/lga-reports/' || r.id);
    end loop;
  end if;
  return jsonb_build_object('id', r.id, 'status', v_after);
end;
$$;

-- The LGA reports for a week, and the statewide report combined from the accepted ones.
create or replace function lga_reports_overview(p_week_start date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_role user_role := current_user_role(); ws date := lower(otp_week_of(p_week_start))::date; v_rows jsonb; v_state jsonb; v_n int := 0; x record;
begin
  if not (v_role in ('state_coordinator', 'super_admin', 'project_admin', 'tpm_supervisor') or rutf_officer_level() in ('lga', 'state')) then
    raise exception 'Your role does not see the LGA weekly reports';
  end if;
  v_rows := '[]'::jsonb;
  for x in
    select l.id lga_id, l.name lga, r.id report_id, coalesce(r.status, 'not_started') status, r.current_version, r.amendment,
           v.submitted_at, v.decided_at, acc.data acc_data,
           (select count(*) from facilities f where f.lga_id = l.id and f.facility_type = 'health_facility' and f.is_otp_site and f.is_active and f.status = 'approved') sites,
           (select count(*) from facilities f join otp_weekly_reports o on o.facility_id = f.id and o.week_start = ws
             where f.lga_id = l.id and f.is_otp_site and o.status = 'approved') sites_accepted
    from lgas l
    left join lga_weekly_reports r on r.lga_id = l.id and r.week_start = ws
    left join lga_weekly_report_versions v on v.report_id = r.id and v.version = r.current_version
    left join lateral (select data from lga_weekly_report_versions a where a.report_id = r.id and a.decision = 'accepted' order by a.version desc limit 1) acc on true
    where rutf_can_see_lga(l.id)
      and exists (select 1 from facilities f where f.lga_id = l.id and f.facility_type = 'lga_store')
    order by l.name
  loop
    v_rows := v_rows || jsonb_build_object('lga_id', x.lga_id, 'lga', x.lga, 'report_id', x.report_id, 'status', x.status, 'version', x.current_version,
      'amendment', x.amendment, 'submitted_at', x.submitted_at, 'decided_at', x.decided_at, 'sites', x.sites, 'sites_accepted', x.sites_accepted,
      'new_cases', x.acc_data -> 'sections' -> 'C' -> 'SAM' ->> 'total', 'closing', x.acc_data -> 'sections' -> 'F' -> 'SAM' -> 'actual' ->> 'total');
    if x.acc_data is not null then
      v_state := jsonb_deep_sum(v_state, jsonb_build_object('sections', x.acc_data -> 'sections', 'store', x.acc_data -> 'store'));
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('week_start', ws, 'week_end', ws + 6, 'lgas', v_rows,
    'expected', jsonb_array_length(v_rows),
    'accepted', v_n,
    'pending_review', (select count(*) from jsonb_array_elements(v_rows) y where y ->> 'status' in ('submitted', 'under_review')),
    'queried', (select count(*) from jsonb_array_elements(v_rows) y where y ->> 'status' = 'queried'),
    'returned', (select count(*) from jsonb_array_elements(v_rows) y where y ->> 'status' = 'returned'),
    'not_submitted', (select count(*) from jsonb_array_elements(v_rows) y where y ->> 'status' in ('not_started', 'draft')),
    'statewide', case when v_role in ('state_coordinator', 'super_admin', 'project_admin') or rutf_officer_level() = 'state' then v_state end,
    'i_prepare', (select coalesce(jsonb_agg(y ->> 'lga_id'), '[]') from jsonb_array_elements(v_rows) y where rutf_is_lga_nutritionist((y ->> 'lga_id')::uuid)));
end;
$$;

-- ── Reminders: the LGA Nutrition Officer is told which OTP reports wait for review ────────────────
-- (the daily 06:30 job, after the OTP Officers' reminders)
create or replace function lga_review_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare v_count int := 0; r record;
begin
  for r in
    select u.id user_id, count(*) n
    from otp_weekly_reports o
    join facilities lf on lf.lga_id = o.lga_id and lf.facility_type = 'lga_store'
    join profiles u on u.facility_id = lf.id and u.role = 'dri' and u.status = 'active'
    where o.status in ('submitted', 'under_review') and o.updated_at < now() - interval '2 days'
    group by u.id
  loop
    if not exists (select 1 from notifications n where n.user_id = r.user_id and n.type = 'weekly_report_reminder' and n.created_at::date = current_date) then
      insert into notifications (user_id, type, text, link)
      values (r.user_id, 'weekly_report_reminder', format('%s weekly OTP report(s) have waited more than 2 days for your review', r.n), '/weekly-reports');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
select cron.schedule('rutf-lga-review-reminders', '35 6 * * *', 'select public.lga_review_reminders()');

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────
revoke execute on function report_log(text, uuid, int, text, text, text, text), report_events_list(text, uuid),
  rutf_lga_nutritionists(uuid), rutf_state_nutritionists(uuid), rutf_is_lga_nutritionist(uuid), rutf_is_state_nutritionist(uuid),
  rutf_is_state_coordinator(uuid), rutf_can_see_lga(uuid), otp_report_officers(uuid), otp_report_open_query(uuid),
  jsonb_deep_sum(jsonb, jsonb), lga_weekly_report_compute(uuid, date), lga_review_reminders() from public, anon, authenticated;
revoke execute on function otp_report_act(uuid, text, text), otp_report_get_query(uuid), lga_report_open(date), lga_report_get(uuid),
  lga_report_save_comments(uuid, text), lga_report_submit(uuid, text, boolean, text), lga_report_act(uuid, text, text),
  lga_reports_overview(date) from public, anon;
grant execute on function otp_report_act(uuid, text, text), otp_report_get_query(uuid), lga_report_open(date), lga_report_get(uuid),
  lga_report_save_comments(uuid, text), lga_report_submit(uuid, text, boolean, text), lga_report_act(uuid, text, text),
  lga_reports_overview(date) to authenticated;
