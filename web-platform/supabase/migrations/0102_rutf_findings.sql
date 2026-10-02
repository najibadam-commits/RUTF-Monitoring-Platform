-- RUTF Monitoring Platform — migration 0102 (brief §5 "0103_rutf_findings" + §6, milestone M3)
-- Auto-Findings from the stock ledger. Each rule (brief §6) raises an ordinary Finding in the
-- existing workflow — status pending_review, so it goes to the State Coordinator's review queue
-- before any DRI sees it — tagged auto_generated with the measured metric.
--
-- Numbered 0102 (the brief names it 0103): migrations are applied in build order, and the
-- supervision migration (M4) comes after this one — DECISIONS R29. The visit-based rules
-- (supervisor count variance, OTP VF, checklists, geofence) arrive with M4's evaluate_visit().
--
-- Idempotent: every rule has a dedupe key, unique on issues, so re-running an evaluation never
-- raises the same Finding twice. Wording is neutral — Findings are for review, not accusation
-- (brief §10).

-- ── Finding types ──────────────────────────────────────────────────────────────────────────────
create table finding_types (
  key text primary key,
  label text not null,
  default_priority issue_priority not null,
  source text not null check (source in ('ledger', 'visit')),
  description text not null
);
alter table finding_types enable row level security;
create policy finding_types_select on finding_types for select to authenticated using (true);
create policy finding_types_write on finding_types for all to authenticated using (is_super_admin()) with check (is_super_admin());

insert into finding_types (key, label, default_priority, source, description) values
  ('stock_variance', 'Stock variance', 'high', 'ledger', 'A physical count differs from the ledger balance by more than the variance limit.'),
  ('transfer_mismatch', 'Transfer mismatch', 'high', 'ledger', 'Sachets received differ from sachets issued for a transfer.'),
  ('receipt_not_confirmed', 'Receipt not confirmed', 'medium', 'ledger', 'A transfer has been in transit longer than the confirmation window.'),
  ('stockout', 'Stockout', 'critical', 'ledger', 'The ledger balance reached zero on at least one day.'),
  ('expired_stock', 'Expired stock held', 'high', 'ledger', 'An expired lot still has a balance at the facility.'),
  ('short_dispensing', 'Short dispensing', 'high', 'ledger', 'Sachets dispensed fell short of sachets prescribed by more than the limit over the month.'),
  ('late_reporting', 'Late reporting', 'medium', 'ledger', 'No daily dispensing for longer than the reporting gap, or no month-end count by the due day.'),
  ('unexplained_adjustment', 'Unexplained adjustment', 'medium', 'ledger', 'A manual adjustment above the limit has not been confirmed by a supervisor.'),
  ('dispensing_gap', 'Dispensing gap (OTP VF)', 'high', 'visit', 'The supervisor''s register count differs from app-recorded dispensing outside the VF range.'),
  ('no_stock_card', 'No stock card', 'medium', 'visit', 'No up-to-date stock card at a supervision visit.'),
  ('poor_storage', 'Poor storage', 'medium', 'visit', 'Storage conditions failed the checklist at a supervision visit.'),
  ('register_missing', 'Register missing', 'high', 'visit', 'The OTP register was not available at a supervision visit.')
on conflict (key) do nothing;

-- ── Findings carry their source and measurement ────────────────────────────────────────────────
alter table issues add column if not exists finding_type text references finding_types(key);
alter table issues add column if not exists facility_id uuid references facilities(id);
alter table issues add column if not exists transfer_id uuid references transfers(id);
alter table issues add column if not exists auto_generated boolean not null default false;
alter table issues add column if not exists metric jsonb;         -- e.g. {"variance_pct": 7.4, "threshold": 5}
alter table issues add column if not exists period_start date;
alter table issues add column if not exists period_end date;
alter table issues add column if not exists dedupe_key text unique; -- one Finding per rule occurrence
create index if not exists issues_facility_id_idx on issues(facility_id);
create index if not exists issues_finding_type_idx on issues(finding_type);

comment on column issues.dedupe_key is
  'Rule occurrence key for auto-generated Findings (e.g. stock_variance:<facility>:<count date>) — '
  'unique, so re-running an evaluation never duplicates a Finding.';

-- History line for an auto-generated Finding says where it came from.
create or replace function log_issue_reported()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.auto_generated then
    insert into issue_history (issue_id, actor_id, actor_label, action, note)
    values (new.id, null, 'RUTF Monitoring (automatic check)', 'Finding reported',
            'Raised automatically from the stock ledger for review — ' || coalesce((select label from finding_types where key = new.finding_type), new.finding_type) || '.');
  else
    insert into issue_history (issue_id, actor_id, actor_label, action, note)
    values (new.id, new.reported_by, coalesce((select name from profiles where id = new.reported_by), 'TPM Field Monitor'),
            'Finding reported', 'Field visit finding logged with photo evidence and GPS capture.');
  end if;
  return new;
end;
$$;

-- ── Thresholds the rules use (brief §6 defaults, [VALIDATE] with the programme) ────────────────
insert into rutf_thresholds (project_id, key, value, note)
select p.id, t.key, t.value, t.note
from projects p
cross join (values
  ('receipt_confirm_days', 7, 'Days a transfer may stay in transit before "receipt not confirmed"'),
  ('reporting_gap_days', 7, 'Longest allowed gap between OTP daily dispensing entries (days)'),
  ('adjustment_pct_max', 2, 'Manual adjustment above this % of balance needs supervisor confirmation'),
  ('count_due_day', 5, 'Month-end count is due by this day of the next month')
) as t(key, value, note)
where p.name = 'Katsina RUTF Pilot'
on conflict (project_id, key) do nothing;

create or replace function rutf_threshold(p_project_id uuid, p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select value from rutf_thresholds where project_id = p_project_id and key = p_key), p_default);
$$;

-- ── Raising a Finding ──────────────────────────────────────────────────────────────────────────
-- Located at the facility, filed under its level (SST / LST / OTP) so the existing DRI scoping
-- and Finding ID (LGA3-WARD3-LVL-YY-…) apply unchanged. Returns null when already raised.
create or replace function raise_auto_finding(
  p_type text, p_facility_id uuid, p_dedupe_key text, p_description text, p_metric jsonb,
  p_period_start date default null, p_period_end date default null, p_transfer_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into issues (project_id, category_id, description, state_id, lga_id, ward_id, ward, lat, lng,
                      priority, status, finding_type, facility_id, transfer_id, auto_generated, metric,
                      period_start, period_end, dedupe_key)
  select f.project_id, c.id, p_description, f.state_id, f.lga_id, f.ward_id, w.name, f.lat, f.lng,
         ft.default_priority, 'pending_review', p_type, f.id, p_transfer_id, true, p_metric,
         p_period_start, p_period_end, p_dedupe_key
  from facilities f
  join finding_types ft on ft.key = p_type
  join categories c on c.abbr = case f.facility_type when 'state_store' then 'SST' when 'lga_store' then 'LST' else 'OTP' end
  left join wards w on w.id = f.ward_id
  where f.id = p_facility_id
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- ── The rules for one facility and period ──────────────────────────────────────────────────────
-- p_as_of caps "today" (tests and back-evaluation); rules that look forward from the period
-- (late month-end count, receipts still in transit) use it. Returns the number newly raised.
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
    select g::date as d from generate_series(p_period_start, v_until, interval '1 day') g
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

-- Callable by admins (and the nightly job / direct connections, where auth.uid() is null).
create or replace function evaluate_facility_period(p_facility_id uuid, p_period_start date, p_period_end date)
returns int language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and current_user_role() not in ('super_admin', 'project_admin') then
    raise exception 'Only an administrator can run Finding checks';
  end if;
  return evaluate_facility_period_internal(p_facility_id, p_period_start, p_period_end, current_date);
end;
$$;

-- Every store and OTP site for one period.
create or replace function evaluate_all_facilities(p_period_start date, p_period_end date, p_as_of date default current_date)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_total int := 0;
  r record;
begin
  if auth.uid() is not null and current_user_role() not in ('super_admin', 'project_admin') then
    raise exception 'Only an administrator can run Finding checks';
  end if;
  for r in select id from facilities where status = 'approved' and is_active and (facility_type <> 'health_facility' or is_otp_site) loop
    v_total := v_total + evaluate_facility_period_internal(r.id, p_period_start, p_period_end, p_as_of);
  end loop;
  return v_total;
end;
$$;

-- Nightly: the current month so far, and the previous month while its count is still due.
create or replace function evaluate_recent()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_start date := date_trunc('month', current_date)::date;
  v_total int;
begin
  v_total := evaluate_all_facilities(v_start, (v_start + interval '1 month - 1 day')::date);
  if extract(day from current_date) <= 10 then
    v_total := v_total + evaluate_all_facilities((v_start - interval '1 month')::date, v_start - 1);
  end if;
  return v_total;
end;
$$;

revoke execute on function evaluate_facility_period_internal, raise_auto_finding, evaluate_recent from public, anon, authenticated;
revoke execute on function evaluate_facility_period, evaluate_all_facilities from public, anon;
grant execute on function evaluate_facility_period, evaluate_all_facilities to authenticated;

-- ── On sync: a count or a receipt is checked right away for its month ──────────────────────────
-- A failing check must never lose the user's submission, so errors become warnings.
create or replace function evaluate_after_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_date date;
begin
  if new.kind not in ('stock_count', 'receipt') or new.result is null or old.result is not null then return new; end if;
  select min(txn_date) into v_date from stock_transactions where submission_local_id = new.local_id;
  if v_date is null then return new; end if;
  begin
    perform evaluate_facility_period_internal(new.facility_id, date_trunc('month', v_date)::date,
                                              (date_trunc('month', v_date) + interval '1 month - 1 day')::date, current_date);
  exception when others then
    raise warning 'Finding check after % % failed: %', new.kind, new.local_id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger ledger_submissions_evaluate after update of result on ledger_submissions
  for each row execute function evaluate_after_submission();

-- ── Nightly job ────────────────────────────────────────────────────────────────────────────────
create extension if not exists pg_cron;
select cron.schedule('rutf-nightly-findings', '30 1 * * *', 'select public.evaluate_recent()');
