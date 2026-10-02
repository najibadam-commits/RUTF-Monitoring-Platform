-- Time Efficiency Analysis: a stage-by-stage breakdown of the issue workflow, computed from the
-- real, already-written issue_history timestamps (no new instrumentation, no mock data). See the
-- Time Efficiency Analysis plan / DECISIONS.md for the full rationale.
--
-- Analytics only ever measures one span (issues.reported_at -> issues.resolution_date, "discovery
-- to closure"). This computes the four stage-to-stage intervals inside that span instead:
-- report -> assign -> first response -> corrective action -> verify/close.
create or replace function get_time_efficiency_stats()
returns json
language sql
stable
security invoker  -- RLS-respecting, same reasoning as get_dashboard_stats (0027) — this computes
                   -- over issues/issue_history the caller can already see, nothing more.
as $$
  with stage_times as (
    select
      i.id, i.priority, i.reported_at,
      -- FIRST occurrence of each action per issue. A reopened issue's second pass through
      -- corrective-action/verification isn't separately tracked here — this is an aggregate
      -- efficiency view, not a per-issue audit trail (that's the Issue Detail Activity History).
      min(h.occurred_at) filter (where h.action in ('Assigned to DRI','Self-assigned by DRI')) as assigned_at,
      min(h.occurred_at) filter (where h.action = 'Response submitted') as responded_at,
      min(h.occurred_at) filter (where h.action = 'Corrective action recorded') as corrective_at,
      min(h.occurred_at) filter (where h.action = 'Verified and closed') as verified_at
    from issues i
    left join issue_history h on h.issue_id = i.id
    group by i.id, i.priority, i.reported_at
  )
  select json_build_object(
    -- Each average filters out issues that haven't reached that stage yet (null, not 0) — a
    -- partially-progressed issue contributes to the stages it HAS reached, not ones it hasn't.
    'avg_report_to_assign_hours',
      (select round(avg(extract(epoch from (assigned_at - reported_at)) / 3600)::numeric, 1)
       from stage_times where assigned_at is not null),
    'avg_assign_to_response_hours',
      (select round(avg(extract(epoch from (responded_at - assigned_at)) / 3600)::numeric, 1)
       from stage_times where responded_at is not null and assigned_at is not null),
    'avg_response_to_corrective_hours',
      (select round(avg(extract(epoch from (corrective_at - responded_at)) / 3600)::numeric, 1)
       from stage_times where corrective_at is not null and responded_at is not null),
    'avg_corrective_to_verify_hours',
      (select round(avg(extract(epoch from (verified_at - corrective_at)) / 3600)::numeric, 1)
       from stage_times where verified_at is not null and corrective_at is not null),
    'by_priority', (
      select coalesce(json_agg(x), '[]'::json) from (
        select
          priority,
          count(*) filter (where verified_at is not null) as resolved_count,
          round((avg(extract(epoch from (verified_at - reported_at)) / 86400)
                 filter (where verified_at is not null))::numeric, 1) as avg_days
        from stage_times
        group by priority
        order by array_position(array['critical','high','medium','low'], priority::text)
      ) x
    )
  );
$$;

grant execute on function get_time_efficiency_stats() to authenticated;
