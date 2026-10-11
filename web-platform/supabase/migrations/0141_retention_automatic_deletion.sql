-- RUTF Monitoring Platform — migration 0141: automatic deletion when retention ends
-- (DECISIONS R177; DPIA §8 and risk R9, go-live checklist item 5)
-- The DPIA's proposed retention periods, as rules a daily job applies (02:00 Lagos):
--   child_identity   the child's and caregiver's identifying details, 2 years after the last
--                    discharge — the Child ID and the clinical record stay, no longer identifiable
--   otp_rutf_photos  RUTF photos, 1 year after the visit
--   otp_access_log   who opened which child's card, 2 years
--   evidence_photos  waybills, stock cards, register pages, stock photos, 2 years
--   selfies          supervision-visit selfies and the attendance photos kept from before their
--                    removal, 90 days
--   sync_failures    sync error messages, 180 days after they were resolved
-- The periods are the DPIA's proposals, for the Data Protection Officer to approve (after the
-- contract award); the Super Admin sees each rule on Data Retention and may set it to "report
-- only" or off. Database rows go at once; photo files are queued and deleted through the Storage
-- API (deleting the storage row alone would leave the file in the bucket), using the service key
-- stored in Vault by tools/db/set-storage-key.js — until it is stored, files wait in the queue.
-- Every run is recorded (what went, how many) — never the deleted values.

create table retention_rules (
  key text primary key,
  label text not null,
  data text not null,               -- what it covers, in words
  keep_days int not null check (keep_days > 0),
  basis text not null,              -- the date the period runs from
  mode text not null default 'delete' check (mode in ('delete', 'report', 'off')),
  dpo_approved boolean not null default false,
  sort int not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
insert into retention_rules (key, label, data, keep_days, basis, sort) values
  ('child_identity', 'Child''s and caregiver''s identifying details', 'Names, address and mobile number on the OTP Admission Card (the Child ID and the clinical record stay)', 730, 'the last discharge', 1),
  ('otp_rutf_photos', 'RUTF photos', 'Photos of the RUTF given at OTP visits', 365, 'the visit', 2),
  ('otp_access_log', 'Child-record access log', 'Who opened, registered or transferred which child''s card', 730, 'the access', 3),
  ('evidence_photos', 'Stock and supervision evidence photos', 'Waybills, stock cards, register pages and stock photos', 730, 'the upload', 4),
  ('selfies', 'Selfies', 'Supervision-visit selfies and attendance photos from before their removal', 90, 'the upload', 5),
  ('sync_failures', 'Sync error messages', 'Error messages from the app''s offline sync', 180, 'the error being resolved', 6);

create table retention_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  dry_run boolean not null,
  started_by uuid references profiles(id),     -- null = the daily job
  results jsonb not null                       -- per rule: mode, rows deleted (or due), files queued
);

create table retention_file_queue (
  id bigint generated always as identity primary key,
  bucket text not null,
  path text not null,
  rule text not null,
  queued_at timestamptz not null default now(),
  request_id bigint,                           -- the pg_net request deleting it
  attempts int not null default 0,
  deleted_at timestamptz,
  last_error text,
  unique (bucket, path)
);

alter table otp_children add column if not exists identity_removed_on date;
comment on column otp_children.identity_removed_on is 'When the identifying details were deleted at the end of retention (R177).';

do $$
declare t text;
begin
  foreach t in array array['retention_rules', 'retention_runs', 'retention_file_queue'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
  end loop;
end $$;
create trigger retention_rules_audit after insert or update or delete on retention_rules for each row execute function audit_row_change();

-- ── What is due under each rule ───────────────────────────────────────────────────────────────
-- Rows of each kind past their period (counts only; the run below uses the same conditions).
create or replace function retention_due()
returns table (key text, due_rows bigint, due_files bigint)
language sql stable security definer set search_path = public as $$
  with r as (select key, keep_days from retention_rules)
  select 'child_identity', count(*), 0::bigint from otp_child_identity i join otp_children c on c.id = i.child_id
   where not exists (select 1 from otp_admissions a where a.child_id = c.id and a.status = 'active')
     and (select max(outcome_on) from otp_admissions a where a.child_id = c.id) < current_date - (select keep_days from r where key = 'child_identity')
  union all
  select 'otp_rutf_photos', count(*), count(*) from otp_visit_photos p join otp_visits v on v.id = p.visit_id
   where v.visit_on < current_date - (select keep_days from r where key = 'otp_rutf_photos')
  union all
  select 'otp_access_log', count(*), 0 from otp_access_log where at < now() - make_interval(days => (select keep_days from r where key = 'otp_access_log'))
  union all
  select 'evidence_photos', count(*), count(*) from (
    select uploaded_at from ledger_photos
    union all select uploaded_at from visit_photos where kind <> 'selfie') x
   where uploaded_at < now() - make_interval(days => (select keep_days from r where key = 'evidence_photos'))
  union all
  select 'selfies', count(*), coalesce(sum(n), 0)::bigint from (
    select uploaded_at as ts, 1 as n from visit_photos where kind = 'selfie'
    union all select created_at, (selfie_storage_path is not null)::int + (assignment_location_storage_path is not null)::int
      from field_monitor_attendance where selfie_storage_path is not null or assignment_location_storage_path is not null) x
   where ts < now() - make_interval(days => (select keep_days from r where key = 'selfies'))
  union all
  select 'sync_failures', count(*), 0 from sync_failures where resolved_at < now() - make_interval(days => (select keep_days from r where key = 'sync_failures'));
$$;

-- ── Deleting photo files through the Storage API ──────────────────────────────────────────────
-- Settles finished requests, then sends up to 100 paths per bucket per call. Needs the Vault
-- secrets retention_supabase_url and retention_service_key (tools/db/set-storage-key.js).
create or replace function retention_delete_files()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_url text; v_key text; b record; v_req bigint; v_sent int := 0; v_done int; v_failed int;
begin
  -- Finished requests: 200 = gone; anything else = retry later.
  with res as (
    select q.id, r.status_code, r.error_msg from retention_file_queue q join net._http_response r on r.id = q.request_id
    where q.deleted_at is null and q.request_id is not null
  ), ok as (
    update retention_file_queue q set deleted_at = now(), last_error = null from res where res.id = q.id and res.status_code = 200 returning q.id
  ), bad as (
    update retention_file_queue q set request_id = null, last_error = coalesce(res.error_msg, 'HTTP ' || res.status_code)
    from res where res.id = q.id and coalesce(res.status_code, 0) <> 200 returning q.id
  )
  select (select count(*) from ok), (select count(*) from bad) into v_done, v_failed;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'retention_supabase_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'retention_service_key';
  if v_url is null or v_key is null then
    return jsonb_build_object('sent', 0, 'confirmed', v_done, 'failed', v_failed,
      'waiting', (select count(*) from retention_file_queue where deleted_at is null),
      'note', 'The storage key is not stored yet (tools/db/set-storage-key.js): files wait in the queue');
  end if;
  for b in
    select bucket, array_agg(id) ids, jsonb_agg(path) paths from (
      select id, bucket, path, row_number() over (partition by bucket order by id) rn
      from retention_file_queue where deleted_at is null and request_id is null and attempts < 10) x
    where rn <= 100 group by bucket
  loop
    v_req := net.http_delete(
      url := rtrim(v_url, '/') || '/storage/v1/object/' || b.bucket,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'apikey', v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object('prefixes', b.paths),
      timeout_milliseconds := 30000);
    update retention_file_queue set request_id = v_req, attempts = attempts + 1 where id = any(b.ids);
    v_sent := v_sent + cardinality(b.ids);
  end loop;
  return jsonb_build_object('sent', v_sent, 'confirmed', v_done, 'failed', v_failed,
    'waiting', (select count(*) from retention_file_queue where deleted_at is null));
end;
$$;

-- ── The run ───────────────────────────────────────────────────────────────────────────────────
-- p_dry_run: count only. Rules in "report" mode are counted, "off" skipped, "delete" applied.
-- The daily job calls it with no user; a Super Admin may run or preview it.
create or replace function retention_run(p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rr retention_rules; v_out jsonb := '{}'::jsonb; v_n bigint; v_files bigint; v_apply boolean; d record; v_cut date; v_cutts timestamptz;
begin
  if auth.uid() is not null and not is_super_admin() then raise exception 'Only the Super Admin runs data retention'; end if;
  for rr in select * from retention_rules order by sort loop
    select due_rows, due_files into d from retention_due() x where x.key = rr.key;
    v_apply := rr.mode = 'delete' and not p_dry_run;
    v_n := 0; v_files := 0;
    v_cut := current_date - rr.keep_days;
    v_cutts := now() - make_interval(days => rr.keep_days);
    if v_apply and coalesce(d.due_rows, 0) > 0 then
      if rr.key = 'child_identity' then
        with gone as (
          delete from otp_child_identity i using otp_children c
          where c.id = i.child_id
            and not exists (select 1 from otp_admissions a where a.child_id = c.id and a.status = 'active')
            and (select max(outcome_on) from otp_admissions a where a.child_id = c.id) < v_cut
          returning i.child_id)
        update otp_children set identity_removed_on = current_date where id in (select child_id from gone);
        get diagnostics v_n = row_count;
      elsif rr.key = 'otp_rutf_photos' then
        with gone as (
          delete from otp_visit_photos p using otp_visits v where v.id = p.visit_id and v.visit_on < v_cut returning p.storage_path)
        insert into retention_file_queue (bucket, path, rule) select 'otp-rutf-evidence', storage_path, rr.key from gone on conflict do nothing;
        get diagnostics v_files = row_count; v_n := v_files;
      elsif rr.key = 'otp_access_log' then
        delete from otp_access_log where at < v_cutts;
        get diagnostics v_n = row_count;
      elsif rr.key = 'evidence_photos' then
        with g1 as (delete from ledger_photos where uploaded_at < v_cutts returning storage_path),
             g2 as (delete from visit_photos where kind <> 'selfie' and uploaded_at < v_cutts returning storage_path)
        insert into retention_file_queue (bucket, path, rule)
        select 'ledger-evidence', storage_path, rr.key from g1 union all select 'visit-evidence', storage_path, rr.key from g2
        on conflict do nothing;
        get diagnostics v_files = row_count; v_n := v_files;
      elsif rr.key = 'selfies' then
        with g1 as (delete from visit_photos where kind = 'selfie' and uploaded_at < v_cutts returning storage_path)
        insert into retention_file_queue (bucket, path, rule) select 'visit-evidence', storage_path, rr.key from g1 on conflict do nothing;
        get diagnostics v_files = row_count;
        with g2 as (
          update field_monitor_attendance a set selfie_storage_path = null, assignment_location_storage_path = null
          from (select id, selfie_storage_path s, assignment_location_storage_path l from field_monitor_attendance
                where created_at < v_cutts and (selfie_storage_path is not null or assignment_location_storage_path is not null)) o
          where a.id = o.id returning o.s, o.l)
        insert into retention_file_queue (bucket, path, rule)
        select 'attendance-evidence', p, rr.key from g2, unnest(array[g2.s, g2.l]) p where p is not null on conflict do nothing;
        get diagnostics v_n = row_count; v_files := v_files + v_n; v_n := v_files;
      elsif rr.key = 'sync_failures' then
        delete from sync_failures where resolved_at < v_cutts;
        get diagnostics v_n = row_count;
      end if;
    end if;
    v_out := v_out || jsonb_build_object(rr.key, jsonb_build_object('mode', rr.mode, 'keep_days', rr.keep_days,
      'due', coalesce(d.due_rows, 0), 'deleted', v_n, 'files_queued', v_files));
  end loop;
  if not p_dry_run then v_out := v_out || jsonb_build_object('files', retention_delete_files()); end if;
  insert into retention_runs (dry_run, started_by, results) values (p_dry_run, auth.uid(), v_out);
  return v_out;
end;
$$;

-- ── The Super Admin's view and settings ───────────────────────────────────────────────────────
create or replace function retention_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_super_admin() then raise exception 'Only the Super Admin sees data retention'; end if;
  return jsonb_build_object(
    'rules', (select jsonb_agg(jsonb_build_object('key', r.key, 'label', r.label, 'data', r.data, 'keep_days', r.keep_days, 'basis', r.basis,
                'mode', r.mode, 'dpo_approved', r.dpo_approved, 'due_rows', d.due_rows, 'due_files', d.due_files,
                'updated_by', (select name from profiles where id = r.updated_by), 'updated_at', r.updated_at) order by r.sort)
              from retention_rules r left join retention_due() d on d.key = r.key),
    'runs', (select coalesce(jsonb_agg(jsonb_build_object('ran_at', ran_at, 'dry_run', dry_run, 'by', (select name from profiles where id = started_by),
                'results', results) order by ran_at desc), '[]') from (select * from retention_runs order by ran_at desc limit 10) x),
    'files', jsonb_build_object('waiting', (select count(*) from retention_file_queue where deleted_at is null),
                                'deleted', (select count(*) from retention_file_queue where deleted_at is not null),
                                'failing', (select count(*) from retention_file_queue where deleted_at is null and attempts >= 3),
                                'key_stored', exists (select 1 from vault.secrets where name = 'retention_service_key')),
    'schedule', 'Daily at 02:00 (Lagos)');
end;
$$;

create or replace function retention_set_mode(p_key text, p_mode text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_super_admin() then raise exception 'Only the Super Admin changes data retention'; end if;
  if p_mode not in ('delete', 'report', 'off') then raise exception 'Mode is delete, report or off'; end if;
  update retention_rules set mode = p_mode, updated_by = auth.uid(), updated_at = now() where key = p_key;
  if not found then raise exception 'Unknown retention rule'; end if;
end;
$$;

revoke execute on function retention_due(), retention_delete_files() from public, anon, authenticated;
revoke execute on function retention_run(boolean), retention_overview(), retention_set_mode(text, text) from public, anon;
grant execute on function retention_run(boolean), retention_overview(), retention_set_mode(text, text) to authenticated;

-- 02:00 Lagos = 01:00 UTC.
select cron.schedule('rutf-retention', '0 1 * * *', 'select public.retention_run(false)');
