-- RUTF Monitoring Platform — migration 0119
-- Transfer ID in the same administrative order as Finding IDs (DECISIONS R76), for the RECEIVING
-- facility and with a TRF prefix so a transfer and a Finding never share an ID:
--   TRF-STATE-LGA-WARD-LEVEL-YYNNN, e.g. TRF-KT-DAU-MAJ-OTP-26001
-- Sequence per receiving state-LGA-ward-level and year of issue (3 digits, growing if needed).
-- The 3,364 DUMMY transfers are re-numbered in issue order, the 80 transfer-mismatch Findings
-- that quote a transfer ID are updated to match, and the counters carried on. The transfers
-- audit trigger is paused for this one-time re-numbering (documented here and in R76) so the
-- Audit Trail isn't flooded with 3,364 code changes.

create table if not exists transfer_id_counters (
  prefix text not null,
  year smallint not null,
  last_number int not null,
  primary key (prefix, year)
);
alter table transfer_id_counters enable row level security;  -- no policies: only the functions below use it

-- "TRF-KT-DAU-MAJ-OTP" for a facility (its state, LGA, ward and level); GEN where unknown.
create or replace function transfer_code_prefix(p_facility_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select 'TRF-' || coalesce(s.code, 'GEN') || '-' || coalesce(l.abbr, 'GEN') || '-' || coalesce(w.abbr, 'GEN') || '-' ||
         case f.facility_type when 'state_store' then 'SST' when 'lga_store' then 'LST' when 'health_facility' then 'OTP' else 'GEN' end
  from facilities f
  left join lgas l on l.id = f.lga_id
  left join states s on s.id = l.state_id
  left join wards w on w.id = f.ward_id
  where f.id = p_facility_id;
$$;

create or replace function next_transfer_code(p_to_facility_id uuid, p_date date)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_prefix text := coalesce(transfer_code_prefix(p_to_facility_id), 'TRF-GEN-GEN-GEN-GEN');
  v_year text := to_char(coalesce(p_date, current_date), 'YY');
  v_seq int;
begin
  insert into transfer_id_counters (prefix, year, last_number) values (v_prefix, v_year::smallint, 1)
  on conflict (prefix, year) do update set last_number = transfer_id_counters.last_number + 1
  returning last_number into v_seq;
  return v_prefix || '-' || v_year || lpad(v_seq::text, 3, '0');
end;
$$;
revoke execute on function transfer_code_prefix(uuid) from public, anon, authenticated;
revoke execute on function next_transfer_code(uuid, date) from public, anon, authenticated;

-- record_issue: the live definition with the code built by next_transfer_code() (was
-- 'TRF-' || LGA || '-' || YY || '-' || 6-digit global sequence).
CREATE OR REPLACE FUNCTION public.record_issue(p_local_id text, p_facility_id uuid, p_to_facility_id uuid, p_txn_date date, p_lines jsonb, p_document_no text DEFAULT NULL::text, p_device_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          next_transfer_code(p_to_facility_id, p_txn_date),
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
$function$;

-- ── Re-number the DUMMY transfers ───────────────────────────────────────────────────────────────
create temporary table transfer_code_map on commit drop as
select t.id, t.code as old_code,
       transfer_code_prefix(t.to_facility_id) || '-' || to_char(t.issued_date, 'YY') ||
         lpad(row_number() over (partition by transfer_code_prefix(t.to_facility_id), to_char(t.issued_date, 'YY')
                                 order by t.issued_date, t.created_at, t.id)::text, 3, '0') as new_code
from transfers t
join facilities f on f.id = t.to_facility_id and f.dummy_fields is not null;

alter table transfers disable trigger transfers_audit;
update transfers t set code = m.new_code from transfer_code_map m where m.id = t.id;
alter table transfers enable trigger transfers_audit;

-- Findings that quote a transfer ID (transfer mismatch): description and measurements.
update issues i set description = replace(i.description, m.old_code, m.new_code),
                    metric = replace(i.metric::text, m.old_code, m.new_code)::jsonb
from transfer_code_map m
where i.transfer_id = m.id and (i.description like '%' || m.old_code || '%' or i.metric::text like '%' || m.old_code || '%');

insert into transfer_id_counters (prefix, year, last_number)
select regexp_replace(new_code, '-\d{5,}$', ''), substring(new_code from '-(\d{2})\d{3,}$')::smallint,
       max(substring(new_code from '-\d{2}(\d{3,})$')::int)
from transfer_code_map group by 1, 2
on conflict (prefix, year) do update set last_number = greatest(transfer_id_counters.last_number, excluded.last_number);
