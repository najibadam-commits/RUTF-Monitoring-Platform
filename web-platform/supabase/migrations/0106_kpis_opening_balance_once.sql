-- RUTF Monitoring Platform — migration 0106 (performance fix to 0105)
-- rutf_kpis recomputed each facility's opening balance once per day of the period (a correlated
-- subquery per facility-day), taking ~11 s on the pilot data. The opening balance is now one
-- grouped pass. Same definitions and results (test-kpis.js).

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
  opening as (                              -- balance before the period, once per facility
    select facility_id, sum(net) as b from daily where d < p_start group by facility_id
  ),
  running as (
    select dy.facility_id, dy.d,
           coalesce(o.b, 0) + sum(coalesce(dl.net, 0)) over (partition by dy.facility_id order by dy.d) as balance
    from days dy
    left join daily dl on dl.facility_id = dy.facility_id and dl.d = dy.d
    left join opening o on o.facility_id = dy.facility_id
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
