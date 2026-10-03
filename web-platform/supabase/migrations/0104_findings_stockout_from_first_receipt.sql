-- RUTF Monitoring Platform — migration 0104 (fix to 0102)
-- The stockout rule counted every day of the month before a facility's first delivery as a
-- stockout, so a newly onboarded store or OTP got a stockout Finding for the days before it
-- entered the ledger. Days are now counted from the facility's first receipt (DECISIONS R35).
-- Only the stockout block of evaluate_facility_period_internal changes.

create or replace function evaluate_facility_period_internal(
  p_facility_id uuid, p_period_start date, p_period_end date, p_as_of date default current_date
) returns int language plpgsql security definer set search_path = public as $$
declare
  f facilities;
  v_name text;
  v_month text := to_char(p_period_start, 'YYYY-MM');
  v_until date := least(p_period_end, p_as_of);
  v_raised int := 0;
  v_limit numeric;
  r record;
  v_days int;
  v_first date;
  v_gap int;
  v_gap_limit numeric;
  v_due_day numeric;
begin
  select * into f from facilities where id = p_facility_id;
  if not found or not f.is_active or f.status <> 'approved' then return 0; end if;
  -- Only stores and OTP sites hold RUTF; a facility with no stock ever recorded isn't live yet.
  if f.facility_type = 'health_facility' and not f.is_otp_site then return 0; end if;
  if not exists (select 1 from stock_transactions where facility_id = p_facility_id and txn_type = 'receipt' and txn_date <= v_until) then
    return 0;
  end if;
  v_name := f.name;

  -- stock_variance: each count event in the period, against the ledger just before it (that
  -- count's own adjustments excluded). One Finding per count event, all its lots together.
  v_limit := rutf_threshold(f.project_id, case when f.is_hard_to_reach then 'variance_pct_max_remote' else 'variance_pct_max' end,
                            case when f.is_hard_to_reach then 10 else 5 end);
  for r in
    with counts as (
      select c.txn_date, coalesce(c.submission_local_id, 'day') as event, c.lot_id, c.quantity_sachets as counted,
             c.submission_local_id
      from stock_transactions c
      where c.facility_id = p_facility_id and c.txn_type = 'physical_count' and c.status <> 'voided'
        and c.txn_date between p_period_start and v_until
        and coalesce(c.reason, '') <> 'opening balance'
    ), lines as (
      select k.txn_date, k.event, k.lot_id, k.counted,
             (select coalesce(sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)), 0)
                from stock_transactions t
               where t.facility_id = p_facility_id and t.status <> 'voided' and t.txn_date <= k.txn_date
                 and (k.lot_id is null or t.lot_id = k.lot_id)
                 and not (t.txn_type = 'adjustment' and t.txn_date = k.txn_date
                          and (t.submission_local_id is not distinct from k.submission_local_id
                               and (k.submission_local_id is not null or coalesce(t.reason, '') ilike '%count%')))
             )::int as ledger
      from counts k
    )
    select txn_date, event, sum(counted)::int as counted, sum(ledger)::int as ledger,
           jsonb_agg(jsonb_build_object('lot_id', lot_id, 'counted', counted, 'ledger', ledger)) as lots
    from lines group by txn_date, event
  loop
    if r.ledger > 0 and abs(r.ledger - r.counted)::numeric / r.ledger * 100 > v_limit then
      if raise_auto_finding('stock_variance', p_facility_id, 'stock_variance:' || p_facility_id || ':' || r.txn_date || ':' || r.event,
           format('Stock count at %s on %s differs from the ledger by %s%% (counted %s, ledger %s sachets; limit %s%%). For review.',
                  v_name, r.txn_date, round(abs(r.ledger - r.counted)::numeric / r.ledger * 100, 1),
                  to_char(r.counted, 'FM999,999,999'), to_char(r.ledger, 'FM999,999,999'), v_limit),
           jsonb_build_object('variance_pct', round(abs(r.ledger - r.counted)::numeric / r.ledger * 100, 1), 'threshold', v_limit,
                              'counted', r.counted, 'ledger_balance', r.ledger, 'count_date', r.txn_date, 'lots', r.lots),
           p_period_start, p_period_end) is not null then
        v_raised := v_raised + 1;
      end if;
    end if;
  end loop;

  -- transfer_mismatch: transfers into this facility received short or over in the period.
  for r in
    select tr.*, s.name as sender from transfers tr join facilities s on s.id = tr.from_facility_id
    where tr.to_facility_id = p_facility_id and tr.status = 'discrepancy'
      and tr.received_date between p_period_start and v_until
  loop
    if raise_auto_finding('transfer_mismatch', p_facility_id, 'transfer_mismatch:' || r.id,
         format('Transfer %s from %s: %s sachets issued, %s received (difference %s). For review.',
                coalesce(r.code, 'transfer'), r.sender, to_char(r.sachets_issued, 'FM999,999,999'),
                to_char(r.sachets_received, 'FM999,999,999'), r.sachets_received - r.sachets_issued),
         jsonb_build_object('sachets_issued', r.sachets_issued, 'sachets_received', r.sachets_received,
                            'gap', r.sachets_issued - r.sachets_received, 'transfer_code', r.code),
         p_period_start, p_period_end, r.id) is not null then
      v_raised := v_raised + 1;
    end if;
  end loop;

  -- receipt_not_confirmed: transfers to this facility still in transit past the window.
  v_limit := rutf_threshold(f.project_id, 'receipt_confirm_days', 7);
  for r in
    select tr.*, s.name as sender from transfers tr join facilities s on s.id = tr.from_facility_id
    where tr.to_facility_id = p_facility_id and tr.status = 'in_transit'
      and tr.issued_date <= p_period_end and p_as_of - tr.issued_date > v_limit
  loop
    if raise_auto_finding('receipt_not_confirmed', p_facility_id, 'receipt_not_confirmed:' || r.id,
         format('Transfer %s from %s (%s sachets, issued %s) has not been confirmed as received after %s days. For review.',
                coalesce(r.code, 'transfer'), r.sender, to_char(r.sachets_issued, 'FM999,999,999'), r.issued_date,
                p_as_of - r.issued_date),
         jsonb_build_object('days_in_transit', p_as_of - r.issued_date, 'threshold_days', v_limit,
                            'sachets_issued', r.sachets_issued, 'transfer_code', r.code),
         p_period_start, p_period_end, r.id) is not null then
      v_raised := v_raised + 1;
    end if;
  end loop;

  -- stockout: days in the period ending with a balance of zero or less.
  with daily as (
    select txn_date as d, sum(ledger_signed_quantity(txn_type, quantity_sachets)) as net
    from stock_transactions where facility_id = p_facility_id and status <> 'voided' and txn_date <= v_until
    group by txn_date
  ), series as (
    -- From the facility's first receipt: days before it entered the ledger aren't a stockout.
    select g::date as d
    from generate_series(greatest(p_period_start,
                                  (select min(txn_date) from stock_transactions
                                   where facility_id = p_facility_id and txn_type = 'receipt')),
                         v_until, interval '1 day') g
  ), running as (
    select s.d,
           (select coalesce(sum(net), 0) from daily where d < p_period_start)
             + sum(coalesce(dl.net, 0)) over (order by s.d) as balance
    from series s left join daily dl on dl.d = s.d
  )
  select count(*) filter (where balance <= 0), min(d) filter (where balance <= 0) into v_days, v_first from running;
  if v_days > 0 then
    if raise_auto_finding('stockout', p_facility_id, 'stockout:' || p_facility_id || ':' || v_month,
         format('%s had no RUTF in stock on %s day(s) in %s (first on %s). For review.', v_name, v_days, to_char(p_period_start, 'FMMonth YYYY'), v_first),
         jsonb_build_object('stockout_days', v_days, 'first_day', v_first), p_period_start, p_period_end) is not null then
      v_raised := v_raised + 1;
    end if;
  end if;

  -- expired_stock: expired lots still with a balance at the end of the period.
  for r in
    select t.lot_id, l.lot_no, l.expiry_date, sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets))::int as balance
    from stock_transactions t join product_lots l on l.id = t.lot_id
    where t.facility_id = p_facility_id and t.status <> 'voided' and t.txn_date <= v_until and l.expiry_date < v_until
    group by t.lot_id, l.lot_no, l.expiry_date
    having sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets)) > 0
  loop
    if raise_auto_finding('expired_stock', p_facility_id, 'expired_stock:' || p_facility_id || ':' || r.lot_id,
         format('%s still holds %s sachets of lot %s, which expired on %s. For review.', v_name,
                to_char(r.balance, 'FM999,999,999'), r.lot_no, r.expiry_date),
         jsonb_build_object('lot_id', r.lot_id, 'lot_no', r.lot_no, 'expiry_date', r.expiry_date, 'balance', r.balance),
         p_period_start, p_period_end) is not null then
      v_raised := v_raised + 1;
    end if;
  end loop;

  if f.is_otp_site then
    -- short_dispensing: Σ prescribed − Σ dispensed over the month above the limit.
    v_limit := rutf_threshold(f.project_id, 'short_dispense_pct', 5);
    select sum(sachets_prescribed)::int as p, sum(sachets_dispensed)::int as d into r
    from otp_daily_dispensing where facility_id = p_facility_id and dispense_date between p_period_start and v_until;
    if coalesce(r.p, 0) > 0 and (r.p - r.d)::numeric / r.p * 100 > v_limit then
      if raise_auto_finding('short_dispensing', p_facility_id, 'short_dispensing:' || p_facility_id || ':' || v_month,
           format('In %s, %s dispensed %s of %s sachets prescribed — %s%% short (limit %s%%). For review.',
                  to_char(p_period_start, 'FMMonth YYYY'), v_name, to_char(r.d, 'FM999,999,999'), to_char(r.p, 'FM999,999,999'),
                  round((r.p - r.d)::numeric / r.p * 100, 1), v_limit),
           jsonb_build_object('short_pct', round((r.p - r.d)::numeric / r.p * 100, 1), 'threshold', v_limit,
                              'sachets_prescribed', r.p, 'sachets_dispensed', r.d),
           p_period_start, p_period_end) is not null then
        v_raised := v_raised + 1;
      end if;
    end if;

    -- late_reporting: longest gap without a dispensing entry, and the month-end count.
    v_gap_limit := rutf_threshold(f.project_id, 'reporting_gap_days', 7);
    v_due_day := rutf_threshold(f.project_id, 'count_due_day', 5);
    with days as (
      select dispense_date as d from otp_daily_dispensing
      where facility_id = p_facility_id and dispense_date between p_period_start and v_until
      union
      select max(dispense_date) from otp_daily_dispensing where facility_id = p_facility_id and dispense_date < p_period_start
    ), ordered as (
      select d, lag(d) over (order by d) as prev from days where d is not null
    )
    -- Gaps between consecutive entries (the previous month's last entry included), and the time
    -- since the last entry up to the end of the period. An OTP with no entry before the period
    -- simply started then — its lead-in isn't counted as a gap.
    select greatest(
             coalesce((select max(d - prev) from ordered where prev is not null and d >= p_period_start), 0),
             coalesce(v_until - (select max(d) from days), v_until - p_period_start + 1)
           ) into v_gap;
    if v_gap > v_gap_limit
       or (p_as_of > p_period_end + v_due_day::int
           and not exists (select 1 from stock_transactions where facility_id = p_facility_id and txn_type = 'physical_count'
                            and txn_date between p_period_end - 2 and p_period_end + v_due_day::int)) then
      if raise_auto_finding('late_reporting', p_facility_id, 'late_reporting:' || p_facility_id || ':' || v_month,
           format('Reporting at %s in %s: %s. For review.', v_name, to_char(p_period_start, 'FMMonth YYYY'),
                  concat_ws('; ',
                    case when v_gap > v_gap_limit then format('%s days without a daily dispensing entry (limit %s)', v_gap, v_gap_limit) end,
                    case when p_as_of > p_period_end + v_due_day::int
                          and not exists (select 1 from stock_transactions where facility_id = p_facility_id and txn_type = 'physical_count'
                                           and txn_date between p_period_end - 2 and p_period_end + v_due_day::int)
                         then format('no month-end count by day %s', v_due_day) end)),
           jsonb_build_object('longest_gap_days', v_gap, 'gap_limit_days', v_gap_limit,
                              'month_end_count', exists (select 1 from stock_transactions where facility_id = p_facility_id and txn_type = 'physical_count'
                                                          and txn_date between p_period_end - 2 and p_period_end + v_due_day::int)),
           p_period_start, p_period_end) is not null then
        v_raised := v_raised + 1;
      end if;
    end if;
  end if;

  -- unexplained_adjustment: manual adjustments (not from a count) above the limit, unconfirmed.
  v_limit := rutf_threshold(f.project_id, 'adjustment_pct_max', 2);
  for r in
    select a.id, a.txn_date, a.quantity_sachets, a.reason,
           ledger_balance(p_facility_id, null, a.txn_date) - a.quantity_sachets as before
    from stock_transactions a
    where a.facility_id = p_facility_id and a.txn_type = 'adjustment' and a.status = 'recorded'
      and a.txn_date between p_period_start and v_until
      and coalesce(a.reason, '') not ilike '%count%'
  loop
    if r.before > 0 and abs(r.quantity_sachets)::numeric / r.before * 100 > v_limit then
      if raise_auto_finding('unexplained_adjustment', p_facility_id, 'unexplained_adjustment:' || r.id,
           format('Adjustment of %s sachets at %s on %s (%s%% of the balance, limit %s%%) awaits supervisor confirmation. Reason given: %s. For review.',
                  r.quantity_sachets, v_name, r.txn_date, round(abs(r.quantity_sachets)::numeric / r.before * 100, 1), v_limit, r.reason),
           jsonb_build_object('adjustment', r.quantity_sachets, 'balance_before', r.before,
                              'pct', round(abs(r.quantity_sachets)::numeric / r.before * 100, 1), 'threshold', v_limit),
           p_period_start, p_period_end) is not null then
        v_raised := v_raised + 1;
      end if;
    end if;
  end loop;

  return v_raised;
end;
$$;
