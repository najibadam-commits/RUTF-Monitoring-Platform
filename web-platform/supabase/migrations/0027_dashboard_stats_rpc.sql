-- Dashboard performance: replace "fetch every issue row, aggregate in JS" with one SQL
-- aggregate RPC, plus two indexes justified by real, currently-unindexed query patterns.
-- See the performance-investigation plan for the full root-cause trace.

-- ─── 1. get_dashboard_stats() ────────────────────────────────────────────────────────────────
--
-- Computes everything the Dashboard's KPI cards / donut / 14-day trend / state breakdown need
-- in one round trip, instead of pulling the entire `issues` table to the server and looping
-- over it in JavaScript. `security invoker` (the default — stated explicitly) means this runs
-- with the calling user's own privileges, so RLS on `issues`/`states` filters the aggregate
-- exactly as it filters today's row-by-row select — unlike the security-definer helper
-- functions in 0007 (current_user_role()/in_scope()), which exist to be called *inside* a
-- policy and must bypass RLS to avoid recursion. This function IS a query a policy applies to.
create or replace function get_dashboard_stats()
returns json
language sql
stable
security invoker
as $$
  select json_build_object(
    'total', (select count(*) from issues),
    'by_status', (
      select coalesce(json_object_agg(status, cnt), '{}'::json)
      from (select status, count(*) cnt from issues group by status) s
    ),
    -- Matches the current JS exactly: Math.round() per-row day-diff (not average-then-round),
    -- Math.max(0, ...) floor, then averaged and rounded to 1 decimal.
    'avg_resolution_days', (
      select round(avg(greatest(0, round(extract(epoch from (resolution_date - reported_at)) / 86400))), 1)
      from issues
      where resolution_date is not null
    ),
    -- Buckets by UTC calendar date, matching the current code's actual behavior (it buckets via
    -- reported_at's ISO string prefix, i.e. UTC; Vercel serverless functions run in UTC, so the
    -- day-of-month label the page renders already coincides with this in production).
    'trend_14d', (
      select json_agg(json_build_object('day', d::date, 'count', coalesce(c.cnt, 0)) order by d)
      from generate_series((current_date - interval '13 days')::date, current_date::date, interval '1 day') d
      left join (
        select (reported_at at time zone 'utc')::date rd, count(*) cnt
        from issues
        where reported_at >= (current_date - interval '13 days')
        group by rd
      ) c on c.rd = d::date
    ),
    'by_state', (
      select coalesce(json_agg(x), '[]'::json) from (
        select st.name, count(i.id) cnt
        from issues i
        join states st on st.id = i.state_id
        group by st.name
        order by cnt desc
        limit 6
      ) x
    )
  );
$$;

grant execute on function get_dashboard_stats() to authenticated;

-- ─── 2. issue_history: standalone occurred_at index ─────────────────────────────────────────
--
-- The existing issue_history_issue_id_idx is (issue_id, occurred_at) — useless for the
-- Dashboard's Activity Timeline query, which orders by occurred_at desc with NO issue_id
-- filter. Needs its own leading-column index.
create index if not exists issue_history_occurred_at_idx on issue_history (occurred_at desc);

-- ─── 3. Issues search: trigram indexes for ilike ────────────────────────────────────────────
--
-- issues/page.tsx's search filters via `description.ilike.%x%,code.ilike.%x%` — both
-- leading-wildcard, which a plain btree index can never use (forces a sequential scan,
-- linearly worse as the table grows). pg_trgm + GIN is the standard fix for this exact,
-- real query pattern.
create extension if not exists pg_trgm;

create index if not exists issues_description_trgm_idx on issues using gin (description gin_trgm_ops);
create index if not exists issues_code_trgm_idx on issues using gin (code gin_trgm_ops);
