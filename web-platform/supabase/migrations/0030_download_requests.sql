-- TPM Monitoring Platform — schema migration 30
-- Viewer download-request & Super Admin approval workflow. A Viewer's
-- export/download never runs directly (see the role check added to
-- app/(app)/issues/export/route.ts in this same change) — it creates a row
-- here instead, a Super Admin approves or rejects it, and only then can the
-- same Viewer fetch the file. resource_type is deliberately generic (only
-- 'issues_export' is wired today) so a future export can reuse this table.

create type download_request_status as enum ('pending', 'approved', 'rejected', 'fulfilled');

create table download_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles(id) on delete cascade,
  project_id uuid references projects(id),
  resource_type text not null,
  format text not null,
  filters jsonb not null default '{}'::jsonb,
  reason text,
  status download_request_status not null default 'pending',
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  review_note text,
  download_token uuid,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now()
);
create index download_requests_requester_idx on download_requests(requester_id, created_at desc);
create index download_requests_status_idx on download_requests(status, created_at desc);

alter table download_requests enable row level security;

-- Requester sees their own history; Super Admin sees (and reviews) every request.
create policy download_requests_select on download_requests for select to authenticated
  using (requester_id = auth.uid() or is_super_admin());

-- Row creation always goes through create_download_request() below (so notifying every Super
-- Admin happens atomically with the insert) — this policy just backstops that RPC's own auth.
create policy download_requests_insert on download_requests for insert to authenticated
  with check (requester_id = auth.uid());

-- Only a Super Admin may decide (or later mark fulfilled) a request — see decide_download_request()
-- and the fulfil step in the download route/action, both SECURITY INVOKER and thus bound by this.
create policy download_requests_update on download_requests for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- ── RPCs — SECURITY INVOKER (default): run as the caller, subject to the RLS above ─────────────

create or replace function create_download_request(
  p_resource_type text, p_format text, p_filters jsonb, p_reason text default null
) returns download_requests language plpgsql as $$
declare
  v_request download_requests;
  v_admin record;
begin
  insert into download_requests (requester_id, project_id, resource_type, format, filters, reason)
  values (auth.uid(), current_project_id(), p_resource_type, p_format, coalesce(p_filters, '{}'::jsonb), p_reason)
  returning * into v_request;

  for v_admin in select id from profiles where role = 'super_admin' loop
    perform create_notification(v_admin.id, 'download_request',
      coalesce(my_name(), 'A viewer') || ' requested a ' || p_resource_type || ' download',
      '/download-requests', null);
  end loop;

  return v_request;
end;
$$;

create or replace function decide_download_request(p_request_id uuid, p_approve boolean, p_note text default null)
returns download_requests language plpgsql as $$
declare
  v_request download_requests;
begin
  update download_requests set
    status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_note = p_note,
    download_token = case when p_approve then gen_random_uuid() else download_token end
  where id = p_request_id and status = 'pending'
  returning * into v_request;

  if not found then
    raise exception 'Request not found or already decided';
  end if;

  perform create_notification(v_request.requester_id,
    case when p_approve then 'download_request_approved' else 'download_request_rejected' end,
    'Your download request was ' || (case when p_approve then 'approved' else 'rejected' end),
    '/download-requests', null);

  return v_request;
end;
$$;

-- SECURITY DEFINER, not INVOKER: the requester (a Viewer) has no UPDATE policy on this table
-- (only a Super Admin does — see download_requests_update above), so marking their own request
-- fulfilled needs to step outside RLS. Every branch of the WHERE clause below re-derives the same
-- ownership/status/token check the SELECT in fetchApprovedDownloadAction already made, so this
-- only ever touches the single row the caller was already allowed to read and already holds the
-- one-time token for — it does not open a general write path.
create or replace function fulfill_download_request(p_request_id uuid, p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update download_requests set status = 'fulfilled', fulfilled_at = now(), download_token = null
  where id = p_request_id and requester_id = auth.uid() and status = 'approved' and download_token = p_token;

  if not found then
    raise exception 'Request not found, already used, or not approved';
  end if;
end;
$$;
