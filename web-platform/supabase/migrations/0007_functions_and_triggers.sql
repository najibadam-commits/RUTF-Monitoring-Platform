-- TPM Monitoring Platform — schema migration 7/11
-- Helper functions, triggers, and the workflow RPCs that back the issue
-- lifecycle (Discovery -> Assign -> Respond -> Corrective Action -> Verify).
--
-- Design choice: the assign/respond/corrective/verify/edit/delete actions
-- are exposed as SECURITY INVOKER RPCs (`rpc()` from the client) rather than
-- raw table UPDATEs. They still run as the calling user and are still fully
-- subject to RLS (see 0009) — the RPC only buys atomicity (issue mutation +
-- history row in one transaction) and centralizes the note-generation logic
-- that the prototype's confirmModal() has client-side today. RLS remains the
-- actual security boundary, not the RPC.

-- ── generic updated_at maintenance ──────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on profiles
  for each row execute function set_updated_at();
create trigger issues_set_updated_at before update on issues
  for each row execute function set_updated_at();
create trigger settings_set_updated_at before update on settings
  for each row execute function set_updated_at();

-- ── current-user helpers, used throughout RLS policies ──────────────────
-- security definer + fixed search_path: reads the caller's own profile row
-- without being subject to (and without recursing into) profiles' own RLS.
create or replace function current_user_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function current_project_id()
returns uuid language sql stable security definer set search_path = public as $$
  select project_id from profiles where id = auth.uid();
$$;

create or replace function current_account_status()
returns account_status language sql stable security definer set search_path = public as $$
  select status from profiles where id = auth.uid();
$$;

create or replace function is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select current_user_role() = 'super_admin';
$$;

-- True when the caller may see/act within the given project: Super Admin
-- sees everything. A caller whose own profile has no project_id (a "global"
-- account — e.g. an HQ Viewer) also sees everything. Everyone else is
-- restricted to rows whose project_id matches their own.
create or replace function in_scope(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_super_admin()
    or current_project_id() is null
    or current_project_id() = p_project_id;
$$;

-- ── safety-net profile creation on new auth.users row ───────────────────
-- Real role/project assignment happens in the admin-creation server action
-- (via the service-role client, right after auth.admin.createUser()) in the
-- same request. This trigger only guarantees profiles never orphans a user
-- created some other way (e.g. directly in the Supabase dashboard).
create or replace function handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, email, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    'viewer',
    'active'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ── restrict which columns a non-admin can change on their own profile ──
create or replace function enforce_profile_update_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  acting_role user_role := current_user_role();
begin
  if acting_role = 'super_admin' then
    return new;
  end if;

  if acting_role = 'project_admin' then
    -- Project Admin may edit role/status/project only for members of their
    -- own project, and can never grant super_admin or project_admin.
    if old.project_id is distinct from current_project_id() then
      raise exception 'Not authorized to modify profiles outside your project';
    end if;
    if new.role in ('super_admin', 'project_admin') and new.role is distinct from old.role then
      raise exception 'Project Admin cannot assign the % role', new.role;
    end if;
    return new;
  end if;

  -- Everyone else may only touch their own name/phone; role/project/status
  -- are locked regardless of what the client sends.
  if old.id is distinct from auth.uid() then
    raise exception 'Not authorized to modify other profiles';
  end if;
  new.role := old.role;
  new.project_id := old.project_id;
  new.status := old.status;
  return new;
end;
$$;

create trigger profiles_enforce_update_rules
  before update on profiles
  for each row execute function enforce_profile_update_rules();

-- ── photo_count maintenance ──────────────────────────────────────────────
create or replace function sync_issue_photo_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update issues set photo_count = (
    select count(*) from issue_photos where issue_id = coalesce(new.issue_id, old.issue_id)
  ) where id = coalesce(new.issue_id, old.issue_id);
  return null;
end;
$$;

create trigger issue_photos_sync_count
  after insert or delete on issue_photos
  for each row execute function sync_issue_photo_count();

-- ── auto-log "Issue reported" on creation ───────────────────────────────
create or replace function log_issue_reported()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into issue_history (issue_id, actor_id, actor_label, action, note)
  values (
    new.id,
    new.reported_by,
    coalesce((select name from profiles where id = new.reported_by), 'Field Monitor'),
    'Issue reported',
    'Field visit finding logged with photo evidence and GPS capture.'
  );
  return new;
end;
$$;

create trigger issues_log_reported
  after insert on issues
  for each row execute function log_issue_reported();

-- ── small internal helper: fetch calling user's display name ────────────
create or replace function my_name()
returns text language sql stable security definer set search_path = public as $$
  select name from profiles where id = auth.uid();
$$;

create or replace function create_notification(
  p_user_id uuid, p_type text, p_text text, p_link text, p_issue_id uuid
) returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, type, text, link, issue_id)
  values (p_user_id, p_type, p_text, p_link, p_issue_id);
$$;

-- ══════════════════════════════════════════════════════════════════════
-- Workflow RPCs — SECURITY INVOKER (default): run as the caller, still
-- subject to every RLS policy on issues/issue_history/notifications.
-- ══════════════════════════════════════════════════════════════════════

create or replace function assign_issue(p_issue_id uuid, p_dri_id uuid, p_note text default null)
returns issues language plpgsql as $$
declare
  v_dri record;
  v_issue issues;
begin
  select id, name into v_dri from profiles where id = p_dri_id and role = 'dri';
  if not found then
    raise exception 'Selected user is not a DRI';
  end if;

  update issues set status = 'assigned', assigned_dri = p_dri_id
    where id = p_issue_id
    returning * into v_issue;
  if not found then
    raise exception 'Issue not found or not permitted';
  end if;

  insert into issue_history (issue_id, actor_id, actor_label, action, note)
  values (p_issue_id, auth.uid(), 'TPM Sub-Panel', 'Assigned to DRI',
    coalesce(p_note, 'Routed to ' || v_dri.name || ' for action.'));

  perform create_notification(p_dri_id, 'assignment',
    'You were assigned issue ' || v_issue.code, '/issues/' || v_issue.id, v_issue.id);

  return v_issue;
end;
$$;

create or replace function submit_dri_response(p_issue_id uuid, p_response text, p_note text default null)
returns issues language plpgsql as $$
declare
  v_issue issues;
begin
  if not exists (select 1 from issues where id = p_issue_id and assigned_dri = auth.uid())
     and not is_super_admin() then
    raise exception 'Only the assigned DRI may submit this response';
  end if;

  update issues set status = 'in_progress', dri_response = p_response
    where id = p_issue_id
    returning * into v_issue;
  if not found then raise exception 'Issue not found or not permitted'; end if;

  insert into issue_history (issue_id, actor_id, actor_label, action, note)
  values (p_issue_id, auth.uid(), my_name(), 'Response submitted', coalesce(p_note, p_response));

  return v_issue;
end;
$$;

create or replace function record_corrective_action(p_issue_id uuid, p_action_taken text, p_note text default null)
returns issues language plpgsql as $$
declare
  v_issue issues;
begin
  if not exists (select 1 from issues where id = p_issue_id and assigned_dri = auth.uid())
     and not is_super_admin() then
    raise exception 'Only the assigned DRI may record corrective action';
  end if;

  update issues set status = 'resolved', corrective_action = p_action_taken
    where id = p_issue_id
    returning * into v_issue;
  if not found then raise exception 'Issue not found or not permitted'; end if;

  insert into issue_history (issue_id, actor_id, actor_label, action, note)
  values (p_issue_id, auth.uid(), my_name(), 'Corrective action recorded', coalesce(p_note, p_action_taken));

  if v_issue.reported_by is not null then
    perform create_notification(v_issue.reported_by, 'resolved',
      v_issue.code || ' is ready for verification', '/issues/' || v_issue.id, v_issue.id);
  end if;

  return v_issue;
end;
$$;

create or replace function verify_and_close_issue(p_issue_id uuid, p_note text default null)
returns issues language plpgsql as $$
declare
  v_issue issues;
begin
  update issues set status = 'verified_closed', verified_by = auth.uid(), resolution_date = now()
    where id = p_issue_id
    returning * into v_issue;
  if not found then raise exception 'Issue not found or not permitted'; end if;

  insert into issue_history (issue_id, actor_id, actor_label, action, note)
  values (p_issue_id, auth.uid(), my_name(), 'Verified and closed',
    coalesce(p_note, 'Confirmed resolution during follow-up visit.'));

  return v_issue;
end;
$$;

create or replace function edit_issue_submission(
  p_issue_id uuid, p_category_id uuid, p_priority issue_priority, p_description text
) returns issues language plpgsql as $$
declare
  v_issue issues;
begin
  if not is_super_admin() then
    raise exception 'Only Super Admin may edit a submission';
  end if;

  update issues set category_id = p_category_id, priority = p_priority, description = p_description
    where id = p_issue_id
    returning * into v_issue;
  if not found then raise exception 'Issue not found'; end if;

  insert into issue_history (issue_id, actor_id, actor_label, action, note)
  values (p_issue_id, auth.uid(), my_name(), 'Submission edited', 'Corrected field data on this submission.');

  return v_issue;
end;
$$;

create or replace function delete_issue_submission(p_issue_id uuid)
returns void language plpgsql as $$
begin
  if not is_super_admin() then
    raise exception 'Only Super Admin may delete a submission';
  end if;
  delete from issues where id = p_issue_id;
  if not found then raise exception 'Issue not found'; end if;
end;
$$;
