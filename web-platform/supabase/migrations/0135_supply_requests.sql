-- RUTF Monitoring Platform — migration 0135: supply requests (DECISIONS R170)
-- Two levels, one workflow (the user's role standardisation, 11 Oct 2026):
--   OTP Officer      -> LGA Nutrition Officer  (the OTP site asks its LGA store; made in the app)
--   LGA Nutrition Officer -> State Nutrition Officer (the LGA store asks the State store; made on the web)
-- The reviewer is the officer at the supplying store (facilities.supplied_by_facility_id).
-- Statuses: submitted -> under_review -> queried (back to the requester, who answers and
-- resubmits) -> approved / rejected; then partially_fulfilled / dispatched -> received; or
-- cancelled by the requester before a decision.
-- Approving does NOT move stock. Stock moves only when the supplying store records the issue as
-- usual (record_issue, the app's Issue Stock); the new transfer is linked to the approved request
-- automatically, and the request becomes dispatched (or partially fulfilled). When the receiving
-- facility records the receipt, the request becomes received.
-- State Coordinators and Supervisors see the requests in their jurisdiction and may add
-- comments (technical advice); they do not approve or dispatch.
-- Tables are reached only through the functions below (no direct API access); every action is
-- an event row (who, when, what, before/after quantities, reason).

create table supply_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  code text unique,                                    -- SR-<LGA abbr>-<YY>-000123
  level text not null check (level in ('otp_to_lga', 'lga_to_state')),
  from_facility_id uuid not null references facilities(id),   -- the requester's facility
  to_facility_id uuid not null references facilities(id),     -- the supplying store
  status text not null default 'submitted' check (status in (
    'submitted', 'under_review', 'queried', 'approved', 'rejected',
    'partially_fulfilled', 'dispatched', 'received', 'cancelled')),
  needed_by date,
  justification text,
  requested_by uuid references profiles(id),
  submitted_at timestamptz not null default now(),
  resubmitted_count int not null default 0,
  reviewed_by uuid references profiles(id),
  decided_at timestamptz,
  decision_note text,
  local_id text unique,                                -- idempotent create from the app
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_facility_id <> to_facility_id)
);
create index supply_requests_from_idx on supply_requests(from_facility_id, status);
create index supply_requests_to_idx on supply_requests(to_facility_id, status);
create trigger supply_requests_set_updated_at before update on supply_requests
  for each row execute function set_updated_at();
create sequence if not exists supply_request_code_seq;

create table supply_request_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references supply_requests(id) on delete cascade,
  product_id uuid not null references products(id),
  balance_on_hand int,              -- the requester's ledger balance when submitted (sachets)
  consumed_30d int,                 -- issued + dispensed over the 30 days before submission
  stockout_days int check (stockout_days >= 0),
  requested_qty int not null check (requested_qty > 0),   -- sachets
  approved_qty int check (approved_qty >= 0),
  unique (request_id, product_id)
);

create table supply_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references supply_requests(id) on delete cascade,
  action text not null check (action in (
    'submitted', 'review_started', 'queried', 'responded', 'approved', 'rejected', 'cancelled',
    'comment', 'dispatched', 'received')),
  actor uuid references profiles(id),
  actor_role text,                  -- e.g. 'LGA Nutrition Officer', 'State Coordinator'
  note text,
  detail jsonb,                     -- quantities before/after, transfer code, ...
  status_before text,
  status_after text,
  created_at timestamptz not null default now()
);
create index supply_request_events_req_idx on supply_request_events(request_id, created_at);

alter table transfers add column if not exists supply_request_id uuid references supply_requests(id);
create index if not exists transfers_supply_request_idx on transfers(supply_request_id);

alter table supply_requests enable row level security;
alter table supply_request_lines enable row level security;
alter table supply_request_events enable row level security;
revoke all on table supply_requests, supply_request_lines, supply_request_events from anon, authenticated;

-- ── Helpers ───────────────────────────────────────────────────────────────────────────────────
-- What the caller is called in this workflow.
create or replace function rutf_role_title()
returns text language sql stable security definer set search_path = public as $$
  select case p.role
    when 'dri' then case f.facility_type when 'state_store' then 'State Nutrition Officer'
                                         when 'lga_store' then 'LGA Nutrition Officer' else 'OTP Officer' end
    when 'tpm_supervisor' then 'Supervisor'
    when 'state_coordinator' then 'State Coordinator'
    when 'project_admin' then 'Project Admin'
    when 'super_admin' then 'Super Admin'
    else 'Viewer' end
  from profiles p left join facilities f on f.id = p.facility_id where p.id = auth.uid();
$$;

-- Active facility officers of a facility (the people notified).
create or replace function rutf_facility_officers(p_facility_id uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from profiles where facility_id = p_facility_id and role = 'dri' and status = 'active';
$$;

create or replace function supply_request_notify(p_request supply_requests, p_to_facility uuid, p_text text)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, type, text, link)
  select u, 'supply_request', p_text, '/supply-requests/' || p_request.id
  from rutf_facility_officers(p_to_facility) u where u is distinct from auth.uid();
$$;

create or replace function supply_request_log(p_id uuid, p_action text, p_note text, p_detail jsonb, p_before text, p_after text)
returns void language sql security definer set search_path = public as $$
  insert into supply_request_events (request_id, action, actor, actor_role, note, detail, status_before, status_after)
  values (p_id, p_action, auth.uid(), rutf_role_title(), nullif(trim(p_note), ''), p_detail, p_before, p_after);
$$;

-- ── The form: what the requester's facility has, uses and has asked for ──────────────────────
create or replace function supply_request_form()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f facilities; s facilities; v_balance int; v_used int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select fa.* into f from facilities fa where fa.id = current_facility_id();
  if current_user_role() <> 'dri' or f.id is null then raise exception 'Only an OTP Officer or an LGA Nutrition Officer makes supply requests'; end if;
  if f.facility_type = 'state_store' then raise exception 'The State store is not supplied through this form'; end if;
  if f.facility_type = 'health_facility' and not f.is_otp_site then raise exception 'Only OTP sites make supply requests'; end if;
  select fa.* into s from facilities fa where fa.id = f.supplied_by_facility_id;
  if s.id is null then raise exception 'Your facility has no supplying store on record — ask your administrator'; end if;
  v_balance := ledger_balance(f.id, null, current_date);
  select coalesce(sum(quantity_sachets), 0) into v_used from stock_transactions
  where facility_id = f.id and status <> 'voided' and txn_type in ('issue', 'dispensed') and txn_date > current_date - 30;
  return jsonb_build_object(
    'facility', jsonb_build_object('id', f.id, 'name', f.name, 'type', f.facility_type),
    'supplier', jsonb_build_object('id', s.id, 'name', s.name, 'type', s.facility_type),
    'level', case f.facility_type when 'lga_store' then 'lga_to_state' else 'otp_to_lga' end,
    'balance_on_hand', v_balance,
    'consumed_30d', v_used,
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'unit', unit, 'units_per_carton', units_per_carton) order by name), '[]') from products),
    'open_requests', (select count(*) from supply_requests where from_facility_id = f.id
                      and status in ('submitted', 'under_review', 'queried', 'approved', 'partially_fulfilled')));
end;
$$;

-- ── Create (the requester) ────────────────────────────────────────────────────────────────────
-- p: {lines: [{product_id, requested_qty, stockout_days}], justification, needed_by, local_id}
create or replace function supply_request_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_form jsonb; f facilities; r supply_requests; v_line record; v_abbr text; v_n int := 0;
begin
  if p ->> 'local_id' is not null then
    select * into r from supply_requests where local_id = p ->> 'local_id';
    if found then return jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status); end if;
  end if;
  v_form := supply_request_form();   -- checks the caller
  select * into f from facilities where id = (v_form #>> '{facility,id}')::uuid;
  if jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') = 0 then
    raise exception 'Add at least one commodity with a quantity';
  end if;
  select abbr into v_abbr from lgas where id = f.lga_id;
  insert into supply_requests (project_id, code, level, from_facility_id, to_facility_id, needed_by, justification, requested_by, local_id)
  values (f.project_id, 'SR-' || coalesce(v_abbr, 'GEN') || '-' || to_char(current_date, 'YY') || '-' || lpad(nextval('supply_request_code_seq')::text, 6, '0'),
          v_form ->> 'level', f.id, f.supplied_by_facility_id, nullif(p ->> 'needed_by', '')::date,
          nullif(trim(p ->> 'justification'), ''), auth.uid(), p ->> 'local_id')
  returning * into r;
  for v_line in select * from jsonb_to_recordset(p -> 'lines') as x(product_id uuid, requested_qty int, stockout_days int) loop
    if coalesce(v_line.requested_qty, 0) <= 0 then raise exception 'Each commodity needs a quantity above zero'; end if;
    if not exists (select 1 from products where id = v_line.product_id) then raise exception 'Unknown commodity'; end if;
    insert into supply_request_lines (request_id, product_id, balance_on_hand, consumed_30d, stockout_days, requested_qty)
    values (r.id, v_line.product_id, (v_form ->> 'balance_on_hand')::int, (v_form ->> 'consumed_30d')::int, v_line.stockout_days, v_line.requested_qty);
    v_n := v_n + 1;
  end loop;
  perform supply_request_log(r.id, 'submitted', r.justification,
    (select jsonb_agg(jsonb_build_object('product_id', product_id, 'requested_qty', requested_qty)) from supply_request_lines where request_id = r.id),
    null, 'submitted');
  perform supply_request_notify(r, r.to_facility_id, 'Supply request ' || r.code || ' from ' || f.name || ' is waiting for your review.');
  return jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status);
end;
$$;

-- ── Visibility ────────────────────────────────────────────────────────────────────────────────
-- Either end in the caller's jurisdiction (rutf_scope_facility_ids, 0134).
create or replace function supply_request_can_see(r supply_requests)
returns boolean language sql stable security definer set search_path = public as $$
  select r.from_facility_id in (select rutf_scope_facility_ids()) or r.to_facility_id in (select rutf_scope_facility_ids());
$$;

create or replace function supply_request_list(p_box text default 'all', p_status text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.submitted_at desc), '[]'::jsonb) from (
    select r.id, r.code, r.level, r.status, r.submitted_at, r.decided_at, r.needed_by, r.resubmitted_count,
           r.from_facility_id, ff.name as from_name, fl.name as from_lga,
           r.to_facility_id, tf.name as to_name,
           (select sum(requested_qty) from supply_request_lines l where l.request_id = r.id) as requested_qty,
           (select sum(approved_qty) from supply_request_lines l where l.request_id = r.id) as approved_qty,
           (select coalesce(sum(sachets_issued), 0) from transfers t where t.supply_request_id = r.id) as dispatched_qty,
           (select max(created_at) from supply_request_events e where e.request_id = r.id) as last_activity,
           r.to_facility_id = current_facility_id() as i_review,
           r.from_facility_id = current_facility_id() as i_requested
    from supply_requests r
    join facilities ff on ff.id = r.from_facility_id
    join lgas fl on fl.id = ff.lga_id
    join facilities tf on tf.id = r.to_facility_id
    where supply_request_can_see(r)
      and (p_status is null or r.status = p_status)
      and case p_box when 'incoming' then r.to_facility_id = current_facility_id()
                     when 'outgoing' then r.from_facility_id = current_facility_id()
                     else true end
  ) x;
$$;

create or replace function supply_request_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r supply_requests; v_role text := current_user_role(); v_me uuid := current_facility_id();
begin
  select * into r from supply_requests where id = p_id;
  if not found or not supply_request_can_see(r) then raise exception 'Supply request not found'; end if;
  return jsonb_build_object(
    'request', to_jsonb(r) || jsonb_build_object(
      'from_name', (select name from facilities where id = r.from_facility_id),
      'from_lga', (select l.name from facilities f join lgas l on l.id = f.lga_id where f.id = r.from_facility_id),
      'to_name', (select name from facilities where id = r.to_facility_id),
      'requested_by_name', (select name from profiles where id = r.requested_by),
      'reviewed_by_name', (select name from profiles where id = r.reviewed_by)),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('product_id', l.product_id, 'product', pr.name, 'unit', pr.unit,
                'units_per_carton', pr.units_per_carton, 'balance_on_hand', l.balance_on_hand, 'consumed_30d', l.consumed_30d,
                'stockout_days', l.stockout_days, 'requested_qty', l.requested_qty, 'approved_qty', l.approved_qty) order by pr.name), '[]')
              from supply_request_lines l join products pr on pr.id = l.product_id where l.request_id = r.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'actor', p.name, 'actor_role', e.actor_role,
                'note', e.note, 'detail', e.detail, 'status_before', e.status_before, 'status_after', e.status_after, 'at', e.created_at)
                order by e.created_at), '[]')
               from supply_request_events e left join profiles p on p.id = e.actor where e.request_id = r.id),
    'transfers', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'issued_date', t.issued_date,
                'sachets_issued', t.sachets_issued, 'sachets_received', t.sachets_received, 'status', t.status) order by t.issued_date), '[]')
                  from transfers t where t.supply_request_id = r.id),
    'supplier_balance', case when v_me = r.to_facility_id or v_role <> 'dri' or rutf_officer_level() = 'state'
                             then ledger_balance(r.to_facility_id, null, current_date) end,
    'can', jsonb_build_object(
      'review', v_role = 'dri' and v_me = r.to_facility_id and r.status in ('submitted', 'under_review'),
      'respond', v_role = 'dri' and v_me = r.from_facility_id and r.status = 'queried',
      'cancel', v_role = 'dri' and v_me = r.from_facility_id and r.status in ('submitted', 'under_review', 'queried'),
      'comment', v_role in ('dri', 'state_coordinator', 'tpm_supervisor') and r.status not in ('received', 'cancelled', 'rejected'),
      'dispatch', v_role = 'dri' and v_me = r.to_facility_id and r.status in ('approved', 'partially_fulfilled')));
end;
$$;

-- ── Act on a request ──────────────────────────────────────────────────────────────────────────
-- p_action: start_review | query | approve | reject (the supplying store's officer);
--           respond | cancel (the requester); comment (either party, the State Coordinator, a Supervisor).
-- approve takes p_lines [{product_id, approved_qty}] (missing = the requested quantity);
-- respond may take p_lines [{product_id, requested_qty}] to change the quantities asked for.
create or replace function supply_request_act(p_id uuid, p_action text, p_note text default null, p_lines jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r supply_requests; v_role text := current_user_role(); v_me uuid := current_facility_id();
  v_before text; v_after text; v_detail jsonb; v_line record; v_from text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if current_account_status() is distinct from 'active' then raise exception 'Your account is inactive'; end if;
  select * into r from supply_requests where id = p_id for update;
  if not found or not supply_request_can_see(r) then raise exception 'Supply request not found'; end if;
  v_before := r.status;
  select name into v_from from facilities where id = r.from_facility_id;

  if p_action in ('start_review', 'query', 'approve', 'reject') then
    if not (v_role = 'dri' and v_me = r.to_facility_id) then
      raise exception 'Only the officer at the supplying store (%) reviews this request',
        case r.level when 'lga_to_state' then 'the State Nutrition Officer' else 'the LGA Nutrition Officer' end;
    end if;
    if r.status not in ('submitted', 'under_review') then raise exception 'This request is % — it cannot be reviewed now', r.status; end if;
  end if;

  if p_action = 'start_review' then
    if r.status = 'under_review' then return jsonb_build_object('status', r.status); end if;
    v_after := 'under_review';
  elsif p_action = 'query' then
    if coalesce(trim(p_note), '') = '' then raise exception 'Say what needs answering or correcting'; end if;
    v_after := 'queried';
    perform supply_request_notify(r, r.from_facility_id, 'Supply request ' || r.code || ' was queried: ' || left(trim(p_note), 140));
  elsif p_action = 'reject' then
    if coalesce(trim(p_note), '') = '' then raise exception 'Give the reason for rejecting the request'; end if;
    v_after := 'rejected';
    perform supply_request_notify(r, r.from_facility_id, 'Supply request ' || r.code || ' was rejected: ' || left(trim(p_note), 140));
  elsif p_action = 'approve' then
    v_detail := (select jsonb_agg(jsonb_build_object('product_id', product_id, 'requested_qty', requested_qty)) from supply_request_lines where request_id = r.id);
    update supply_request_lines l set approved_qty = coalesce(
      (select (x ->> 'approved_qty')::int from jsonb_array_elements(coalesce(p_lines, '[]')) x where (x ->> 'product_id')::uuid = l.product_id),
      l.requested_qty)
    where l.request_id = r.id;
    if exists (select 1 from supply_request_lines where request_id = r.id and approved_qty < 0) then raise exception 'Quantities cannot be negative'; end if;
    if not exists (select 1 from supply_request_lines where request_id = r.id and approved_qty > 0) then
      raise exception 'Approve at least one sachet, or reject the request instead';
    end if;
    if exists (select 1 from supply_request_lines where request_id = r.id and approved_qty <> requested_qty) and coalesce(trim(p_note), '') = '' then
      raise exception 'Give the reason for approving a different quantity';
    end if;
    v_detail := jsonb_build_object('requested', v_detail,
      'approved', (select jsonb_agg(jsonb_build_object('product_id', product_id, 'approved_qty', approved_qty)) from supply_request_lines where request_id = r.id));
    v_after := 'approved';
    perform supply_request_notify(r, r.from_facility_id, 'Supply request ' || r.code || ' was approved — '
      || (select sum(approved_qty) from supply_request_lines where request_id = r.id) || ' sachets. Dispatch follows.');
  elsif p_action = 'respond' then
    if not (v_role = 'dri' and v_me = r.from_facility_id) then raise exception 'Only the requester answers a query'; end if;
    if r.status <> 'queried' then raise exception 'This request is not queried'; end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'Write your answer to the query'; end if;
    if p_lines is not null then
      v_detail := jsonb_build_object('before', (select jsonb_agg(jsonb_build_object('product_id', product_id, 'requested_qty', requested_qty)) from supply_request_lines where request_id = r.id));
      for v_line in select * from jsonb_to_recordset(p_lines) as x(product_id uuid, requested_qty int) loop
        if coalesce(v_line.requested_qty, 0) <= 0 then raise exception 'Each commodity needs a quantity above zero'; end if;
        update supply_request_lines set requested_qty = v_line.requested_qty where request_id = r.id and product_id = v_line.product_id;
      end loop;
      v_detail := v_detail || jsonb_build_object('after', (select jsonb_agg(jsonb_build_object('product_id', product_id, 'requested_qty', requested_qty)) from supply_request_lines where request_id = r.id));
    end if;
    v_after := 'submitted';
    update supply_requests set resubmitted_count = resubmitted_count + 1 where id = r.id;
    perform supply_request_notify(r, r.to_facility_id, 'Supply request ' || r.code || ' from ' || v_from || ' was answered and resubmitted.');
  elsif p_action = 'cancel' then
    if not (v_role = 'dri' and v_me = r.from_facility_id) then raise exception 'Only the requester cancels a request'; end if;
    if r.status not in ('submitted', 'under_review', 'queried') then raise exception 'A request that has been decided cannot be cancelled'; end if;
    v_after := 'cancelled';
    perform supply_request_notify(r, r.to_facility_id, 'Supply request ' || r.code || ' from ' || v_from || ' was cancelled.');
  elsif p_action = 'comment' then
    if v_role not in ('dri', 'state_coordinator', 'tpm_supervisor') then raise exception 'Your role cannot comment on supply requests'; end if;
    if v_role = 'dri' and v_me not in (r.from_facility_id, r.to_facility_id) then raise exception 'Only the two stores, the State Coordinator and Supervisors comment'; end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'Write the comment'; end if;
    v_after := r.status;
    perform supply_request_notify(r, r.to_facility_id, rutf_role_title() || ' commented on supply request ' || r.code || '.');
    perform supply_request_notify(r, r.from_facility_id, rutf_role_title() || ' commented on supply request ' || r.code || '.');
  else
    raise exception 'Unknown action %', p_action;
  end if;

  update supply_requests set status = v_after,
    reviewed_by = case when p_action in ('start_review', 'query', 'approve', 'reject') then auth.uid() else reviewed_by end,
    decided_at = case when p_action in ('approve', 'reject') then now() else decided_at end,
    decision_note = case when p_action in ('approve', 'reject') then nullif(trim(p_note), '') else decision_note end
  where id = r.id;
  perform supply_request_log(r.id,
    case p_action when 'start_review' then 'review_started' when 'query' then 'queried' when 'approve' then 'approved'
                  when 'reject' then 'rejected' when 'respond' then 'responded' when 'cancel' then 'cancelled' else 'comment' end,
    p_note, v_detail, v_before, v_after);
  return jsonb_build_object('status', v_after);
end;
$$;

-- ── Dispatch and receipt follow the stock ledger ──────────────────────────────────────────────
-- A new transfer from the supplying store to the requester is linked to that pair's oldest
-- approved, not yet fully dispatched request; the request then shows what was sent.
create or replace function supply_request_link_transfer()
returns trigger language plpgsql security definer set search_path = public as $$
declare r supply_requests;
begin
  if NEW.supply_request_id is null then
    select * into r from supply_requests
    where from_facility_id = NEW.to_facility_id and to_facility_id = NEW.from_facility_id
      and status in ('approved', 'partially_fulfilled')
    order by decided_at limit 1;
    if found then NEW.supply_request_id := r.id; end if;
  end if;
  return NEW;
end;
$$;
create trigger transfers_link_supply_request before insert on transfers
  for each row execute function supply_request_link_transfer();

create or replace function supply_request_follow_transfer()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r supply_requests; v_sent int; v_approved int; v_after text; v_open int;
begin
  if NEW.supply_request_id is null then return NEW; end if;
  select * into r from supply_requests where id = NEW.supply_request_id for update;
  if TG_OP = 'INSERT' then
    select coalesce(sum(sachets_issued), 0) into v_sent from transfers where supply_request_id = r.id;
    select coalesce(sum(approved_qty), 0) into v_approved from supply_request_lines where request_id = r.id;
    v_after := case when v_sent >= v_approved then 'dispatched' else 'partially_fulfilled' end;
    update supply_requests set status = v_after where id = r.id;
    insert into supply_request_events (request_id, action, actor, actor_role, detail, status_before, status_after)
    values (r.id, 'dispatched', NEW.issued_by, coalesce(rutf_role_title(), 'Supplying store'),
            jsonb_build_object('transfer_code', NEW.code, 'sachets', NEW.sachets_issued, 'sent_total', v_sent, 'approved_total', v_approved),
            r.status, v_after);
    perform supply_request_notify(r, r.from_facility_id, 'Supply request ' || r.code || ': ' || NEW.sachets_issued
      || ' sachets dispatched on transfer ' || coalesce(NEW.code, '') || '. Record the receipt when they arrive.');
  elsif NEW.status is distinct from OLD.status and NEW.status in ('received', 'discrepancy') and r.status = 'dispatched' then
    select count(*) into v_open from transfers where supply_request_id = r.id and status = 'in_transit';
    if v_open = 0 then
      update supply_requests set status = 'received' where id = r.id;
      insert into supply_request_events (request_id, action, actor, actor_role, detail, status_before, status_after)
      values (r.id, 'received', NEW.received_by, coalesce(rutf_role_title(), 'Requesting facility'),
              jsonb_build_object('transfer_code', NEW.code, 'sachets_received', NEW.sachets_received, 'discrepancy', NEW.status = 'discrepancy'),
              r.status, 'received');
      perform supply_request_notify(r, r.to_facility_id, 'Supply request ' || r.code || ' was received'
        || case when NEW.status = 'discrepancy' then ' with a discrepancy.' else '.' end);
    end if;
  end if;
  return NEW;
end;
$$;
create trigger transfers_follow_supply_request after insert or update of status on transfers
  for each row execute function supply_request_follow_transfer();

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────
revoke execute on function rutf_role_title(), rutf_facility_officers(uuid), supply_request_notify(supply_requests, uuid, text),
  supply_request_log(uuid, text, text, jsonb, text, text), supply_request_form(), supply_request_create(jsonb),
  supply_request_can_see(supply_requests), supply_request_list(text, text), supply_request_get(uuid),
  supply_request_act(uuid, text, text, jsonb), supply_request_link_transfer(), supply_request_follow_transfer() from public, anon;
revoke execute on function rutf_facility_officers(uuid), supply_request_notify(supply_requests, uuid, text),
  supply_request_log(uuid, text, text, jsonb, text, text), supply_request_can_see(supply_requests),
  supply_request_link_transfer(), supply_request_follow_transfer() from authenticated;
grant execute on function rutf_role_title(), supply_request_form(), supply_request_create(jsonb), supply_request_list(text, text),
  supply_request_get(uuid), supply_request_act(uuid, text, text, jsonb) to authenticated;
