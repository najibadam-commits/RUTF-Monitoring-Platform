-- RUTF Monitoring Platform — migration 0101 (brief §5, milestone M2)
-- The stock ledger: transfers between facilities, every stock movement per facility and lot, and
-- OTP daily dispensing (aggregate register tallies — no child rows, brief §10).
--
-- Writes go only through the record_* functions below. Each takes the device's idempotent
-- `local_id`: a retried sync returns the stored result instead of writing again (M2 acceptance:
-- no duplicates after forced retries). They are SECURITY DEFINER because one submission writes
-- several tables, and check explicitly that the caller records for that facility.
-- Transactions are never deleted (brief §10); corrections are adjustments.

-- ── Types and tables ───────────────────────────────────────────────────────────────────────────
create type txn_type as enum (
  'receipt',        -- stock arrives (from the supplying facility or a supplier)
  'issue',          -- stock sent to a facility this one supplies
  'dispensed',      -- OTP: daily total handed to caregivers (from otp_daily_dispensing)
  'loss_damaged', 'loss_expired', 'loss_other',
  'adjustment',     -- signed correction with a reason, pending supervisor confirmation
  'physical_count'  -- a count by facility staff; not a movement
);

create sequence transfer_code_seq;

create table transfers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  code text unique,                         -- TRF-<LGA3>-<YY>-000123
  from_facility_id uuid not null references facilities(id),
  to_facility_id uuid not null references facilities(id),
  issued_date date not null,
  received_date date,
  sachets_issued int not null check (sachets_issued >= 0),
  sachets_received int check (sachets_received >= 0),
  status text not null default 'in_transit' check (status in ('in_transit', 'received', 'discrepancy')),
  document_no text,
  issued_by uuid references profiles(id),
  received_by uuid references profiles(id),
  local_id text unique,                     -- the issuing submission
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_facility_id <> to_facility_id)
);
create index transfers_from_idx on transfers(from_facility_id, issued_date);
create index transfers_to_idx on transfers(to_facility_id, status);
create trigger transfers_set_updated_at before update on transfers
  for each row execute function set_updated_at();

create table stock_transactions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  facility_id uuid not null references facilities(id),
  txn_type txn_type not null,
  txn_date date not null,
  lot_id uuid references product_lots(id),
  lot_no_seen text,                         -- as read on the carton
  expiry_seen date,
  quantity_sachets int not null,            -- >= 0, except 'adjustment' which is signed
  counterparty_facility_id uuid references facilities(id),  -- sender for receipt, receiver for issue
  transfer_id uuid references transfers(id),
  document_no text,                         -- waybill / issue voucher / stock card page
  reason text,
  recorded_by uuid not null references profiles(id),
  device_id text,
  local_id text unique,                     -- <submission local_id>:<line>
  submission_local_id text,
  status text not null default 'recorded' check (status in ('recorded', 'confirmed', 'voided')),
  confirmed_by uuid references profiles(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  check (quantity_sachets >= 0 or txn_type = 'adjustment'),
  check (reason is not null or txn_type not in ('loss_damaged', 'loss_expired', 'loss_other', 'adjustment'))
);
create index stock_transactions_facility_idx on stock_transactions(facility_id, txn_date);
create index stock_transactions_lot_idx on stock_transactions(facility_id, lot_id);
create index stock_transactions_transfer_idx on stock_transactions(transfer_id);
create index stock_transactions_counterparty_idx on stock_transactions(counterparty_facility_id) where txn_type = 'issue';
create index stock_transactions_submission_idx on stock_transactions(submission_local_id);

create table otp_daily_dispensing (         -- AGGREGATE from the OTP register: no child rows, no names
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  facility_id uuid not null references facilities(id),
  dispense_date date not null,
  new_admissions int not null default 0 check (new_admissions >= 0),
  children_seen int not null check (children_seen >= 0),
  sachets_prescribed int not null check (sachets_prescribed >= 0),
  sachets_dispensed int not null check (sachets_dispensed >= 0),
  recorded_by uuid not null references profiles(id),
  device_id text,
  local_id text unique,
  created_at timestamptz not null default now(),
  unique (facility_id, dispense_date)
);

-- One row per device submission: the idempotency record (and its stored result).
create table ledger_submissions (
  local_id text primary key,
  kind text not null,
  facility_id uuid not null references facilities(id),
  recorded_by uuid not null references profiles(id),
  result jsonb,
  created_at timestamptz not null default now()
);

-- Waybills, stock-card pages, register pages (names covered) — brief §12.5.
create table ledger_photos (
  id uuid primary key default gen_random_uuid(),
  submission_local_id text not null references ledger_submissions(local_id),
  facility_id uuid not null references facilities(id),
  storage_path text not null unique,        -- {facility_id}/{submission_local_id}/{file} in ledger-evidence
  kind text not null check (kind in ('waybill', 'stock_card', 'register_page', 'loss_evidence', 'other')),
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id) default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index ledger_photos_submission_idx on ledger_photos(submission_local_id);

-- ── Balance helpers ────────────────────────────────────────────────────────────────────────────
-- Ledger balance = Σ receipts − Σ issues − Σ dispensed − Σ losses ± adjustments (brief §7).
create or replace function ledger_signed_quantity(p_type txn_type, p_quantity int)
returns int language sql immutable as $$
  select case
    when p_type = 'receipt' then p_quantity
    when p_type = 'adjustment' then p_quantity
    when p_type = 'physical_count' then 0
    else -p_quantity
  end;
$$;

-- Balance at a facility as of a date — one lot, or the whole facility when p_lot_id is null.
create or replace function ledger_balance(p_facility_id uuid, p_lot_id uuid, p_as_of date)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(ledger_signed_quantity(txn_type, quantity_sachets)), 0)::int
  from stock_transactions
  where facility_id = p_facility_id
    and status <> 'voided'
    and txn_date <= p_as_of
    and (p_lot_id is null or lot_id = p_lot_id);
$$;

-- Current balance per facility and lot (security_invoker: the caller's RLS applies).
create view stock_balances with (security_invoker = true) as
select t.facility_id, t.lot_id, l.lot_no, l.expiry_date,
       sum(ledger_signed_quantity(t.txn_type, t.quantity_sachets))::int as balance,
       max(t.txn_date) as last_txn_date
from stock_transactions t
left join product_lots l on l.id = t.lot_id
where t.status <> 'voided'
group by t.facility_id, t.lot_id, l.lot_no, l.expiry_date;

-- Transfers with their gap and in-transit age (brief §7 "Transfer gap").
create view transfer_overview with (security_invoker = true) as
select tr.*,
       tr.sachets_issued - coalesce(tr.sachets_received, 0) as gap,
       case when tr.status = 'in_transit' then current_date - tr.issued_date end as days_in_transit
from transfers tr;

-- ── Authorisation and lot helpers ──────────────────────────────────────────────────────────────
-- The caller may record for this facility: its own facility user, or Super Admin (data fixes).
create or replace function assert_can_record(p_facility_id uuid)
returns facilities language plpgsql stable security definer set search_path = public as $$
declare f facilities;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if current_account_status() is distinct from 'active' then raise exception 'Your account is inactive'; end if;
  select * into f from facilities where id = p_facility_id and status = 'approved' and is_active;
  if not found then raise exception 'Facility not found or inactive'; end if;
  if is_super_admin() then return f; end if;
  if current_user_role() = 'dri' and current_facility_id() = p_facility_id then return f; end if;
  raise exception 'You can only record stock for your own facility';
end;
$$;

-- A lot by id, or by number as read on the carton — a number not yet in the list is added
-- (with its expiry), so downstream issues can follow it (RUTF DECISIONS R22).
create or replace function resolve_lot(p_lot_id uuid, p_lot_no text, p_expiry date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_product uuid;
begin
  if p_lot_id is not null then
    if not exists (select 1 from product_lots where id = p_lot_id) then raise exception 'Unknown lot %', p_lot_id; end if;
    return p_lot_id;
  end if;
  if nullif(trim(p_lot_no), '') is null then return null; end if;
  select id into v_product from products order by created_at limit 1;
  select id into v_id from product_lots where product_id = v_product and lower(lot_no) = lower(trim(p_lot_no));
  if v_id is not null then return v_id; end if;
  if p_expiry is null then raise exception 'Expiry date is required for new lot %', trim(p_lot_no); end if;
  insert into product_lots (product_id, lot_no, expiry_date, created_by)
  values (v_product, trim(p_lot_no), p_expiry, auth.uid())
  on conflict (product_id, lot_no) do update set lot_no = excluded.lot_no
  returning id into v_id;
  return v_id;
end;
$$;

-- Returns the stored result when this local_id was already recorded, else claims it.
create or replace function ledger_claim(p_local_id text, p_kind text, p_facility_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_existing ledger_submissions;
begin
  if nullif(trim(p_local_id), '') is null then raise exception 'local_id is required'; end if;
  select * into v_existing from ledger_submissions where local_id = p_local_id;
  if found then
    if v_existing.kind <> p_kind or v_existing.facility_id <> p_facility_id then
      raise exception 'local_id % was already used for a different submission', p_local_id;
    end if;
    return coalesce(v_existing.result, '{}'::jsonb) || jsonb_build_object('duplicate', true);
  end if;
  insert into ledger_submissions (local_id, kind, facility_id, recorded_by) values (p_local_id, p_kind, p_facility_id, auth.uid());
  return null;
end;
$$;

create or replace function ledger_finish(p_local_id text, p_result jsonb)
returns jsonb language sql security definer set search_path = public as $$
  update ledger_submissions set result = p_result where local_id = p_local_id;
  select p_result || jsonb_build_object('duplicate', false);
$$;

-- ── Recording functions ────────────────────────────────────────────────────────────────────────
-- p_lines: [{ "lot_id": uuid?, "lot_no": text?, "expiry_date": date?, "quantity": int, "damaged": int? }]

-- Stock arrives: confirms an in-transit transfer to this facility, or records a supplier
-- delivery (no transfer). `quantity` is everything received; `damaged` of it is written off.
create or replace function record_receipt(
  p_local_id text, p_facility_id uuid, p_txn_date date, p_lines jsonb,
  p_transfer_id uuid default null, p_document_no text default null, p_device_id text default null,
  p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f facilities;
  tr transfers;
  v_done jsonb;
  v_line record;
  v_lot uuid;
  v_n int := 0;
  v_received int := 0;
  v_damaged int := 0;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_status text;
begin
  f := assert_can_record(p_facility_id);
  v_done := ledger_claim(p_local_id, 'receipt', p_facility_id);
  if v_done is not null then return v_done; end if;
  if p_txn_date is null or p_txn_date > current_date then raise exception 'Receipt date is missing or in the future'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'At least one lot line is required'; end if;

  if p_transfer_id is not null then
    select * into tr from transfers where id = p_transfer_id for update;
    if not found or tr.to_facility_id <> p_facility_id then raise exception 'That transfer is not addressed to this facility'; end if;
    if tr.status <> 'in_transit' then raise exception 'Transfer % was already received', tr.code; end if;
    if p_txn_date < tr.issued_date then raise exception 'Receipt date is before the issue date'; end if;
  elsif nullif(trim(p_document_no), '') is null then
    raise exception 'A waybill / delivery note number is required for a supplier delivery';
  end if;

  for v_line in select * from jsonb_to_recordset(p_lines) as x(lot_id uuid, lot_no text, expiry_date date, quantity int, damaged int) loop
    if coalesce(v_line.quantity, -1) < 0 or coalesce(v_line.damaged, 0) < 0 or coalesce(v_line.damaged, 0) > v_line.quantity then
      raise exception 'Each line needs a quantity, and damaged cannot exceed it';
    end if;
    v_lot := resolve_lot(v_line.lot_id, v_line.lot_no, v_line.expiry_date);
    v_n := v_n + 1;
    insert into stock_transactions (project_id, facility_id, txn_type, txn_date, lot_id, lot_no_seen, expiry_seen,
      quantity_sachets, counterparty_facility_id, transfer_id, document_no, reason, recorded_by, device_id, local_id, submission_local_id)
    values (f.project_id, p_facility_id, 'receipt', p_txn_date, v_lot, v_line.lot_no, v_line.expiry_date,
      v_line.quantity, tr.from_facility_id, p_transfer_id, coalesce(p_document_no, tr.document_no), p_note,
      auth.uid(), p_device_id, p_local_id || ':' || v_n, p_local_id)
    returning id into v_id;
    v_ids := v_ids || v_id;
    v_received := v_received + v_line.quantity;

    if coalesce(v_line.damaged, 0) > 0 then
      v_n := v_n + 1;
      insert into stock_transactions (project_id, facility_id, txn_type, txn_date, lot_id, quantity_sachets, transfer_id,
        reason, recorded_by, device_id, local_id, submission_local_id)
      values (f.project_id, p_facility_id, 'loss_damaged', p_txn_date, v_lot, v_line.damaged, p_transfer_id,
        'damaged on arrival', auth.uid(), p_device_id, p_local_id || ':' || v_n, p_local_id)
      returning id into v_id;
      v_ids := v_ids || v_id;
      v_damaged := v_damaged + v_line.damaged;
    end if;
  end loop;

  if p_transfer_id is not null then
    v_status := case when v_received = tr.sachets_issued then 'received' else 'discrepancy' end;
    update transfers set sachets_received = v_received, received_date = p_txn_date, received_by = auth.uid(), status = v_status
    where id = p_transfer_id;
  end if;

  return ledger_finish(p_local_id, jsonb_build_object(
    'kind', 'receipt', 'transaction_ids', to_jsonb(v_ids), 'sachets_received', v_received, 'sachets_damaged', v_damaged,
    'transfer_id', p_transfer_id, 'transfer_code', tr.code, 'transfer_status', v_status,
    'sachets_issued', tr.sachets_issued));
end;
$$;

-- Stock sent to a facility this one supplies: creates the transfer and one issue row per lot.
create or replace function record_issue(
  p_local_id text, p_facility_id uuid, p_to_facility_id uuid, p_txn_date date, p_lines jsonb,
  p_document_no text default null, p_device_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f facilities;
  v_done jsonb;
  v_line record;
  v_lot uuid;
  v_n int := 0;
  v_total int := 0;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_transfer transfers;
  v_lga_abbr text;
begin
  f := assert_can_record(p_facility_id);
  if f.facility_type = 'health_facility' then raise exception 'Only stores issue stock'; end if;
  v_done := ledger_claim(p_local_id, 'issue', p_facility_id);
  if v_done is not null then return v_done; end if;
  if p_txn_date is null or p_txn_date > current_date then raise exception 'Issue date is missing or in the future'; end if;
  if not exists (select 1 from facilities where id = p_to_facility_id and supplied_by_facility_id = p_facility_id and status = 'approved' and is_active) then
    raise exception 'This store does not supply that facility';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'At least one lot line is required'; end if;

  for v_line in select * from jsonb_to_recordset(p_lines) as x(lot_id uuid, lot_no text, expiry_date date, quantity int) loop
    if coalesce(v_line.quantity, 0) <= 0 then raise exception 'Each line needs a quantity above zero'; end if;
    v_total := v_total + v_line.quantity;
  end loop;

  select abbr into v_lga_abbr from lgas where id = f.lga_id;
  insert into transfers (project_id, code, from_facility_id, to_facility_id, issued_date, sachets_issued, document_no, issued_by, local_id)
  values (f.project_id,
          'TRF-' || coalesce(v_lga_abbr, 'GEN') || '-' || to_char(p_txn_date, 'YY') || '-' || lpad(nextval('transfer_code_seq')::text, 6, '0'),
          p_facility_id, p_to_facility_id, p_txn_date, v_total, p_document_no, auth.uid(), p_local_id)
  returning * into v_transfer;

  for v_line in select * from jsonb_to_recordset(p_lines) as x(lot_id uuid, lot_no text, expiry_date date, quantity int) loop
    v_lot := resolve_lot(v_line.lot_id, v_line.lot_no, v_line.expiry_date);
    v_n := v_n + 1;
    insert into stock_transactions (project_id, facility_id, txn_type, txn_date, lot_id, lot_no_seen, expiry_seen,
      quantity_sachets, counterparty_facility_id, transfer_id, document_no, recorded_by, device_id, local_id, submission_local_id)
    values (f.project_id, p_facility_id, 'issue', p_txn_date, v_lot, v_line.lot_no, v_line.expiry_date,
      v_line.quantity, p_to_facility_id, v_transfer.id, p_document_no, auth.uid(), p_device_id, p_local_id || ':' || v_n, p_local_id)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  return ledger_finish(p_local_id, jsonb_build_object(
    'kind', 'issue', 'transaction_ids', to_jsonb(v_ids), 'transfer_id', v_transfer.id, 'transfer_code', v_transfer.code,
    'sachets_issued', v_total));
end;
$$;

-- OTP daily register tallies. Dispensed sachets are allocated to lots earliest-expiry-first,
-- unexpired lots before expired ones (the register records no lot — RUTF DECISIONS R22); any
-- amount beyond the recorded stock is kept as an unallocated row so the shortfall stays visible.
create or replace function record_dispensing(
  p_local_id text, p_facility_id uuid, p_dispense_date date,
  p_new_admissions int, p_children_seen int, p_sachets_prescribed int, p_sachets_dispensed int,
  p_device_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f facilities;
  v_done jsonb;
  v_disp_id uuid;
  v_left int;
  v_take int;
  v_n int := 0;
  v_ids uuid[] := '{}';
  v_id uuid;
  r record;
begin
  f := assert_can_record(p_facility_id);
  if not f.is_otp_site then raise exception 'Daily dispensing is recorded at OTP sites only'; end if;
  v_done := ledger_claim(p_local_id, 'dispensing', p_facility_id);
  if v_done is not null then return v_done; end if;
  if p_dispense_date is null or p_dispense_date > current_date then raise exception 'Date is missing or in the future'; end if;
  if least(p_new_admissions, p_children_seen, p_sachets_prescribed, p_sachets_dispensed) < 0 then raise exception 'Tallies cannot be negative'; end if;
  if p_new_admissions > p_children_seen then raise exception 'New admissions cannot exceed children seen'; end if;
  if exists (select 1 from otp_daily_dispensing where facility_id = p_facility_id and dispense_date = p_dispense_date) then
    raise exception 'Dispensing for % is already recorded at this facility', p_dispense_date;
  end if;

  insert into otp_daily_dispensing (project_id, facility_id, dispense_date, new_admissions, children_seen,
    sachets_prescribed, sachets_dispensed, recorded_by, device_id, local_id)
  values (f.project_id, p_facility_id, p_dispense_date, p_new_admissions, p_children_seen,
    p_sachets_prescribed, p_sachets_dispensed, auth.uid(), p_device_id, p_local_id)
  returning id into v_disp_id;

  v_left := p_sachets_dispensed;
  for r in
    select b.lot_id, b.balance
    from (select lot_id, sum(ledger_signed_quantity(txn_type, quantity_sachets)) as balance
            from stock_transactions
           where facility_id = p_facility_id and status <> 'voided' and lot_id is not null and txn_date <= p_dispense_date
           group by lot_id) b
    join product_lots l on l.id = b.lot_id
    where b.balance > 0
    order by (l.expiry_date < p_dispense_date), l.expiry_date, l.lot_no
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.balance);
    v_n := v_n + 1;
    insert into stock_transactions (project_id, facility_id, txn_type, txn_date, lot_id, quantity_sachets, document_no,
      recorded_by, device_id, local_id, submission_local_id)
    values (f.project_id, p_facility_id, 'dispensed', p_dispense_date, r.lot_id, v_take, 'OTP register ' || p_dispense_date,
      auth.uid(), p_device_id, p_local_id || ':' || v_n, p_local_id)
    returning id into v_id;
    v_ids := v_ids || v_id;
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    v_n := v_n + 1;
    insert into stock_transactions (project_id, facility_id, txn_type, txn_date, quantity_sachets, document_no, reason,
      recorded_by, device_id, local_id, submission_local_id)
    values (f.project_id, p_facility_id, 'dispensed', p_dispense_date, v_left, 'OTP register ' || p_dispense_date,
      'more dispensed than the recorded stock', auth.uid(), p_device_id, p_local_id || ':' || v_n, p_local_id)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end if;

  return ledger_finish(p_local_id, jsonb_build_object(
    'kind', 'dispensing', 'dispensing_id', v_disp_id, 'transaction_ids', to_jsonb(v_ids),
    'unallocated_sachets', greatest(v_left, 0)));
end;
$$;

-- A count by facility staff. p_lines: [{ lot_id?/lot_no?/expiry_date?, "physical_count": int }],
-- or one line without a lot for a whole-facility total. Any difference from the ledger becomes an
-- adjustment pending supervisor confirmation (RUTF DECISIONS R7). The result carries the
-- expected balances — the app shows them only after the count is entered (brief §8).
create or replace function record_stock_count(
  p_local_id text, p_facility_id uuid, p_count_date date, p_lines jsonb, p_device_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f facilities;
  v_done jsonb;
  v_line record;
  v_lot uuid;
  v_expected int;
  v_diff int;
  v_n int := 0;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_lines jsonb := '[]'::jsonb;
begin
  f := assert_can_record(p_facility_id);
  v_done := ledger_claim(p_local_id, 'stock_count', p_facility_id);
  if v_done is not null then return v_done; end if;
  if p_count_date is null or p_count_date > current_date then raise exception 'Count date is missing or in the future'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'At least one count line is required'; end if;

  for v_line in select * from jsonb_to_recordset(p_lines) as x(lot_id uuid, lot_no text, expiry_date date, physical_count int) loop
    if coalesce(v_line.physical_count, -1) < 0 then raise exception 'Each count must be zero or more'; end if;
    v_lot := resolve_lot(v_line.lot_id, v_line.lot_no, v_line.expiry_date);
    v_expected := ledger_balance(p_facility_id, v_lot, p_count_date);
    v_n := v_n + 1;
    insert into stock_transactions (project_id, facility_id, txn_type, txn_date, lot_id, lot_no_seen, expiry_seen,
      quantity_sachets, recorded_by, device_id, local_id, submission_local_id)
    values (f.project_id, p_facility_id, 'physical_count', p_count_date, v_lot, v_line.lot_no, v_line.expiry_date,
      v_line.physical_count, auth.uid(), p_device_id, p_local_id || ':' || v_n, p_local_id)
    returning id into v_id;
    v_ids := v_ids || v_id;

    v_diff := v_line.physical_count - v_expected;
    if v_diff <> 0 then
      v_n := v_n + 1;
      insert into stock_transactions (project_id, facility_id, txn_type, txn_date, lot_id, quantity_sachets, reason,
        recorded_by, device_id, local_id, submission_local_id)
      values (f.project_id, p_facility_id, 'adjustment', p_count_date, v_lot, v_diff,
        case when v_diff < 0 then 'count shortfall' else 'count surplus' end,
        auth.uid(), p_device_id, p_local_id || ':' || v_n, p_local_id)
      returning id into v_id;
      v_ids := v_ids || v_id;
    end if;
    v_lines := v_lines || jsonb_build_object('lot_id', v_lot, 'physical_count', v_line.physical_count,
      'ledger_balance', v_expected, 'difference', v_diff,
      'variance_pct', case when v_expected <> 0 then round((v_expected - v_line.physical_count)::numeric / v_expected * 100, 1) end);
  end loop;

  return ledger_finish(p_local_id, jsonb_build_object('kind', 'stock_count', 'transaction_ids', to_jsonb(v_ids), 'lines', v_lines));
end;
$$;

-- A loss (damaged / expired / other) or a signed adjustment, with a reason.
create or replace function record_loss(
  p_local_id text, p_facility_id uuid, p_txn_date date, p_txn_type txn_type, p_quantity int, p_reason text,
  p_lot_id uuid default null, p_lot_no text default null, p_expiry_date date default null, p_device_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f facilities;
  v_done jsonb;
  v_lot uuid;
  v_id uuid;
begin
  f := assert_can_record(p_facility_id);
  if p_txn_type not in ('loss_damaged', 'loss_expired', 'loss_other', 'adjustment') then raise exception 'Not a loss or adjustment type'; end if;
  v_done := ledger_claim(p_local_id, 'loss', p_facility_id);
  if v_done is not null then return v_done; end if;
  if p_txn_date is null or p_txn_date > current_date then raise exception 'Date is missing or in the future'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A reason is required'; end if;
  if p_quantity is null or p_quantity = 0 or (p_quantity < 0 and p_txn_type <> 'adjustment') then
    raise exception 'Quantity must be above zero (adjustments may be negative)';
  end if;
  v_lot := resolve_lot(p_lot_id, p_lot_no, p_expiry_date);

  insert into stock_transactions (project_id, facility_id, txn_type, txn_date, lot_id, lot_no_seen, expiry_seen,
    quantity_sachets, reason, recorded_by, device_id, local_id, submission_local_id)
  values (f.project_id, p_facility_id, p_txn_type, p_txn_date, v_lot, p_lot_no, p_expiry_date,
    p_quantity, trim(p_reason), auth.uid(), p_device_id, p_local_id || ':1', p_local_id)
  returning id into v_id;

  return ledger_finish(p_local_id, jsonb_build_object('kind', 'loss', 'transaction_ids', jsonb_build_array(v_id),
    'balance_after', ledger_balance(p_facility_id, v_lot, p_txn_date)));
end;
$$;

-- Only signed-in users reach these; each checks the caller itself.
revoke execute on function record_receipt, record_issue, record_dispensing, record_stock_count, record_loss,
  assert_can_record, resolve_lot, ledger_claim, ledger_finish from public, anon;
grant execute on function record_receipt, record_issue, record_dispensing, record_stock_count, record_loss to authenticated;
revoke execute on function resolve_lot, ledger_claim, ledger_finish from authenticated;

-- ── RLS ────────────────────────────────────────────────────────────────────────────────────────
-- Reads: a facility user sees their own facility's records, transfers to or from it, and the
-- issue lines of transfers addressed to it (to pre-fill Receive Stock). Everyone else: their
-- project. No direct writes — only the record_* functions above.
alter table transfers enable row level security;
alter table stock_transactions enable row level security;
alter table otp_daily_dispensing enable row level security;
alter table ledger_submissions enable row level security;
alter table ledger_photos enable row level security;

create policy transfers_select on transfers for select to authenticated
  using (case when current_user_role() = 'dri'
              then current_facility_id() in (from_facility_id, to_facility_id)
              else in_scope(project_id) end);

create policy stock_transactions_select on stock_transactions for select to authenticated
  using (case when current_user_role() = 'dri'
              then facility_id = current_facility_id()
                   or (txn_type = 'issue' and counterparty_facility_id = current_facility_id())
              else in_scope(project_id) end);

create policy otp_daily_dispensing_select on otp_daily_dispensing for select to authenticated
  using (case when current_user_role() = 'dri' then facility_id = current_facility_id() else in_scope(project_id) end);

create policy ledger_photos_select on ledger_photos for select to authenticated
  using (case when current_user_role() = 'dri' then facility_id = current_facility_id()
              else exists (select 1 from facilities fa where fa.id = facility_id and in_scope(fa.project_id)) end);
create policy ledger_photos_insert on ledger_photos for insert to authenticated
  with check (
    (current_user_role() = 'dri' and facility_id = current_facility_id() or is_super_admin())
    and exists (select 1 from ledger_submissions s where s.local_id = submission_local_id and s.facility_id = ledger_photos.facility_id)
  );

-- ── Evidence bucket: {facility_id}/{submission_local_id}/{file} ─────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ledger-evidence', 'ledger-evidence', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy "ledger-evidence select" on storage.objects for select to authenticated
  using (
    bucket_id = 'ledger-evidence'
    and exists (select 1 from ledger_photos p where p.storage_path = name)
  );
create policy "ledger-evidence insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ledger-evidence'
    and (
      is_super_admin()
      or (current_user_role() = 'dri' and (storage.foldername(name))[1] = current_facility_id()::text)
    )
  );
