-- RUTF Monitoring Platform — migration 0105 (brief §7, §9, §12.8, milestone M5)
-- The single definitions behind the dashboards, the facility risk score and the Supervision
-- Planner, and the DHIS2 CSV import for triangulation. Every function is SECURITY INVOKER, so a
-- caller only ever aggregates the rows their RLS lets them see. Definitions: DECISIONS R38.
-- (Functions live in public, not a rutf_metrics schema — the API serves public only, R24.)

-- ── Headline KPIs for a period (brief §9) ──────────────────────────────────────────────────────
create or replace function rutf_kpis(p_start date, p_end date)
returns jsonb language sql stable security invoker set search_path = public as $$
  with
  fac as (                                  -- stores and OTP sites live by p_end
    select f.id, f.project_id,
           case when f.facility_type = 'state_store' then 'state_store' when f.facility_type = 'lga_store' then 'lga_store' else 'otp' end as lvl,
           (select min(t.txn_date) from stock_transactions t where t.facility_id = f.id and t.txn_type = 'receipt') as first_receipt
    from facilities f
    where f.status = 'approved' and f.is_active and (f.facility_type <> 'health_facility' or f.is_otp_site)
  ),
  active as (select * from fac where first_receipt <= p_end),
  bal as (
    select a.id, a.lvl,
           coalesce(sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)) filter (where t.txn_date <= p_end), 0) as balance,
           coalesce(sum(t.quantity_sachets) filter (where t.txn_type in ('issue', 'dispensed')
                    and t.txn_date between (date_trunc('month', p_start) - interval '2 months')::date and p_end), 0) as outflow_3m
    from active a left join stock_transactions t on t.facility_id = a.id and t.status <> 'voided'
    group by a.id, a.lvl
  ),
  levels as (
    select lvl, sum(balance)::bigint as soh, sum(outflow_3m)::numeric / 3 as monthly_out from bal group by lvl
  ),
  daily as (
    select t.facility_id, t.txn_date as d, sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)) as net
    from stock_transactions t join active a on a.id = t.facility_id
    where t.status <> 'voided' and t.txn_date <= p_end
    group by t.facility_id, t.txn_date
  ),
  days as (
    select a.id as facility_id, g::date as d
    from active a, generate_series(greatest(p_start, a.first_receipt), p_end, interval '1 day') g
  ),
  running as (
    select dy.facility_id, dy.d,
           (select coalesce(sum(net), 0) from daily x where x.facility_id = dy.facility_id and x.d < p_start)
             + sum(coalesce(dl.net, 0)) over (partition by dy.facility_id order by dy.d) as balance
    from days dy left join daily dl on dl.facility_id = dy.facility_id and dl.d = dy.d
  ),
  stockouts as (select count(distinct facility_id) as n from running where balance <= 0),
  counts as (
    select c.facility_id, c.txn_date, c.quantity_sachets as counted,
           (select coalesce(sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)), 0)
              from stock_transactions t
             where t.facility_id = c.facility_id and t.status <> 'voided' and t.txn_date <= c.txn_date
               and (c.lot_id is null or t.lot_id = c.lot_id)
               and not (t.txn_type = 'adjustment' and t.txn_date = c.txn_date
                        and t.submission_local_id is not distinct from c.submission_local_id
                        and (c.submission_local_id is not null or coalesce(t.reason, '') ilike '%count%'))) as ledger
    from stock_transactions c join active a on a.id = c.facility_id
    where c.txn_type = 'physical_count' and c.status <> 'voided' and c.txn_date between p_start and p_end
      and coalesce(c.reason, '') <> 'opening balance'
  ),
  disp as (
    select coalesce(sum(sachets_prescribed), 0) as p, coalesce(sum(sachets_dispensed), 0) as d
    from otp_daily_dispensing where dispense_date between p_start and p_end
  ),
  blocks as (select ((p_end - p_start + 1) / 7) as n),
  otp_blocks as (
    select count(distinct (o.facility_id, (o.dispense_date - p_start) / 7)) as seen
    from otp_daily_dispensing o join active a on a.id = o.facility_id and a.lvl = 'otp'
    where o.dispense_date >= p_start and o.dispense_date < p_start + 7 * (select n from blocks)
  ),
  due as (select coalesce((select max(value) from rutf_thresholds where key = 'count_due_day'), 5)::int as days),
  on_time as (
    select count(distinct c.facility_id) as n
    from stock_transactions c join active a on a.id = c.facility_id
    where c.txn_type = 'physical_count' and coalesce(c.reason, '') <> 'opening balance'
      and c.txn_date between p_end - 2 and p_end + (select days from due)
  ),
  vf as (
    select round(ov.sachets_dispensed_counted::numeric / ov.sachets_dispensed_recorded, 2) as vf
    from otp_verifications ov join monitoring_visits v on v.id = ov.visit_id
    where v.visit_date between p_start and p_end and ov.register_present
      and ov.sachets_dispensed_counted is not null and ov.sachets_dispensed_recorded > 0
  ),
  vf_limits as (
    select coalesce((select min(value) from rutf_thresholds where key = 'vf_min'), 0.90) as lo,
           coalesce((select max(value) from rutf_thresholds where key = 'vf_max'), 1.10) as hi
  ),
  quarter as (select date_trunc('quarter', p_end)::date as q),
  visited as (
    select count(distinct v.facility_id) as n
    from monitoring_visits v join active a on a.id = v.facility_id
    where v.visit_date between (select q from quarter) and p_end
  ),
  closed as (
    select percentile_cont(0.5) within group (order by extract(epoch from (resolution_date - reported_at)) / 86400) as days
    from issues where status = 'verified_closed' and resolution_date is not null
  )
  select jsonb_build_object(
    'period', jsonb_build_array(p_start, p_end),
    'stock_on_hand', (select jsonb_object_agg(lvl, soh) from levels),
    'months_of_stock', (select jsonb_object_agg(lvl, case when monthly_out > 0 then round(soh / monthly_out, 2) end) from levels),
    'active_facilities', (select count(*) from active),
    'stockout_rate_pct', (select round((select n from stockouts)::numeric * 100 / nullif(count(*), 0), 1) from active),
    'mean_stock_variance_pct', (select round(avg(abs(ledger - counted)::numeric / ledger * 100), 2) from counts where ledger > 0),
    'transfers_in_transit', (select count(*) from transfers where issued_date <= p_end and (received_date is null or received_date > p_end)),
    'transfers_with_discrepancy', (select count(*) from transfers where status = 'discrepancy' and received_date between p_start and p_end),
    'short_dispensing_pct', (select case when p > 0 then round((p - d)::numeric * 100 / p, 2) end from disp),
    'otp_vf_median', (select percentile_cont(0.5) within group (order by vf) from vf),
    'otp_vf_outside_pct', (select round(count(*) filter (where vf < (select lo from vf_limits) or vf > (select hi from vf_limits))::numeric * 100 / nullif(count(*), 0), 1) from vf),
    'dispensing_completeness_pct', (select round((select seen from otp_blocks)::numeric * 100
                                     / nullif((select count(*) from active where lvl = 'otp') * (select n from blocks), 0), 1)),
    'count_on_time_pct', (select round((select n from on_time)::numeric * 100 / nullif(count(*), 0), 1) from active),
    'losses', jsonb_build_object(
      'loss_damaged', (select coalesce(sum(quantity_sachets), 0) from stock_transactions where txn_type = 'loss_damaged' and status <> 'voided' and txn_date between p_start and p_end),
      'loss_expired', (select coalesce(sum(quantity_sachets), 0) from stock_transactions where txn_type = 'loss_expired' and status <> 'voided' and txn_date between p_start and p_end),
      'loss_other', (select coalesce(sum(quantity_sachets), 0) from stock_transactions where txn_type = 'loss_other' and status <> 'voided' and txn_date between p_start and p_end)),
    'expired_on_hand', (select coalesce(sum(b), 0) from (
        select sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)) as b
        from stock_transactions t join product_lots l on l.id = t.lot_id
        where t.status <> 'voided' and t.txn_date <= p_end and l.expiry_date < p_end
        group by t.facility_id, t.lot_id having sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)) > 0) x),
    'supervision_quarter', jsonb_build_object('visited', (select n from visited), 'to_visit', (select count(*) from active)),
    'open_critical_findings', (select count(*) from issues where priority = 'critical' and status <> 'verified_closed'),
    'open_findings', (select count(*) from issues where status <> 'verified_closed'),
    'median_days_to_close', (select round(days::numeric, 1) from closed)
  );
$$;

-- ── Per-facility metrics for a period (Stock Integrity, OTP Dispensing, Reporting, risk) ──────
create or replace function facility_metrics(p_start date, p_end date)
returns table (
  facility_id uuid, facility_name text, facility_type facility_type, is_otp_site boolean, lga_id uuid,
  balance int, monthly_outflow numeric, months_of_stock numeric, expired_balance int,
  stockout_days int, last_count_date date, last_variance_pct numeric,
  sachets_prescribed int, sachets_dispensed int, short_pct numeric, children_seen int, new_admissions int,
  dispensing_weeks int, expected_weeks int, count_on_time boolean,
  last_visit_date date, last_vf numeric, open_findings int, open_critical int
) language sql stable security invoker set search_path = public as $$
  with fac as (
    select f.*, (select min(t.txn_date) from stock_transactions t where t.facility_id = f.id and t.txn_type = 'receipt') as first_receipt
    from facilities f
    where f.status = 'approved' and f.is_active and (f.facility_type <> 'health_facility' or f.is_otp_site)
  ), active as (select * from fac where first_receipt <= p_end)
  select a.id, a.name, a.facility_type, a.is_otp_site, a.lga_id,
    b.balance, round(b.outflow_3m / 3.0, 1),
    case when b.outflow_3m > 0 then round(b.balance / (b.outflow_3m / 3.0), 2) end,
    coalesce(ex.expired, 0),
    so.days,
    lc.txn_date, lc.variance,
    coalesce(dp.p, 0), coalesce(dp.d, 0),
    case when dp.p > 0 then round((dp.p - dp.d)::numeric * 100 / dp.p, 1) end,
    coalesce(dp.seen, 0), coalesce(dp.adm, 0),
    case when a.is_otp_site then coalesce(dp.weeks, 0) end,
    case when a.is_otp_site then (p_end - p_start + 1) / 7 end,
    exists (select 1 from stock_transactions c where c.facility_id = a.id and c.txn_type = 'physical_count'
            and coalesce(c.reason, '') <> 'opening balance'
            and c.txn_date between p_end - 2 and p_end + coalesce((select max(value) from rutf_thresholds where key = 'count_due_day'), 5)::int),
    lv.visit_date, lv.vf,
    coalesce(fi.open, 0), coalesce(fi.crit, 0)
  from active a
  cross join lateral (
    select coalesce(sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)) filter (where t.txn_date <= p_end), 0)::int as balance,
           coalesce(sum(t.quantity_sachets) filter (where t.txn_type in ('issue', 'dispensed')
                    and t.txn_date between (date_trunc('month', p_start) - interval '2 months')::date and p_end), 0)::numeric as outflow_3m
    from stock_transactions t where t.facility_id = a.id and t.status <> 'voided'
  ) b
  left join lateral (
    select sum(x.b)::int as expired from (
      select sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)) as b
      from stock_transactions t join product_lots l on l.id = t.lot_id
      where t.facility_id = a.id and t.status <> 'voided' and t.txn_date <= p_end and l.expiry_date < p_end
      group by t.lot_id having sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)) > 0) x
  ) ex on true
  cross join lateral (
    select count(*)::int as days from (
      select g::date as d,
             (select coalesce(sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)), 0)
                from stock_transactions t where t.facility_id = a.id and t.status <> 'voided' and t.txn_date <= g::date) as bal
      from generate_series(greatest(p_start, a.first_receipt), p_end, interval '1 day') g) s
    where s.bal <= 0
  ) so
  left join lateral (
    select c.txn_date,
           round(abs(k.ledger - c.quantity_sachets)::numeric * 100 / nullif(k.ledger, 0), 1) as variance
    from stock_transactions c
    cross join lateral (
      select coalesce(sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)), 0) as ledger
      from stock_transactions t
      where t.facility_id = a.id and t.status <> 'voided' and t.txn_date <= c.txn_date
        and (c.lot_id is null or t.lot_id = c.lot_id)
        and not (t.txn_type = 'adjustment' and t.txn_date = c.txn_date
                 and t.submission_local_id is not distinct from c.submission_local_id
                 and (c.submission_local_id is not null or coalesce(t.reason, '') ilike '%count%'))) k
    where c.facility_id = a.id and c.txn_type = 'physical_count' and c.status <> 'voided' and c.txn_date <= p_end
      and coalesce(c.reason, '') <> 'opening balance'
    order by c.txn_date desc limit 1
  ) lc on true
  left join lateral (
    select sum(o.sachets_prescribed)::int as p, sum(o.sachets_dispensed)::int as d, sum(o.children_seen)::int as seen,
           sum(o.new_admissions)::int as adm,
           count(distinct (o.dispense_date - p_start) / 7) filter (where o.dispense_date < p_start + 7 * ((p_end - p_start + 1) / 7))::int as weeks
    from otp_daily_dispensing o where o.facility_id = a.id and o.dispense_date between p_start and p_end
  ) dp on true
  left join lateral (
    select v.visit_date,
           case when ov.register_present and ov.sachets_dispensed_recorded > 0 and ov.sachets_dispensed_counted is not null
                then round(ov.sachets_dispensed_counted::numeric / ov.sachets_dispensed_recorded, 2) end as vf
    from monitoring_visits v left join otp_verifications ov on ov.visit_id = v.id
    where v.facility_id = a.id and v.visit_date <= p_end order by v.visit_date desc limit 1
  ) lv on true
  left join lateral (
    select count(*)::int as open, count(*) filter (where priority = 'critical')::int as crit
    from issues i where i.facility_id = a.id and i.status <> 'verified_closed'
  ) fi on true;
$$;

-- ── Facility risk score 0–100 (brief §7) ───────────────────────────────────────────────────────
-- Weighted over the last 90 days (DECISIONS R39): last count variance 20, VF deviation 15,
-- transfer discrepancies 10, stockout days 15, short-dispensing 10, reporting gaps 10,
-- open critical Findings 10, days since the last supervision visit 10.
create or replace function facility_risk(p_as_of date default current_date)
returns table (facility_id uuid, facility_name text, facility_type facility_type, lga_id uuid,
               risk_score int, components jsonb, last_visit_date date)
language sql stable security invoker set search_path = public as $$
  with m as (select * from facility_metrics(p_as_of - 89, p_as_of)),
  gaps as (
    select tr.to_facility_id as facility_id, count(*) as n
    from transfers tr where tr.status = 'discrepancy' and tr.received_date between p_as_of - 89 and p_as_of
    group by tr.to_facility_id
  ),
  scored as (
    select m.*,
      least(coalesce(m.last_variance_pct, 0) / 10.0, 1) * 20 as c_variance,
      least(abs(coalesce(m.last_vf, 1) - 1) / 0.2, 1) * 15 as c_vf,
      least(coalesce(g.n, 0) / 3.0, 1) * 10 as c_transfers,
      least(m.stockout_days / 14.0, 1) * 15 as c_stockout,
      least(greatest(coalesce(m.short_pct, 0), 0) / 10.0, 1) * 10 as c_short,
      case when m.is_otp_site and m.expected_weeks > 0 then (1 - least(m.dispensing_weeks::numeric / m.expected_weeks, 1)) * 10 else 0 end as c_reporting,
      least(m.open_critical / 2.0, 1) * 10 as c_critical,
      least(coalesce(p_as_of - m.last_visit_date, 180) / 180.0, 1) * 10 as c_visit
    from m left join gaps g on g.facility_id = m.facility_id
  )
  select facility_id, facility_name, facility_type, lga_id,
    round(c_variance + c_vf + c_transfers + c_stockout + c_short + c_reporting + c_critical + c_visit)::int,
    jsonb_build_object('variance', round(c_variance, 1), 'vf', round(c_vf, 1), 'transfers', round(c_transfers, 1),
                       'stockout', round(c_stockout, 1), 'short_dispensing', round(c_short, 1), 'reporting', round(c_reporting, 1),
                       'critical_findings', round(c_critical, 1), 'since_visit', round(c_visit, 1),
                       'last_variance_pct', last_variance_pct, 'last_vf', last_vf, 'stockout_days', stockout_days),
    last_visit_date
  from scored;
$$;

-- ── Supervision Planner (brief §9, §12.9) ──────────────────────────────────────────────────────
-- For each supervisor, the facilities they cover, ranked: due when high-risk (score ≥ the
-- high-risk threshold) and not visited in 30 days, or not visited in 90 days (once a quarter);
-- the top `workload` due facilities are suggested for the coming month.
insert into rutf_thresholds (project_id, key, value, note)
select p.id, t.key, t.value, t.note from projects p cross join (values
  ('risk_high', 50, 'Facility risk score from which supervision is monthly'),
  ('visits_per_supervisor_month', 8, 'Supervision workload per supervisor per month (5–10)')
) as t(key, value, note)
where p.name = 'Katsina RUTF Pilot'
on conflict (project_id, key) do nothing;

create or replace function supervision_plan(p_as_of date default current_date)
returns table (supervisor_id uuid, supervisor_name text, facility_id uuid, facility_name text, facility_type facility_type,
               lga_id uuid, risk_score int, last_visit_date date, days_since_visit int, due boolean, reason text, suggested boolean,
               rank int)
language sql stable security invoker set search_path = public as $$
  with r as (select * from facility_risk(p_as_of)),
  lim as (
    select coalesce((select max(value) from rutf_thresholds where key = 'risk_high'), 50) as high,
           coalesce((select max(value) from rutf_thresholds where key = 'visits_per_supervisor_month'), 8)::int as workload
  ),
  cover as (
    select p.id as supervisor_id, p.name as supervisor_name, r.*
    from profiles p
    join r on (p.supervision_level = 'otp_sites' and r.facility_type = 'health_facility'
                 and exists (select 1 from supervisor_lgas s where s.profile_id = p.id and s.lga_id = r.lga_id))
           or (p.supervision_level = 'stores' and (r.facility_type = 'state_store'
                 or (r.facility_type = 'lga_store' and exists (select 1 from supervisor_lgas s where s.profile_id = p.id and s.lga_id = r.lga_id))))
    where p.role = 'tpm_supervisor' and p.status = 'active'
  ),
  flagged as (
    select c.*, (p_as_of - c.last_visit_date) as since,
      case
        when c.last_visit_date is null then 'Never visited'
        when c.risk_score >= (select high from lim) and p_as_of - c.last_visit_date > 30 then 'High risk — monthly visit due'
        when p_as_of - c.last_visit_date > 90 then 'Quarterly visit due'
      end as why
    from cover c
  ),
  ranked as (
    select f.*, row_number() over (partition by f.supervisor_id order by (f.why is not null) desc, f.risk_score desc, f.last_visit_date nulls first) as rn
    from flagged f
  )
  select supervisor_id, supervisor_name, facility_id, facility_name, facility_type, lga_id, risk_score, last_visit_date,
         since, why is not null, why, why is not null and rn <= (select workload from lim), rn::int
  from ranked;
$$;

-- ── DHIS2 monthly reports for triangulation (brief §12.8) ──────────────────────────────────────
create table dhis2_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  facility_id uuid not null references facilities(id),
  period date not null,                     -- first day of the reported month
  otp_admissions int,
  sachets_received int,
  sachets_distributed int,
  sachets_wasted int,
  stockout_days int,
  imported_by uuid references profiles(id) default auth.uid(),
  imported_at timestamptz not null default now(),
  unique (facility_id, period),
  check (period = date_trunc('month', period)::date)
);
alter table dhis2_reports enable row level security;
create policy dhis2_reports_select on dhis2_reports for select to authenticated using (in_scope(project_id));
create policy dhis2_reports_write on dhis2_reports for all to authenticated
  using (current_user_role() in ('super_admin', 'project_admin') and in_scope(project_id))
  with check (current_user_role() in ('super_admin', 'project_admin'));

-- DHIS2 against the ledger, per facility and month: received, distributed (dispensed + issued),
-- wasted (losses) and stockout days, with the differences.
create or replace function dhis2_triangulation(p_start date, p_end date)
returns table (facility_id uuid, facility_name text, lga_id uuid, period date,
               dhis2_received int, ledger_received int, dhis2_distributed int, ledger_distributed int,
               dhis2_wasted int, ledger_wasted int, dhis2_stockout_days int, ledger_stockout_days int,
               distributed_diff_pct numeric)
language sql stable security invoker set search_path = public as $$
  select r.facility_id, f.name, f.lga_id, r.period,
    r.sachets_received, l.received, r.sachets_distributed, l.distributed, r.sachets_wasted, l.wasted,
    r.stockout_days, so.days,
    case when l.distributed > 0 then round((r.sachets_distributed - l.distributed)::numeric * 100 / l.distributed, 1) end
  from dhis2_reports r
  join facilities f on f.id = r.facility_id
  cross join lateral (
    select coalesce(sum(t.quantity_sachets) filter (where t.txn_type = 'receipt'), 0)::int as received,
           coalesce(sum(t.quantity_sachets) filter (where t.txn_type in ('dispensed', 'issue')), 0)::int as distributed,
           coalesce(sum(t.quantity_sachets) filter (where t.txn_type::text like 'loss_%'), 0)::int as wasted
    from stock_transactions t
    where t.facility_id = r.facility_id and t.status <> 'voided'
      and t.txn_date between r.period and (r.period + interval '1 month - 1 day')::date
  ) l
  cross join lateral (
    select count(*)::int as days from generate_series(r.period, (r.period + interval '1 month - 1 day')::date, interval '1 day') g
    where (select coalesce(sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)), 0)
             from stock_transactions t where t.facility_id = r.facility_id and t.status <> 'voided' and t.txn_date <= g::date) <= 0
      and g::date >= (select min(txn_date) from stock_transactions t where t.facility_id = r.facility_id and t.txn_type = 'receipt')
  ) so
  where r.period between date_trunc('month', p_start)::date and p_end;
$$;

grant execute on function rutf_kpis, facility_metrics, facility_risk, supervision_plan, dhis2_triangulation to authenticated;
