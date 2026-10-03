-- RUTF Monitoring Platform — migration 0108 (brief §10, milestone M6 pilot hardening)
-- 1. ledger_balance() runs with the caller's rights, so it can't read another facility's stock.
-- 2. DECISIONS R27 closed: a facility user reads incoming transfer lines through
--    incoming_transfer_lines() instead of a read policy on the supplier's ledger rows.
-- 3. Audit trail for reference data, user access and ledger status changes (audit_log).
-- 4. Sync-failure monitoring: devices report their queue after every sync run
--    (report_sync_status); sync_health() and a morning digest for administrators.
-- 5. Function grants (last, so they cover the functions above): nothing is callable signed out;
--    internal helpers are not callable at all.

-- ── 1. ledger_balance with the caller's rights ──────────────────────────────────────────────────
-- Inside record_* / evaluate_* (SECURITY DEFINER) it still sees the whole ledger; called by a
-- user it sees only the rows their read policy allows.
create or replace function ledger_balance(p_facility_id uuid, p_lot_id uuid, p_as_of date)
returns int language sql stable security invoker set search_path = public as $$
  select coalesce(sum(ledger_signed_quantity(txn_type, quantity_sachets)), 0)::int
  from stock_transactions
  where facility_id = p_facility_id
    and status <> 'voided'
    and txn_date <= p_as_of
    and (p_lot_id is null or lot_id = p_lot_id);
$$;

-- ── 2. Incoming transfer lines (closes DECISIONS R27) ───────────────────────────────────────────
-- The lines the supplier issued on transfers still in transit to this facility — what Receive
-- Stock pre-fills. Its own facility user, anyone with that facility's project in scope, or Super Admin.
create or replace function incoming_transfer_lines(p_facility_id uuid)
returns table (transfer_id uuid, lot_id uuid, quantity_sachets int, local_id text)
language sql stable security definer set search_path = public as $$
  select t.transfer_id, t.lot_id, t.quantity_sachets, t.local_id
  from stock_transactions t
  join transfers tr on tr.id = t.transfer_id
  join facilities f on f.id = tr.to_facility_id
  where tr.to_facility_id = p_facility_id and tr.status = 'in_transit'
    and t.txn_type = 'issue' and t.status <> 'voided'
    and current_account_status() = 'active'
    and case when current_user_role() = 'dri' then current_facility_id() = p_facility_id
             else in_scope(f.project_id) end
  order by t.transfer_id, t.local_id;
$$;
grant execute on function incoming_transfer_lines(uuid) to authenticated;

drop policy if exists stock_transactions_select on stock_transactions;
create policy stock_transactions_select on stock_transactions for select to authenticated
  using (case when (select current_user_role()) = 'dri'
              then facility_id = (select current_facility_id())
              else (select is_super_admin()) or (select current_project_id()) is null or project_id = (select current_project_id()) end);

-- ── 3. Audit trail (brief §10: every create/edit/void recorded) ─────────────────────────────────
-- The ledger itself is append-only (rows carry recorded_by / device / local_id); this records the
-- changes around it: reference data, who may see and record what, and ledger/transfer status changes.
create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,                               -- auth.uid(); null = platform (nightly job, import)
  table_name text not null,
  row_id text,
  action text not null check (action in ('insert', 'update', 'delete')),
  changes jsonb not null,                   -- insert: new row; delete: old row; update: {col: [old, new]}
  project_id uuid
);
create index audit_log_table_row_idx on audit_log(table_name, row_id, at desc);
create index audit_log_at_idx on audit_log(at desc);
alter table audit_log enable row level security;
create policy audit_log_select on audit_log for select to authenticated
  using ((select current_user_role()) in ('super_admin', 'project_admin') and (select in_scope(project_id)));

create or replace function audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb;
  k text;
begin
  if tg_op = 'UPDATE' then
    v_changes := '{}'::jsonb;
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at', 'last_login', 'geom') and (v_old -> k) is distinct from (v_new -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old -> k, v_new -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return null; end if;
  else
    v_changes := v_row - 'geom';
  end if;
  insert into audit_log (actor, table_name, row_id, action, changes, project_id)
  values (auth.uid(), tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'profile_id', v_row ->> 'key'),
          lower(tg_op), v_changes, nullif(v_row ->> 'project_id', '')::uuid);
  return null;
end;
$$;
revoke execute on function audit_row_change() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['facilities', 'product_lots', 'protocol_rules', 'rutf_thresholds', 'profiles',
                           'supervisor_lgas', 'dhis2_reports'] loop
    execute format('drop trigger if exists %1$s_audit on %1$s', t);
    execute format('create trigger %1$s_audit after insert or update or delete on %1$s
                    for each row execute function audit_row_change()', t);
  end loop;
  -- Ledger rows and transfers are inserted by the record_* functions (already traceable to the
  -- submission); only later changes — confirmation, voiding, settlement — are logged.
  foreach t in array array['stock_transactions', 'transfers'] loop
    execute format('drop trigger if exists %1$s_audit on %1$s', t);
    execute format('create trigger %1$s_audit after update or delete on %1$s
                    for each row execute function audit_row_change()', t);
  end loop;
end $$;

-- ── 4. Sync-failure monitoring ──────────────────────────────────────────────────────────────────
insert into rutf_thresholds (project_id, key, value, note)
select p.id, 'sync_stale_days', 3, 'Days without a sync report before a device is shown as not syncing'
from projects p where p.name = 'Katsina RUTF Pilot'
on conflict (project_id, key) do nothing;

-- One row per device and user, replaced by every report.
create table device_sync_status (
  device_id text not null,
  profile_id uuid not null references profiles(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  facility_id uuid references facilities(id) on delete set null,
  app_version text,
  device_model text,
  os_version text,
  last_report_at timestamptz not null default now(),
  last_success_at timestamptz,             -- last run that left nothing failed
  pending_count int not null default 0,
  failed_count int not null default 0,
  oldest_pending_at timestamptz,
  last_error text,
  primary key (device_id, profile_id)
);
create index device_sync_status_profile_idx on device_sync_status(profile_id);

-- Submissions that failed to sync, until they go through (resolved_at).
create table sync_failures (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  profile_id uuid not null references profiles(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  local_id text not null,
  submission_type text,
  error text,
  attempts int not null default 0,
  queued_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (profile_id, local_id)
);
create index sync_failures_open_idx on sync_failures(project_id) where resolved_at is null;

alter table device_sync_status enable row level security;
alter table sync_failures enable row level security;
create policy device_sync_status_select on device_sync_status for select to authenticated
  using (profile_id = (select auth.uid())
         or ((select current_user_role()) in ('super_admin', 'project_admin', 'state_coordinator') and (select in_scope(project_id))));
create policy sync_failures_select on sync_failures for select to authenticated
  using (profile_id = (select auth.uid())
         or ((select current_user_role()) in ('super_admin', 'project_admin', 'state_coordinator') and (select in_scope(project_id))));

-- Called by the app at the end of every sync run. p_failures: the queue items that have failed at
-- least once and are still waiting, [{local_id, type, error, attempts, queued_at}] (max 50 kept);
-- any earlier open failure from this device that is no longer listed has gone through.
-- Error text is cut to 300 characters; the app sends no submission content.
create or replace function report_sync_status(
  p_device_id text, p_app_version text, p_device_model text, p_os_version text,
  p_pending int, p_failed int, p_oldest_pending timestamptz, p_failures jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me profiles;
  f jsonb;
  v_ids text[] := '{}';
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null then raise exception 'Sign in required'; end if;
  if me.status <> 'active' then raise exception 'Your account is inactive'; end if;
  if coalesce(trim(p_device_id), '') = '' then raise exception 'Device id required'; end if;

  insert into device_sync_status as d (device_id, profile_id, project_id, facility_id, app_version, device_model, os_version,
                                       last_report_at, last_success_at, pending_count, failed_count, oldest_pending_at, last_error)
  values (left(p_device_id, 100), me.id, me.project_id, me.facility_id, left(p_app_version, 40), left(p_device_model, 80),
          left(p_os_version, 40), now(), case when coalesce(p_failed, 0) = 0 then now() end, greatest(coalesce(p_pending, 0), 0),
          greatest(coalesce(p_failed, 0), 0), p_oldest_pending,
          left((select e ->> 'error' from jsonb_array_elements(coalesce(p_failures, '[]')) e limit 1), 300))
  on conflict (device_id, profile_id) do update set
    project_id = excluded.project_id, facility_id = excluded.facility_id, app_version = excluded.app_version,
    device_model = excluded.device_model, os_version = excluded.os_version, last_report_at = now(),
    last_success_at = coalesce(excluded.last_success_at, d.last_success_at),
    pending_count = excluded.pending_count, failed_count = excluded.failed_count,
    oldest_pending_at = excluded.oldest_pending_at, last_error = coalesce(excluded.last_error, d.last_error);

  for f in select * from jsonb_array_elements(coalesce(p_failures, '[]')) limit 50 loop
    continue when coalesce(f ->> 'local_id', '') = '';
    v_ids := v_ids || left(f ->> 'local_id', 100);
    insert into sync_failures as s (device_id, profile_id, project_id, local_id, submission_type, error, attempts, queued_at)
    values (left(p_device_id, 100), me.id, me.project_id, left(f ->> 'local_id', 100), left(f ->> 'type', 40),
            left(f ->> 'error', 300), coalesce((f ->> 'attempts')::int, 1), (f ->> 'queued_at')::timestamptz)
    on conflict (profile_id, local_id) do update set
      device_id = excluded.device_id, error = coalesce(excluded.error, s.error), attempts = excluded.attempts,
      last_seen_at = now(), resolved_at = null;
  end loop;

  update sync_failures set resolved_at = now()
  where profile_id = me.id and device_id = left(p_device_id, 100) and resolved_at is null and not (local_id = any(v_ids));

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function report_sync_status(text, text, text, text, int, int, timestamptz, jsonb) to authenticated;

-- Everyone who records on a device — facility users and supervisors — with their latest report
-- and a status: failing (a submission keeps failing), stuck (waiting > 1 day), not_syncing (no
-- report for sync_stale_days), no_report (recording, but from an app version that doesn't report),
-- never (nothing recorded or reported yet), ok.
create or replace function sync_health_internal(p_project_id uuid default null)
returns table (profile_id uuid, name text, role user_role, project_id uuid, facility_id uuid, facility_name text, lga_id uuid,
               device_id text, app_version text, device_model text, last_report_at timestamptz, last_success_at timestamptz,
               last_submission_at timestamptz, pending_count int, failed_count int, oldest_pending_at timestamptz,
               last_error text, open_failures int, status text)
language sql stable security definer set search_path = public as $$
  with people as (
    select p.id, p.name, p.role, p.project_id, p.facility_id
    from profiles p
    where p.status = 'active' and (p.role = 'tpm_supervisor' or (p.role = 'dri' and p.facility_id is not null))
      and (p_project_id is null or p.project_id = p_project_id)
  ),
  latest as (
    select distinct on (d.profile_id) d.* from device_sync_status d order by d.profile_id, d.last_report_at desc
  ),
  submitted as (
    select x.who, max(x.at) as at from (
      select recorded_by as who, created_at as at from ledger_submissions
      union all select supervisor_id, created_at from monitoring_visits
    ) x group by x.who
  ),
  open_f as (
    select s.profile_id, count(*)::int as n from sync_failures s where s.resolved_at is null group by s.profile_id
  )
  select pe.id, pe.name, pe.role, pe.project_id, pe.facility_id, f.name, f.lga_id,
         l.device_id, l.app_version, l.device_model, l.last_report_at, l.last_success_at, su.at,
         coalesce(l.pending_count, 0), coalesce(l.failed_count, 0), l.oldest_pending_at, l.last_error, coalesce(o.n, 0),
         case
           when coalesce(l.failed_count, 0) > 0 or coalesce(o.n, 0) > 0 then 'failing'
           when l.pending_count > 0 and l.oldest_pending_at < now() - interval '1 day' then 'stuck'
           when l.last_report_at < now() - make_interval(days => rutf_threshold(pe.project_id, 'sync_stale_days', 3)::int) then 'not_syncing'
           when l.device_id is null and su.at is not null then 'no_report'
           when l.device_id is null then 'never'
           else 'ok'
         end
  from people pe
  left join facilities f on f.id = pe.facility_id
  left join latest l on l.profile_id = pe.id
  left join submitted su on su.who = pe.id
  left join open_f o on o.profile_id = pe.id;
$$;
revoke execute on function sync_health_internal(uuid) from public, anon, authenticated;

create or replace function sync_health()
returns table (profile_id uuid, name text, role user_role, project_id uuid, facility_id uuid, facility_name text, lga_id uuid,
               device_id text, app_version text, device_model text, last_report_at timestamptz, last_success_at timestamptz,
               last_submission_at timestamptz, pending_count int, failed_count int, oldest_pending_at timestamptz,
               last_error text, open_failures int, status text)
language sql stable security definer set search_path = public as $$
  select h.* from sync_health_internal() h
  where current_account_status() = 'active'
    and current_user_role() in ('super_admin', 'project_admin', 'state_coordinator')
    and in_scope(h.project_id);
$$;

-- Morning digest (06:00 UTC = 07:00 WAT): one in-app notification per project admin (and Super
-- Admin) when devices in their scope are failing, stuck or not syncing; not repeated while an
-- earlier alert from the same day is still unread. No email — neutral, operational wording.
create or replace function notify_sync_problems()
returns int language plpgsql security definer set search_path = public as $$
declare
  a record;
  v_n int;
  v_sent int := 0;
begin
  for a in select p.id, p.role, p.project_id from profiles p
           where p.status = 'active' and p.role in ('super_admin', 'project_admin') loop
    select count(*) into v_n from sync_health_internal(case when a.role = 'super_admin' then null else a.project_id end) h
    where h.status in ('failing', 'stuck', 'not_syncing');
    continue when v_n = 0;
    continue when exists (select 1 from notifications n where n.user_id = a.id and n.type = 'sync_alert'
                          and not n.read and n.created_at > now() - interval '20 hours');
    insert into notifications (user_id, type, text, link)
    values (a.id, 'sync_alert',
            v_n || case when v_n = 1 then ' device user has' else ' device users have' end
              || ' records waiting to sync or have not synced recently. See Devices & Sync.',
            '/devices');
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;
revoke execute on function notify_sync_problems() from public, anon, authenticated;

select cron.schedule('rutf-sync-digest', '0 6 * * *', 'select public.notify_sync_problems()');

-- ── 4b. create_notification only from the review workflow ─────────────────────────────────────
-- It writes a notification and sends an email to any user, so a signed-in user calling it
-- directly through the API could send arbitrary text and links from the platform. The seven
-- review RPCs that call it run with the caller's rights, so it stays executable, but a call
-- made with the API roles must come from one of them. Text in the email is HTML-escaped.
create or replace function create_notification(p_user_id uuid, p_type text, p_text text, p_link text, p_issue_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_api_key text;
  v_subject text;
  v_ctx text;
begin
  if coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon') then
    get diagnostics v_ctx = pg_context;
    if v_ctx !~ '(approve_and_assign_finding|assign_issue|create_download_request|decide_download_request|record_corrective_action|reject_and_reopen_issue|return_finding_for_correction)\(' then
      raise exception 'create_notification can only be called by the platform';
    end if;
  end if;

  insert into notifications (user_id, type, text, link, issue_id)
  values (p_user_id, p_type, p_text, p_link, p_issue_id);

  begin
    select u.email into v_email from auth.users u where u.id = p_user_id;
    if v_email is null then
      return;
    end if;

    select decrypted_secret into v_api_key
      from vault.decrypted_secrets where name = 'resend_api_key';
    if v_api_key is null then
      return;
    end if;

    v_subject := case p_type
      when 'assignment' then 'New finding assigned to you'
      when 'resolved' then 'Your reported finding was resolved — awaiting your verification'
      when 'reopened' then 'A finding was reopened and needs your attention'
      when 'returned' then 'A finding you submitted was returned for correction'
      else 'RUTF-DTAP Monitoring Platform notification'
    end;

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_api_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'from', 'RUTF-DTAP Monitoring Platform <onboarding@resend.dev>',
        'to', jsonb_build_array(v_email),
        'subject', v_subject,
        'html',
          '<p>' || replace(replace(replace(p_text, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>' ||
          case when p_link is not null and p_link ~ '^/[A-Za-z0-9/_?=&.-]*$'
            then '<p><a href="https://tpm-monitoring-platform.vercel.app' || p_link || '">View in the platform</a></p>'
            else ''
          end
      ),
      timeout_milliseconds := 8000
    );
  exception when others then
    null;
  end;
end;
$$;

-- ── 5. Function grants (permissions review, tools/db/audit-permissions.js) ───────────────────────
-- Supabase grants EXECUTE on every new public function to anon and authenticated. Take it back
-- from anon (no RUTF screen works signed out), and from everyone for internal functions: those
-- run only inside SECURITY DEFINER code or triggers, which execute as the owner.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, p.prorettype::regtype::text as rt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    where n.nspname = 'public' and d.objid is null
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.rt in ('trigger', 'event_trigger')
       or f.proname in ('generate_issue_id', 'notify_sync_problems')
       or f.proname like '%\_internal' then
      execute format('revoke execute on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
alter default privileges in schema public revoke execute on functions from public, anon;
