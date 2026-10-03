-- RUTF Monitoring Platform — migration 0109 (brief §10: voided by an administrator, with a reason)
-- An administrator can void one ledger submission — a receipt, an issue, a day's dispensing, a
-- stock count or a loss/adjustment — with a reason. Nothing is deleted: every row the submission
-- wrote is marked voided (who, when, why) and drops out of balances, metrics and the Finding
-- rules; the audit trail (0108) records each change. Voiding a receipt puts its transfer back in
-- transit; voiding an issue cancels its transfer (only while it is still in transit); voiding a
-- day's dispensing frees that day to be recorded again. DECISIONS R49.

-- ── Columns ─────────────────────────────────────────────────────────────────────────────────────
alter table stock_transactions
  add column if not exists voided_by uuid references profiles(id),
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;

alter table ledger_submissions
  add column if not exists voided_by uuid references profiles(id),
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;

alter table transfers drop constraint if exists transfers_status_check;
alter table transfers add constraint transfers_status_check
  check (status in ('in_transit', 'received', 'discrepancy', 'cancelled'));

-- ── Daily dispensing: voided days kept, but out of every reader ────────────────────────────────
-- The rows move to otp_daily_dispensing_entries; otp_daily_dispensing becomes a view of the days
-- that aren't voided, so every function, page and the app keep reading the same name. The view is
-- auto-updatable, so record_dispensing still inserts through it. One live entry per day.
alter table otp_daily_dispensing rename to otp_daily_dispensing_entries;
alter table otp_daily_dispensing_entries
  add column if not exists voided_by uuid references profiles(id),
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;
alter table otp_daily_dispensing_entries drop constraint if exists otp_daily_dispensing_facility_id_dispense_date_key;
create unique index if not exists otp_daily_dispensing_one_live_day
  on otp_daily_dispensing_entries(facility_id, dispense_date) where voided_at is null;

create view otp_daily_dispensing with (security_invoker = true) as
select id, project_id, facility_id, dispense_date, new_admissions, children_seen, sachets_prescribed,
       sachets_dispensed, recorded_by, device_id, local_id, created_at
from otp_daily_dispensing_entries
where voided_at is null;
revoke all on otp_daily_dispensing from anon, authenticated;
grant select on otp_daily_dispensing to authenticated;
revoke all on otp_daily_dispensing_entries from anon;

drop trigger if exists otp_daily_dispensing_entries_audit on otp_daily_dispensing_entries;
create trigger otp_daily_dispensing_entries_audit after update or delete on otp_daily_dispensing_entries
  for each row execute function audit_row_change();

-- ── The void ────────────────────────────────────────────────────────────────────────────────────
-- p_local_id: the submission (shown on the Stock Ledger). Super Admin, or a Project Admin whose
-- project the facility belongs to. Re-voiding returns the earlier result marked duplicate.
create or replace function void_ledger_submission(p_local_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s ledger_submissions;
  f facilities;
  tr transfers;
  v_rows int;
  v_balance int;
  v_negative int;
  v_transfer_status text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if current_account_status() is distinct from 'active' then raise exception 'Your account is inactive'; end if;
  if current_user_role() not in ('super_admin', 'project_admin') then
    raise exception 'Only an administrator can void a ledger entry';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give the reason for voiding (at least 10 characters)';
  end if;

  select * into s from ledger_submissions where local_id = p_local_id for update;
  if not found then raise exception 'Ledger entry not found'; end if;
  select * into f from facilities where id = s.facility_id;
  if not in_scope(f.project_id) then raise exception 'That facility is outside your project'; end if;
  if s.voided_at is not null then
    return jsonb_build_object('local_id', s.local_id, 'kind', s.kind, 'voided_at', s.voided_at, 'duplicate', true);
  end if;

  if s.kind = 'issue' then
    select * into tr from transfers where local_id = p_local_id for update;
    if found then
      if tr.status <> 'in_transit' then
        raise exception 'Transfer % has already been received — void the receipt at the receiving facility first', tr.code;
      end if;
      update transfers set status = 'cancelled' where id = tr.id;
      v_transfer_status := 'cancelled';
    end if;
  elsif s.kind = 'receipt' then
    select t.* into tr from transfers t
    where t.id = (select transfer_id from stock_transactions where submission_local_id = p_local_id and transfer_id is not null limit 1)
    for update;
    if found then
      update transfers set status = 'in_transit', sachets_received = null, received_date = null, received_by = null
      where id = tr.id;
      v_transfer_status := 'in_transit';
    end if;
  elsif s.kind = 'dispensing' then
    update otp_daily_dispensing_entries set voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason)
    where local_id = p_local_id and voided_at is null;
  elsif s.kind not in ('stock_count', 'loss') then
    raise exception 'A % entry cannot be voided here', s.kind;
  end if;

  update stock_transactions set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason)
  where submission_local_id = p_local_id and status <> 'voided';
  get diagnostics v_rows = row_count;

  update ledger_submissions set voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason)
  where local_id = p_local_id;

  -- What the facility holds now, and lots that went below zero (e.g. a voided receipt whose stock
  -- was already issued) — shown to the administrator, who corrects with an adjustment if needed.
  v_balance := ledger_balance(s.facility_id, null, current_date);
  select count(*) into v_negative from stock_balances where facility_id = s.facility_id and balance < 0;

  return jsonb_build_object('local_id', p_local_id, 'kind', s.kind, 'facility_id', s.facility_id,
    'rows_voided', v_rows, 'transfer_id', tr.id, 'transfer_code', tr.code, 'transfer_status', v_transfer_status,
    'balance_after', v_balance, 'lots_below_zero', v_negative, 'duplicate', false);
end;
$$;
revoke execute on function void_ledger_submission(text, text) from public, anon;
grant execute on function void_ledger_submission(text, text) to authenticated;

-- ── Readers that didn't skip voided rows ────────────────────────────────────────────────────────
-- First-receipt dates and the month-end-count checks counted voided rows. The definitions below
-- are the live ones with "status <> 'voided'" added at exactly those places; nothing else changes.

CREATE OR REPLACE FUNCTION public.facility_metrics(p_start date, p_end date)
 RETURNS TABLE(facility_id uuid, facility_name text, facility_type facility_type, is_otp_site boolean, lga_id uuid, balance integer, monthly_outflow numeric, months_of_stock numeric, expired_balance integer, stockout_days integer, last_count_date date, last_variance_pct numeric, sachets_prescribed integer, sachets_dispensed integer, short_pct numeric, children_seen integer, new_admissions integer, dispensing_weeks integer, expected_weeks integer, count_on_time boolean, last_visit_date date, last_vf numeric, open_findings integer, open_critical integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with fac as (
    select f.*, (select min(t.txn_date) from stock_transactions t where t.facility_id = f.id and t.txn_type = 'receipt' and t.status <> 'voided') as first_receipt
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
    exists (select 1 from stock_transactions c where c.facility_id = a.id and c.txn_type = 'physical_count' and c.status <> 'voided'
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
$function$;


CREATE OR REPLACE FUNCTION public.rutf_kpis(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with
  fac as (                                  -- stores and OTP sites live by p_end
    select f.id, f.project_id,
           case when f.facility_type = 'state_store' then 'state_store' when f.facility_type = 'lga_store' then 'lga_store' else 'otp' end as lvl,
           (select min(t.txn_date) from stock_transactions t where t.facility_id = f.id and t.txn_type = 'receipt' and t.status <> 'voided') as first_receipt
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
    where c.txn_type = 'physical_count' and c.status <> 'voided' and coalesce(c.reason, '') <> 'opening balance'
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
$function$;


CREATE OR REPLACE FUNCTION public.dhis2_triangulation(p_start date, p_end date)
 RETURNS TABLE(facility_id uuid, facility_name text, lga_id uuid, period date, dhis2_received integer, ledger_received integer, dhis2_distributed integer, ledger_distributed integer, dhis2_wasted integer, ledger_wasted integer, dhis2_stockout_days integer, ledger_stockout_days integer, distributed_diff_pct numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
      and g::date >= (select min(txn_date) from stock_transactions t where t.facility_id = r.facility_id and t.txn_type = 'receipt' and t.status <> 'voided')
  ) so
  where r.period between date_trunc('month', p_start)::date and p_end;
$function$;


CREATE OR REPLACE FUNCTION public.evaluate_facility_period_internal(p_facility_id uuid, p_period_start date, p_period_end date, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not exists (select 1 from stock_transactions where facility_id = p_facility_id and txn_type = 'receipt' and status <> 'voided' and txn_date <= v_until) then
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
                                   where facility_id = p_facility_id and txn_type = 'receipt' and status <> 'voided')),
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
           and not exists (select 1 from stock_transactions where facility_id = p_facility_id and txn_type = 'physical_count' and status <> 'voided'
                            and txn_date between p_period_end - 2 and p_period_end + v_due_day::int)) then
      if raise_auto_finding('late_reporting', p_facility_id, 'late_reporting:' || p_facility_id || ':' || v_month,
           format('Reporting at %s in %s: %s. For review.', v_name, to_char(p_period_start, 'FMMonth YYYY'),
                  concat_ws('; ',
                    case when v_gap > v_gap_limit then format('%s days without a daily dispensing entry (limit %s)', v_gap, v_gap_limit) end,
                    case when p_as_of > p_period_end + v_due_day::int
                          and not exists (select 1 from stock_transactions where facility_id = p_facility_id and txn_type = 'physical_count' and status <> 'voided'
                                           and txn_date between p_period_end - 2 and p_period_end + v_due_day::int)
                         then format('no month-end count by day %s', v_due_day) end)),
           jsonb_build_object('longest_gap_days', v_gap, 'gap_limit_days', v_gap_limit,
                              'month_end_count', exists (select 1 from stock_transactions where facility_id = p_facility_id and txn_type = 'physical_count' and status <> 'voided'
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
$function$;

notify pgrst, 'reload schema';
