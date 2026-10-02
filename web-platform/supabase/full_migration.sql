-- ===== 0001_extensions_and_enums.sql =====
-- TPM Monitoring Platform — schema migration 1/11
-- Extensions and enum types.

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- 5 account roles. README's 3-tier RBAC table (Super Admin / Project Admin /
-- Viewer) is the authoritative *permission* spec; tpm_supervisor and dri are
-- the two operational roles the design prototype's data/workflow model
-- requires (mock-data.js USERS, and the TPM Sub-Panel / DRI-response flow in
-- the .dc.html prototype). See DECISIONS.md for the full reconciliation.
create type user_role as enum (
  'super_admin',
  'project_admin',
  'tpm_supervisor',
  'dri',
  'viewer'
);

create type account_status as enum ('active', 'inactive');

-- STATUS_ORDER in mock-data.js, snake_cased for Postgres.
create type issue_status as enum (
  'new',
  'assigned',
  'in_progress',
  'resolved',
  'verified_closed'
);

-- PRIORITY_COLOR keys in mock-data.js.
create type issue_priority as enum ('critical', 'high', 'medium', 'low');


-- ===== 0002_lookup_tables.sql =====
-- TPM Monitoring Platform — schema migration 2/11
-- Lookup/reference data: states, LGAs, wards, categories. Read by everyone
-- authenticated; written by Super Admin only (see 0008 RLS migration).
--
-- Real Nigeria administrative boundaries (37 states, 774 LGAs, 9,411 wards)
-- sourced from the user-supplied SpatiaLite layers (state.sqlite, LGA.sqlite,
-- Ward.sqlite) replace the design prototype's approximate x/y grid — see
-- tools/gis-import. Each level stores a full-precision `geom` (accurate
-- point-in-polygon lookups) and a `geom_simplified` (fast map rendering).

create extension if not exists postgis;

create table states (
  id uuid primary key default gen_random_uuid(),
  code text unique,            -- source statecode, e.g. 'LA', 'KN'
  name text not null unique,   -- statename
  geozone text,                -- source geopolitical zone, e.g. 'SWZ'
  capital text,
  geom geometry(MultiPolygon, 4326),
  geom_simplified geometry(MultiPolygon, 4326),
  created_at timestamptz not null default now()
);
create index states_geom_gix on states using gist (geom);
create index states_geom_simplified_gix on states using gist (geom_simplified);

create table lgas (
  id uuid primary key default gen_random_uuid(),
  state_id uuid not null references states(id) on delete cascade,
  code text unique,            -- source lgacode
  name text not null,          -- lganame
  geom geometry(MultiPolygon, 4326),
  geom_simplified geometry(MultiPolygon, 4326),
  created_at timestamptz not null default now(),
  unique (state_id, name)
);
create index lgas_state_id_idx on lgas(state_id);
create index lgas_geom_gix on lgas using gist (geom);
create index lgas_geom_simplified_gix on lgas using gist (geom_simplified);

create table wards (
  id uuid primary key default gen_random_uuid(),
  lga_id uuid not null references lgas(id) on delete cascade,
  code text unique,            -- source wardcode
  name text not null,          -- wardname
  urban boolean,
  geom geometry(MultiPolygon, 4326),
  geom_simplified geometry(MultiPolygon, 4326),
  created_at timestamptz not null default now(),
  unique (lga_id, name)
);
create index wards_lga_id_idx on wards(lga_id);
create index wards_geom_gix on wards using gist (geom);
create index wards_geom_simplified_gix on wards using gist (geom_simplified);

create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0
);


-- ===== 0003_projects_profiles.sql =====
-- TPM Monitoring Platform — schema migration 3/11
-- Projects (the scoping unit a Project Admin and their team belong to) and
-- profiles (extends auth.users per README: "profiles (extends auth.users):
-- id, name, email, phone, role, project_id, status, last_login").

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  phone text,
  role user_role not null default 'viewer',
  project_id uuid references projects(id) on delete set null,
  status account_status not null default 'active',
  last_login timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_project_id_idx on profiles(project_id);
create index profiles_role_idx on profiles(role);

comment on table profiles is
  'Extends auth.users. Rows are created by handle_new_auth_user() as a safety '
  'net (role=viewer) and immediately corrected by the admin-creation server '
  'action, which uses the service-role client to set the real role/project.';


-- ===== 0004_issues.sql =====
-- TPM Monitoring Platform — schema migration 4/11
-- issues: the core workflow entity. Field shapes mirror mock-data.js'
-- generateIssues() output (README's "Data Model" section) 1:1 where possible.

create table issues (
  id uuid primary key default gen_random_uuid(),
  issue_number bigserial not null unique,
  -- Human-readable ID matching the prototype's `ISS-1000` style, generated
  -- once and stored (not recomputed) so it never changes under an issue.
  code text generated always as ('ISS-' || (1000 + issue_number)) stored,

  project_id uuid references projects(id) on delete set null,
  category_id uuid not null references categories(id),
  description text not null,

  state_id uuid not null references states(id),
  lga_id uuid not null references lgas(id),
  ward_id uuid references wards(id),
  ward text,  -- denormalized label, kept in sync with wards.name at write time
  lat numeric(9, 6),
  lng numeric(9, 6),

  reported_at timestamptz not null default now(),
  reported_by uuid references profiles(id),

  priority issue_priority not null default 'medium',
  status issue_status not null default 'new',

  assigned_dri uuid references profiles(id),
  dri_response text,
  corrective_action text,
  verified_by uuid references profiles(id),
  resolution_date timestamptz,

  photo_count int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index issues_status_idx on issues(status);
create index issues_priority_idx on issues(priority);
create index issues_project_id_idx on issues(project_id);
create index issues_state_id_idx on issues(state_id);
create index issues_ward_id_idx on issues(ward_id);
create index issues_category_id_idx on issues(category_id);
create index issues_assigned_dri_idx on issues(assigned_dri);
create index issues_reported_by_idx on issues(reported_by);
create index issues_reported_at_idx on issues(reported_at desc);


-- ===== 0005_issue_history_and_photos.sql =====
-- TPM Monitoring Platform — schema migration 5/11
-- issue_history: append-only audit trail (README: "backs the Edit/Delete
-- history tracking added for Super Admin"). No UPDATE/DELETE policy is ever
-- granted on this table (see 0009 RLS migration) — it is insert + select only.
-- issue_photos: metadata rows pointing at Supabase Storage objects.

create table issue_history (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  actor_id uuid references profiles(id),
  -- Free-text label for cases the prototype uses a non-person actor, e.g.
  -- 'TPM Sub-Panel' on the auto-assignment step.
  actor_label text not null,
  action text not null,
  note text
);
create index issue_history_issue_id_idx on issue_history(issue_id, occurred_at);

create table issue_photos (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  storage_path text not null,   -- path within the `issue-evidence` bucket
  file_name text,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now()
);
create index issue_photos_issue_id_idx on issue_photos(issue_id);


-- ===== 0006_notifications_and_settings.sql =====
-- TPM Monitoring Platform — schema migration 6/11
-- notifications: backs the topbar bell dropdown (replaces the prototype's
-- static `notifications` mock array) — real, per-user, Realtime-fed rows.
-- settings: singleton row backing the Settings screen (Super Admin only).

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  text text not null,
  link text,
  issue_id uuid references issues(id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_id_idx on notifications(user_id, read, created_at desc);

create table settings (
  id smallint primary key default 1 check (id = 1),
  org_name text not null default 'TPM Monitoring Platform',
  timezone text not null default 'West Africa Time (WAT)',
  default_state_id uuid references states(id),
  email_alerts_on boolean not null default true,
  sms_alerts_on boolean not null default false,
  auto_assign_by_ward boolean not null default false,
  data_retention text not null default '12 months',
  export_format text not null default 'csv',
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
insert into settings (id) values (1);


-- ===== 0007_functions_and_triggers.sql =====
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


-- ===== 0008_rls_profiles_projects_lookups.sql =====
-- TPM Monitoring Platform — schema migration 8/11
-- RLS: profiles, projects, states, lgas, categories, settings.
--
-- Convention used throughout: where no INSERT/UPDATE/DELETE policy is
-- defined for a table, PostgREST clients (anon/authenticated) get a hard
-- deny by default — that is the security boundary, not a UI affordance.
-- Every table below has `enable row level security` before any policy.

alter table profiles enable row level security;
alter table projects enable row level security;
alter table states enable row level security;
alter table lgas enable row level security;
alter table wards enable row level security;
alter table categories enable row level security;
alter table settings enable row level security;

-- ── profiles ─────────────────────────────────────────────────────────────
-- README: Super Admin sees/manages all users. Project Admin manages users
-- within their own project only. Viewer/TPM Supervisor/DRI: self only.
create policy profiles_select on profiles for select to authenticated
  using (
    id = auth.uid()
    or is_super_admin()
    or (current_user_role() = 'project_admin' and project_id = current_project_id())
  );

-- Row creation happens via handle_new_auth_user() (security definer trigger)
-- or the service-role admin client — no client-facing INSERT policy.

create policy profiles_update on profiles for update to authenticated
  using (
    id = auth.uid()
    or is_super_admin()
    or (current_user_role() = 'project_admin' and project_id = current_project_id())
  )
  with check (
    id = auth.uid()
    or is_super_admin()
    or (current_user_role() = 'project_admin' and project_id = current_project_id())
  );
-- Column-level restriction (a non-admin can't smuggle a role/status/project
-- change through this policy) is enforced by enforce_profile_update_rules().

create policy profiles_delete on profiles for delete to authenticated
  using (is_super_admin() and id <> auth.uid());

-- ── projects ─────────────────────────────────────────────────────────────
create policy projects_select on projects for select to authenticated
  using (is_super_admin() or id = current_project_id());

create policy projects_insert on projects for insert to authenticated
  with check (is_super_admin());

create policy projects_update on projects for update to authenticated
  using (is_super_admin()) with check (is_super_admin());

create policy projects_delete on projects for delete to authenticated
  using (is_super_admin());

-- ── lookup tables: read for everyone signed in, write for Super Admin ────
create policy states_select on states for select to authenticated using (true);
create policy states_write_ins on states for insert to authenticated with check (is_super_admin());
create policy states_write_upd on states for update to authenticated using (is_super_admin()) with check (is_super_admin());
create policy states_write_del on states for delete to authenticated using (is_super_admin());

create policy lgas_select on lgas for select to authenticated using (true);
create policy lgas_write_ins on lgas for insert to authenticated with check (is_super_admin());
create policy lgas_write_upd on lgas for update to authenticated using (is_super_admin()) with check (is_super_admin());
create policy lgas_write_del on lgas for delete to authenticated using (is_super_admin());

create policy wards_select on wards for select to authenticated using (true);
create policy wards_write_ins on wards for insert to authenticated with check (is_super_admin());
create policy wards_write_upd on wards for update to authenticated using (is_super_admin()) with check (is_super_admin());
create policy wards_write_del on wards for delete to authenticated using (is_super_admin());

create policy categories_select on categories for select to authenticated using (true);
create policy categories_write_ins on categories for insert to authenticated with check (is_super_admin());
create policy categories_write_upd on categories for update to authenticated using (is_super_admin()) with check (is_super_admin());
create policy categories_write_del on categories for delete to authenticated using (is_super_admin());

-- ── settings (singleton) ─────────────────────────────────────────────────
create policy settings_select on settings for select to authenticated using (true);
create policy settings_update on settings for update to authenticated
  using (is_super_admin()) with check (is_super_admin());


-- ===== 0009_rls_issues.sql =====
-- TPM Monitoring Platform — schema migration 9/11
-- RLS: issues, issue_history, issue_photos, notifications.

alter table issues enable row level security;
alter table issue_history enable row level security;
alter table issue_photos enable row level security;
alter table notifications enable row level security;

-- ── issues ───────────────────────────────────────────────────────────────
-- README: "View dashboards, map, analytics, issues" — all 3 tiers, scoped to
-- project for everyone except Super Admin (see in_scope()).
create policy issues_select on issues for select to authenticated
  using (in_scope(project_id));

-- README: "Create/edit/delete issues... ✅ Super Admin, ✅ Project Admin (own
-- project), ❌ Viewer". TPM Supervisor is the role that actually files field
-- reports in the workflow narrative (mock-data.js reportedBy = TPM names).
create policy issues_insert on issues for insert to authenticated
  with check (
    current_user_role() in ('super_admin', 'project_admin', 'tpm_supervisor')
    and in_scope(project_id)
  );

-- Broad per-role UPDATE gate; the specific workflow RPCs in 0007 layer
-- tighter checks on top (e.g. only the assigned DRI may submit a response).
create policy issues_update on issues for update to authenticated
  using (
    is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id))
    or (current_user_role() = 'tpm_supervisor' and in_scope(project_id))
    or (current_user_role() = 'dri' and assigned_dri = auth.uid())
  )
  with check (
    is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id))
    or (current_user_role() = 'tpm_supervisor' and in_scope(project_id))
    or (current_user_role() = 'dri' and assigned_dri = auth.uid())
  );

-- README/prototype: Delete is Super Admin only.
create policy issues_delete on issues for delete to authenticated
  using (is_super_admin());

-- ── issue_history — append-only audit trail ─────────────────────────────
-- No UPDATE/DELETE policy exists on this table anywhere in this schema —
-- that omission (not a USING clause) is what makes it immutable.
create policy issue_history_select on issue_history for select to authenticated
  using (exists (select 1 from issues i where i.id = issue_history.issue_id));

create policy issue_history_insert on issue_history for insert to authenticated
  with check (
    current_user_role() <> 'viewer'
    and exists (select 1 from issues i where i.id = issue_history.issue_id)
  );

-- ── issue_photos ─────────────────────────────────────────────────────────
create policy issue_photos_select on issue_photos for select to authenticated
  using (exists (select 1 from issues i where i.id = issue_photos.issue_id));

create policy issue_photos_insert on issue_photos for insert to authenticated
  with check (
    current_user_role() <> 'viewer'
    and exists (select 1 from issues i where i.id = issue_photos.issue_id)
  );

create policy issue_photos_delete on issue_photos for delete to authenticated
  using (
    is_super_admin()
    or (
      current_user_role() = 'project_admin'
      and exists (select 1 from issues i where i.id = issue_photos.issue_id and in_scope(i.project_id))
    )
  );

-- ── notifications — always self-scoped ──────────────────────────────────
create policy notifications_select on notifications for select to authenticated
  using (user_id = auth.uid());

create policy notifications_update on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notifications_delete on notifications for delete to authenticated
  using (user_id = auth.uid());
-- No client INSERT policy: rows are only created by create_notification(),
-- a security-definer function invoked from the workflow RPCs above.


-- ===== 0010_storage.sql =====
-- TPM Monitoring Platform — schema migration 10/11
-- Storage: one private bucket for issue evidence photos, one folder per
-- issue (README: "issue photo evidence... maps to a Supabase Storage
-- bucket, one folder per issue"). Objects are named `{issue_id}/{filename}`.
-- Access is never public — always via signed URL, gated by the same
-- project/role scoping as the issues table itself.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'issue-evidence', 'issue-evidence', false,
  10485760, -- 10 MB per file
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

create policy "issue-evidence select" on storage.objects for select to authenticated
  using (
    bucket_id = 'issue-evidence'
    and exists (
      select 1 from issues i
      where i.id::text = (storage.foldername(name))[1]
        and in_scope(i.project_id)
    )
  );

create policy "issue-evidence insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'issue-evidence'
    and current_user_role() <> 'viewer'
    and exists (
      select 1 from issues i
      where i.id::text = (storage.foldername(name))[1]
        and in_scope(i.project_id)
    )
  );

create policy "issue-evidence delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'issue-evidence'
    and (
      is_super_admin()
      or (
        current_user_role() = 'project_admin'
        and exists (
          select 1 from issues i
          where i.id::text = (storage.foldername(name))[1]
            and in_scope(i.project_id)
        )
      )
    )
  );


-- ===== 0011_realtime.sql =====
-- TPM Monitoring Platform — schema migration 11/11
-- Realtime: publish the tables the Dashboard, GIS Map, Issues list, and
-- notification bell subscribe to. RLS still applies to Realtime — a client
-- only receives change events for rows it's allowed to SELECT.

alter publication supabase_realtime add table issues;
alter publication supabase_realtime add table issue_history;
alter publication supabase_realtime add table notifications;

-- Full row images on UPDATE (not just changed columns/PK) so the client can
-- reconcile issue state without an extra round-trip.
alter table issues replica identity full;


-- ===== 0012_spatial_lookup.sql =====
-- TPM Monitoring Platform — schema migration 12/12
-- Point-in-polygon lookup: given a GPS coordinate, resolve the containing
-- state/LGA/ward via the real boundary geometry. This is the "seamless
-- interaction" between the boundary layers and issue reporting — a TPM
-- dropping a pin or capturing GPS gets state/LGA/ward auto-filled instead
-- of picking three dropdowns by hand (the dropdowns remain as a manual
-- override/fallback for GPS-denied environments).

create or replace function resolve_administrative_location(p_lat numeric, p_lng numeric)
returns table (state_id uuid, state_name text, lga_id uuid, lga_name text, ward_id uuid, ward_name text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, l.id, l.name, w.id, w.name
  from states s
  join lgas l on l.state_id = s.id
  left join wards w on w.lga_id = l.id
    and st_contains(w.geom, st_setsrid(st_makepoint(p_lng, p_lat), 4326))
  where st_contains(s.geom, st_setsrid(st_makepoint(p_lng, p_lat), 4326))
    and st_contains(l.geom, st_setsrid(st_makepoint(p_lng, p_lat), 4326))
  limit 1;
$$;

comment on function resolve_administrative_location(numeric, numeric) is
  'Given (lat, lng), returns the containing state/LGA/ward by real boundary '
  'geometry. Called from the issue-report form to auto-fill location fields; '
  'a null result (point outside all known boundaries, or off Nigeria) falls '
  'back to manual dropdown selection.';


-- ===== 0013_boundary_geojson_rpcs.sql =====
-- TPM Monitoring Platform — schema migration 13
-- PostgREST/Supabase returns raw `geometry` columns as hex-encoded WKB, not
-- GeoJSON, when selected directly. These RPCs return ready-to-render GeoJSON
-- instead, using the pre-computed `geom_simplified` column so the GIS map's
-- boundary layers stay light. LGA/ward boundaries are loaded lazily (by
-- parent id) rather than all at once — 774 LGAs and 9.4k wards of geometry
-- is too much to ship on every map load.

create or replace function get_state_boundaries()
returns table (id uuid, name text, code text, geojson json)
language sql stable as $$
  select id, name, code, ST_AsGeoJSON(geom_simplified)::json
  from states
  where geom_simplified is not null;
$$;

create or replace function get_lga_boundaries(p_state_id uuid default null)
returns table (id uuid, state_id uuid, name text, code text, geojson json)
language sql stable as $$
  select id, state_id, name, code, ST_AsGeoJSON(geom_simplified)::json
  from lgas
  where geom_simplified is not null
    and (p_state_id is null or state_id = p_state_id);
$$;

create or replace function get_ward_boundaries(p_lga_id uuid)
returns table (id uuid, lga_id uuid, name text, code text, geojson json)
language sql stable as $$
  select id, lga_id, name, code, ST_AsGeoJSON(geom_simplified)::json
  from wards
  where lga_id = p_lga_id and geom_simplified is not null;
$$;

comment on function get_state_boundaries() is
  'Returns all 37 state boundaries as GeoJSON (simplified geometry) for the GIS map base layer.';
comment on function get_lga_boundaries(uuid) is
  'Returns LGA boundaries as GeoJSON, optionally filtered to one state — call when a state is selected/zoomed into.';
comment on function get_ward_boundaries(uuid) is
  'Returns ward boundaries as GeoJSON for one LGA — call on further zoom/selection, never for the whole country at once.';


-- ===== 0014_fix_profile_trigger_service_bypass.sql =====
-- TPM Monitoring Platform — schema migration 14
-- enforce_profile_update_rules() must not block trusted backend writes.
-- auth.uid() is NULL for any connection with no end-user JWT context — the
-- service-role client (used by admin-creation server actions and seed
-- scripts) and a direct superuser/postgres connection both fall in that
-- category, and both already bypass RLS entirely (service_role has
-- bypassrls; a superuser connection isn't subject to RLS at all). The RLS
-- policy on profiles is `to authenticated` only, so an anonymous/unauthenticated
-- PostgREST caller can never reach this trigger in the first place — a NULL
-- auth.uid() here can only mean "trusted backend", never "public caller
-- pretending to be nobody".

create or replace function enforce_profile_update_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  acting_role user_role;
begin
  if auth.uid() is null then
    return new; -- service-role / direct DB connection: trusted, no client-side guard needed
  end if;

  acting_role := current_user_role();

  if acting_role = 'super_admin' then
    return new;
  end if;

  if acting_role = 'project_admin' then
    if old.project_id is distinct from current_project_id() then
      raise exception 'Not authorized to modify profiles outside your project';
    end if;
    if new.role in ('super_admin', 'project_admin') and new.role is distinct from old.role then
      raise exception 'Project Admin cannot assign the % role', new.role;
    end if;
    return new;
  end if;

  if old.id is distinct from auth.uid() then
    raise exception 'Not authorized to modify other profiles';
  end if;
  new.role := old.role;
  new.project_id := old.project_id;
  new.status := old.status;
  return new;
end;
$$;


-- ===== 0015_datasets_settlements_activity_sites.sql =====
-- TPM Monitoring Platform — schema migration 15
-- "Add Data Set" feature: Settlement Lists and Activity Sites, managed by
-- Super Admin and Project Admin, with Project Admin submissions requiring
-- Super Admin approval before going live.
--
-- Column names (statename/lganame/settlementname, activitysitename) are
-- plain text by explicit request, not FKs into states/lgas — these are
-- flat pick-lists synced to a field mobile app, matching how the app's own
-- source boundary files (state.sqlite/LGA.sqlite/Ward.sqlite) already carry
-- state/LGA as denormalized text fields rather than relational IDs. See
-- DECISIONS.md #7.

create type dataset_status as enum ('approved', 'pending_create', 'pending_update', 'pending_delete', 'rejected');

create table settlements (
  id uuid primary key default gen_random_uuid(),
  statename text not null,
  lganame text not null,
  settlementname text not null,
  project_id uuid references projects(id) on delete set null,
  status dataset_status not null default 'approved',
  pending_data jsonb,          -- proposed {statename,lganame,settlementname} while status = pending_update
  submitted_by uuid references profiles(id),
  reviewed_by uuid references profiles(id),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index settlements_status_idx on settlements(status);
create index settlements_project_id_idx on settlements(project_id);
-- Prevents duplicate live/pending entries for the same place; rejected rows
-- are exempt so resubmission after a rejection isn't blocked.
create unique index settlements_unique_name on settlements (statename, lganame, settlementname) where status <> 'rejected';

create table activity_sites (
  id uuid primary key default gen_random_uuid(),
  statename text not null,
  lganame text not null,
  activitysitename text not null,
  project_id uuid references projects(id) on delete set null,
  status dataset_status not null default 'approved',
  pending_data jsonb,
  submitted_by uuid references profiles(id),
  reviewed_by uuid references profiles(id),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index activity_sites_status_idx on activity_sites(status);
create index activity_sites_project_id_idx on activity_sites(project_id);
create unique index activity_sites_unique_name on activity_sites (statename, lganame, activitysitename) where status <> 'rejected';

create trigger settlements_set_updated_at before update on settlements
  for each row execute function set_updated_at();
create trigger activity_sites_set_updated_at before update on activity_sites
  for each row execute function set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
-- Approval workflow — one generic trigger, works on either table because
-- it operates on NEW/OLD as whole records (to_jsonb) rather than naming
-- table-specific columns, so it doesn't need to know settlementname vs
-- activitysitename.
-- ══════════════════════════════════════════════════════════════════════
create or replace function enforce_dataset_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  acting_role user_role := current_user_role();
  business_fields jsonb;
begin
  if TG_OP = 'INSERT' then
    if acting_role = 'super_admin' then
      NEW.status := 'approved';
      NEW.submitted_by := coalesce(NEW.submitted_by, auth.uid());
      NEW.reviewed_by := auth.uid();
    elsif acting_role = 'project_admin' then
      NEW.status := 'pending_create';
      NEW.submitted_by := auth.uid();
      NEW.reviewed_by := null;
      NEW.project_id := current_project_id(); -- always their own project, never client-supplied
    else
      raise exception 'Not authorized to add data set entries';
    end if;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if acting_role = 'super_admin' then
      NEW.reviewed_by := auth.uid();
      return NEW;
    elsif acting_role = 'project_admin' then
      if OLD.status = 'approved' then
        if OLD.project_id is distinct from current_project_id() then
          raise exception 'Not authorized to modify entries outside your project';
        end if;
        -- Redirect the edit into a proposal — live fields (returned to
        -- callers, and to the mobile app) stay exactly as they were.
        business_fields := to_jsonb(NEW) - 'id' - 'status' - 'pending_data' - 'submitted_by'
          - 'reviewed_by' - 'review_note' - 'created_at' - 'updated_at' - 'project_id';
        NEW := OLD;
        NEW.pending_data := business_fields;
        NEW.status := 'pending_update';
        NEW.submitted_by := auth.uid();
        NEW.reviewed_by := null;
        NEW.review_note := null;
        return NEW;
      elsif OLD.status in ('pending_create', 'pending_update') and OLD.submitted_by = auth.uid() then
        NEW.status := OLD.status; -- still awaiting review, just revise the proposal
        NEW.reviewed_by := null;
        return NEW;
      else
        raise exception 'You can only edit your own pending submissions or an approved entry in your project';
      end if;
    else
      raise exception 'Not authorized to modify data set entries';
    end if;
  end if;

  if TG_OP = 'DELETE' then
    if acting_role = 'super_admin' then
      return OLD; -- deletes immediately
    elsif acting_role = 'project_admin' then
      if OLD.status = 'pending_create' and OLD.submitted_by = auth.uid() then
        return OLD; -- withdrawing their own never-approved submission: hard delete is fine
      end if;
      if OLD.status = 'approved' and OLD.project_id is not distinct from current_project_id() then
        execute format(
          'update %I set status = %L, submitted_by = %L, reviewed_by = null, review_note = null, updated_at = now() where id = %L',
          TG_TABLE_NAME, 'pending_delete', auth.uid(), OLD.id
        );
        return null; -- cancel the actual DELETE — it's now a pending request instead
      end if;
      raise exception 'Not authorized to delete this entry, or it already has a pending change';
    else
      raise exception 'Not authorized to delete data set entries';
    end if;
  end if;

  return null;
end;
$$;

create trigger settlements_enforce_workflow before insert or update or delete on settlements
  for each row execute function enforce_dataset_workflow();
create trigger activity_sites_enforce_workflow before insert or update or delete on activity_sites
  for each row execute function enforce_dataset_workflow();

-- ── approval RPCs (Super Admin only — also gated by RLS below) ──────────
create or replace function approve_settlement(p_id uuid, p_note text default null)
returns settlements language plpgsql as $$
declare v_row settlements;
begin
  if not is_super_admin() then raise exception 'Only Super Admin may approve data set entries'; end if;
  select * into v_row from settlements where id = p_id;
  if not found then raise exception 'Entry not found'; end if;

  if v_row.status = 'pending_delete' then
    delete from settlements where id = p_id;
  elsif v_row.status = 'pending_update' then
    update settlements set
      statename = coalesce(pending_data->>'statename', statename),
      lganame = coalesce(pending_data->>'lganame', lganame),
      settlementname = coalesce(pending_data->>'settlementname', settlementname),
      status = 'approved', pending_data = null, reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  elsif v_row.status = 'pending_create' then
    update settlements set status = 'approved', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  else
    raise exception 'This entry has no pending change to approve';
  end if;
  return v_row;
end;
$$;

create or replace function reject_settlement(p_id uuid, p_note text)
returns settlements language plpgsql as $$
declare v_row settlements;
begin
  if not is_super_admin() then raise exception 'Only Super Admin may reject data set entries'; end if;
  select * into v_row from settlements where id = p_id;
  if not found then raise exception 'Entry not found'; end if;

  if v_row.status = 'pending_delete' then
    update settlements set status = 'approved', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  elsif v_row.status = 'pending_update' then
    update settlements set pending_data = null, status = 'approved', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  elsif v_row.status = 'pending_create' then
    update settlements set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  else
    raise exception 'This entry has no pending change to reject';
  end if;
  return v_row;
end;
$$;

create or replace function approve_activity_site(p_id uuid, p_note text default null)
returns activity_sites language plpgsql as $$
declare v_row activity_sites;
begin
  if not is_super_admin() then raise exception 'Only Super Admin may approve data set entries'; end if;
  select * into v_row from activity_sites where id = p_id;
  if not found then raise exception 'Entry not found'; end if;

  if v_row.status = 'pending_delete' then
    delete from activity_sites where id = p_id;
  elsif v_row.status = 'pending_update' then
    update activity_sites set
      statename = coalesce(pending_data->>'statename', statename),
      lganame = coalesce(pending_data->>'lganame', lganame),
      activitysitename = coalesce(pending_data->>'activitysitename', activitysitename),
      status = 'approved', pending_data = null, reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  elsif v_row.status = 'pending_create' then
    update activity_sites set status = 'approved', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  else
    raise exception 'This entry has no pending change to approve';
  end if;
  return v_row;
end;
$$;

create or replace function reject_activity_site(p_id uuid, p_note text)
returns activity_sites language plpgsql as $$
declare v_row activity_sites;
begin
  if not is_super_admin() then raise exception 'Only Super Admin may reject data set entries'; end if;
  select * into v_row from activity_sites where id = p_id;
  if not found then raise exception 'Entry not found'; end if;

  if v_row.status = 'pending_delete' then
    update activity_sites set status = 'approved', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  elsif v_row.status = 'pending_update' then
    update activity_sites set pending_data = null, status = 'approved', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  elsif v_row.status = 'pending_create' then
    update activity_sites set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  else
    raise exception 'This entry has no pending change to reject';
  end if;
  return v_row;
end;
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table settlements enable row level security;
alter table activity_sites enable row level security;

-- Approved rows are readable by everyone signed in — this is what the field
-- mobile app's pick-lists query (Supabase's auto-generated REST API is the
-- "sync" mechanism: GET .../settlements?status=eq.approved with a field
-- user's JWT). Pending/rejected rows are visible only to their submitter
-- and to whoever can approve them.
create policy settlements_select on settlements for select to authenticated
  using (
    status = 'approved'
    or submitted_by = auth.uid()
    or is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id))
  );
create policy settlements_insert on settlements for insert to authenticated
  with check (current_user_role() in ('super_admin', 'project_admin'));
create policy settlements_update on settlements for update to authenticated
  using (
    is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id) and (submitted_by = auth.uid() or status = 'approved'))
  )
  with check (is_super_admin() or current_user_role() = 'project_admin');
create policy settlements_delete on settlements for delete to authenticated
  using (
    is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id) and (submitted_by = auth.uid() or status = 'approved'))
  );

create policy activity_sites_select on activity_sites for select to authenticated
  using (
    status = 'approved'
    or submitted_by = auth.uid()
    or is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id))
  );
create policy activity_sites_insert on activity_sites for insert to authenticated
  with check (current_user_role() in ('super_admin', 'project_admin'));
create policy activity_sites_update on activity_sites for update to authenticated
  using (
    is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id) and (submitted_by = auth.uid() or status = 'approved'))
  )
  with check (is_super_admin() or current_user_role() = 'project_admin');
create policy activity_sites_delete on activity_sites for delete to authenticated
  using (
    is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id) and (submitted_by = auth.uid() or status = 'approved'))
  );

-- ── Realtime — so the Super Admin's approval queue updates live ─────────
alter publication supabase_realtime add table settlements;
alter publication supabase_realtime add table activity_sites;


-- ===== 0016_mobile_app_integration.sql =====
-- TPM Monitoring Platform — schema migration 16
-- Field-mobile-app integration (Android "TPM Process Monitoring App").
-- Reconciles the mobile app's Field Monitor / DRI workflow with this
-- platform's Discovery → Assign → DRI Response → Corrective Action →
-- Verify/Close model. See DECISIONS.md #7 for the full reasoning behind
-- every choice below.
--
-- Summary of additions:
--   1. issue_status gets a 'reopened' value (mobile's Final Verification
--      "No, not resolved" path — nothing in the schema could represent this).
--   2. issue_gps_captures: one row per (issue, lifecycle stage) GPS fix —
--      the mobile app captures GPS at discovery, DRI action, and
--      verification separately; `issues.lat/lng` only ever held one point.
--   3. issues gains settlement/activity_site (denormalized text, same
--      pattern as the existing `ward` column) and mobile_code — the
--      client-generated, immediately-visible offline-first issue ID
--      (`LAG-HLT-2026-000052` style), distinct from the server's own
--      `code` (`ISS-1042`) which only exists once a row is actually
--      inserted. Both ids are real and both are shown, in different places.
--   4. issue_photos gains kind (mov/selfie) and stage (which lifecycle
--      event it was captured at) — previously just an undifferentiated bag
--      of photos per issue.
--   5. dri_self_assign(): the mobile DRI picks an unassigned issue itself
--      (no TPM Supervisor assignment step exists in the mobile spec) —
--      requires a small RLS carve-out on issues_update (see below).
--   6. reject_and_reopen_issue(): the counterpart to verify_and_close_issue
--      for the "not resolved" outcome — sets status = 'reopened' and routes
--      back to the same assigned_dri, exactly like the RLS-is-the-boundary,
--      SECURITY INVOKER, atomic-with-history pattern established in 0007.

-- ── 1. reopened status ──────────────────────────────────────────────────
alter type issue_status add value if not exists 'reopened';

-- ── 2. per-stage GPS captures ────────────────────────────────────────────
create type capture_stage as enum ('discovery', 'dri_response', 'verification');

create table issue_gps_captures (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  stage capture_stage not null,
  lat numeric(9, 6) not null,
  lng numeric(9, 6) not null,
  accuracy_m numeric(6, 1),
  captured_by uuid references profiles(id),
  captured_at timestamptz not null default now(),
  unique (issue_id, stage)
);
create index issue_gps_captures_issue_id_idx on issue_gps_captures(issue_id);

alter table issue_gps_captures enable row level security;

create policy issue_gps_captures_select on issue_gps_captures for select to authenticated
  using (exists (select 1 from issues i where i.id = issue_gps_captures.issue_id));

create policy issue_gps_captures_insert on issue_gps_captures for insert to authenticated
  with check (
    current_user_role() <> 'viewer'
    and exists (select 1 from issues i where i.id = issue_gps_captures.issue_id)
  );

-- ── 3. issues: settlement/activity_site + the mobile offline-first id ───
alter table issues add column settlement text;
alter table issues add column activity_site text;
alter table issues add column mobile_code text unique;

comment on column issues.mobile_code is
  'Client-generated at submission time on the Android app (format '
  '{STATE_CODE}-HLT-{YEAR}-{6 digits}), so a Field Monitor sees a stable '
  'issue ID immediately while offline — before this row exists server-side '
  'at all. Distinct from `code` (ISS-NNNN), which is server-generated and '
  'only exists once synced. Null for issues created from the web app.';

-- ── 4. issue_photos: which of the two evidence photos, from which stage ─
create type photo_kind as enum ('mov', 'selfie');

alter table issue_photos add column kind photo_kind;
alter table issue_photos add column stage capture_stage;

-- ── 5. DRI self-assignment ───────────────────────────────────────────────
create or replace function dri_self_assign(p_issue_id uuid)
returns issues language plpgsql as $$
declare
  v_issue issues;
begin
  if current_user_role() <> 'dri' then
    raise exception 'Only a DRI may self-assign an issue';
  end if;

  update issues set status = 'assigned', assigned_dri = auth.uid()
    where id = p_issue_id and status = 'new' and assigned_dri is null
    returning * into v_issue;
  if not found then
    raise exception 'Issue not found, already assigned, or not permitted';
  end if;

  insert into issue_history (issue_id, actor_id, actor_label, action, note)
  values (p_issue_id, auth.uid(), my_name(), 'Self-assigned by DRI',
    'Picked up from the unassigned issues list on the mobile app.');

  return v_issue;
end;
$$;

-- issues_update's existing USING clause requires assigned_dri = auth.uid(),
-- which a not-yet-assigned row can never satisfy for a DRI — this adds the
-- one additional case (unassigned + still 'new') without loosening anything
-- else. WITH CHECK needs no change: after the update assigned_dri = auth.uid()
-- already satisfies the existing DRI clause there.
drop policy if exists issues_update on issues;
create policy issues_update on issues for update to authenticated
  using (
    is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id))
    or (current_user_role() = 'tpm_supervisor' and in_scope(project_id))
    or (current_user_role() = 'dri' and assigned_dri = auth.uid())
    or (current_user_role() = 'dri' and assigned_dri is null and status = 'new')
  )
  with check (
    is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id))
    or (current_user_role() = 'tpm_supervisor' and in_scope(project_id))
    or (current_user_role() = 'dri' and assigned_dri = auth.uid())
  );

-- ── 6. Reject & reopen (Final Verification "No, not resolved") ─────────
create or replace function reject_and_reopen_issue(p_issue_id uuid, p_comment text)
returns issues language plpgsql as $$
declare
  v_issue issues;
begin
  if coalesce(trim(p_comment), '') = '' then
    raise exception 'A comment explaining why the issue remains unresolved is required';
  end if;

  update issues set status = 'reopened'
    where id = p_issue_id and status = 'resolved'
    returning * into v_issue;
  if not found then
    raise exception 'Issue not found, not awaiting verification, or not permitted';
  end if;

  insert into issue_history (issue_id, actor_id, actor_label, action, note) values
    (p_issue_id, auth.uid(), my_name(), 'Final Verification — Not Resolved', p_comment),
    (p_issue_id, auth.uid(), my_name(), 'Issue Reopened', 'Routed back to ' ||
      coalesce((select name from profiles where id = v_issue.assigned_dri), 'the assigned DRI') || '.');

  if v_issue.assigned_dri is not null then
    perform create_notification(v_issue.assigned_dri, 'reopened',
      v_issue.code || ' was reopened — additional action required', '/issues/' || v_issue.id, v_issue.id);
  end if;

  return v_issue;
end;
$$;


-- ===== 0018_fix_dataset_trigger_service_bypass.sql =====
-- TPM Monitoring Platform — schema migration 18
-- Same fix as 0014 (enforce_profile_update_rules), applied to
-- enforce_dataset_workflow(): auth.uid() is NULL for any connection with no
-- end-user JWT context (service-role client, direct postgres connection) —
-- both already bypass RLS entirely, so the trigger's client-side guardrails
-- should not block them. The RLS policies on settlements/activity_sites are
-- `to authenticated` only, so a NULL auth.uid() here can only mean trusted
-- backend, never a public caller pretending to be nobody.

create or replace function enforce_dataset_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  acting_role user_role;
  business_fields jsonb;
begin
  if auth.uid() is null then
    return coalesce(new, old); -- service-role / direct DB connection: trusted
  end if;

  acting_role := current_user_role();

  if TG_OP = 'INSERT' then
    if acting_role = 'super_admin' then
      NEW.status := 'approved';
      NEW.submitted_by := coalesce(NEW.submitted_by, auth.uid());
      NEW.reviewed_by := auth.uid();
    elsif acting_role = 'project_admin' then
      NEW.status := 'pending_create';
      NEW.submitted_by := auth.uid();
      NEW.reviewed_by := null;
      NEW.project_id := current_project_id();
    else
      raise exception 'Not authorized to add data set entries';
    end if;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if acting_role = 'super_admin' then
      NEW.reviewed_by := auth.uid();
      return NEW;
    elsif acting_role = 'project_admin' then
      if OLD.status = 'approved' then
        if OLD.project_id is distinct from current_project_id() then
          raise exception 'Not authorized to modify entries outside your project';
        end if;
        business_fields := to_jsonb(NEW) - 'id' - 'status' - 'pending_data' - 'submitted_by'
          - 'reviewed_by' - 'review_note' - 'created_at' - 'updated_at' - 'project_id';
        NEW := OLD;
        NEW.pending_data := business_fields;
        NEW.status := 'pending_update';
        NEW.submitted_by := auth.uid();
        NEW.reviewed_by := null;
        NEW.review_note := null;
        return NEW;
      elsif OLD.status in ('pending_create', 'pending_update') and OLD.submitted_by = auth.uid() then
        NEW.status := OLD.status;
        NEW.reviewed_by := null;
        return NEW;
      else
        raise exception 'You can only edit your own pending submissions or an approved entry in your project';
      end if;
    else
      raise exception 'Not authorized to modify data set entries';
    end if;
  end if;

  if TG_OP = 'DELETE' then
    if acting_role = 'super_admin' then
      return OLD;
    elsif acting_role = 'project_admin' then
      if OLD.status = 'pending_create' and OLD.submitted_by = auth.uid() then
        return OLD;
      end if;
      if OLD.status = 'approved' and OLD.project_id is not distinct from current_project_id() then
        execute format(
          'update %I set status = %L, submitted_by = %L, reviewed_by = null, review_note = null, updated_at = now() where id = %L',
          TG_TABLE_NAME, 'pending_delete', auth.uid(), OLD.id
        );
        return null;
      end if;
      raise exception 'Not authorized to delete this entry, or it already has a pending change';
    else
      raise exception 'Not authorized to delete data set entries';
    end if;
  end if;

  return null;
end;
$$;


-- ===== 0019_ward_linked_settlements_activity_sites.sql =====
-- TPM Monitoring Platform — schema migration 19
-- Administrative hierarchy for the Android field app's cascading dropdowns:
-- State -> LGA -> Ward -> {Settlement, Activity Site} as two INDEPENDENT
-- siblings under Ward (not a Settlement -> Activity Site chain — deliberate
-- choice, see DECISIONS.md #8). Both settlements and activity_sites gain a
-- real `ward_id` FK; `statename`/`lganame` stay as denormalized display
-- columns (matching the `ward` text column pattern already used on
-- `issues`) but are now derived server-side from ward_id, never trusted
-- from the client — this makes an inconsistent State/LGA/Ward/Settlement
-- combination structurally impossible rather than merely validated (README
-- requirement 6: "Do not silently accept inconsistent records").
--
-- Both tables are empty in production (confirmed before writing this), so
-- ward_id can go straight to NOT NULL with no backfill.

alter table settlements add column ward_id uuid references wards(id);
alter table settlements alter column ward_id set not null;
create index settlements_ward_id_idx on settlements(ward_id);

alter table activity_sites add column ward_id uuid references wards(id);
alter table activity_sites alter column ward_id set not null;
create index activity_sites_ward_id_idx on activity_sites(ward_id);

-- Replace the old (statename, lganame, name) uniqueness with (ward_id, name)
-- — the precise scope now that ward_id is the authoritative link.
drop index if exists settlements_unique_name;
create unique index settlements_unique_name on settlements (ward_id, settlementname) where status <> 'rejected';

drop index if exists activity_sites_unique_name;
create unique index activity_sites_unique_name on activity_sites (ward_id, activitysitename) where status <> 'rejected';

-- ── derive statename/lganame from ward_id, ignoring whatever the client sent ──
create or replace function derive_dataset_location_names()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_state text;
  v_lga text;
begin
  if NEW.ward_id is null then
    raise exception 'ward_id is required';
  end if;

  select s.name, l.name into v_state, v_lga
  from wards w join lgas l on l.id = w.lga_id join states s on s.id = l.state_id
  where w.id = NEW.ward_id;

  if v_state is null then
    raise exception 'Invalid ward_id — no matching ward/LGA/state found';
  end if;

  NEW.statename := v_state;
  NEW.lganame := v_lga;
  return NEW;
end;
$$;

-- Named to sort alphabetically before each table's existing
-- "*_enforce_workflow" trigger (BEFORE triggers on the same table/event fire
-- in trigger-name order) — derivation must happen first so the workflow
-- trigger's pending_data snapshot captures the already-correct names.
create trigger settlements_derive_location_names before insert or update on settlements
  for each row execute function derive_dataset_location_names();
create trigger activity_sites_derive_location_names before insert or update on activity_sites
  for each row execute function derive_dataset_location_names();

-- ── issues: store stable IDs for settlement/activity site, not just text ──
-- (state_id/lga_id/ward_id already existed; settlement/activity_site were
-- text-only from migration 0016 — README requirement 11.)
alter table issues add column settlement_id uuid references settlements(id);
alter table issues add column activity_site_id uuid references activity_sites(id);


-- ===== 0020_issue_location_other.sql =====
-- Free-text fallback for the mobile app's merged Settlement/Activity Site picker.
--
-- The Android "Register New Issue" wizard now shows Settlements and Activity Sites for the
-- selected Ward together in a single picker (instead of two separate required dropdowns), plus
-- an "Other — not listed" option for field staff to type a name manually when the real place
-- isn't in the preloaded reference list yet.
--
-- Settlements and Activity Sites stay distinct tables/FKs (issues.settlement_id /
-- issues.activity_site_id, see migration 0019 and DECISIONS.md #8) — this column only covers the
-- unclassified manual-entry case, where neither FK can be set because there's no matching row to
-- point at. settlement_id/activity_site_id remain null when location_other is used; an admin can
-- later read this text on the issue and, if it should exist going forward, add it as a real
-- Settlement or Activity Site via the Data Sets approval workflow already built on the web app.
alter table issues add column location_other text;

comment on column issues.location_other is
  'Free-text location name captured on the mobile app when the field-reported Settlement/Activity Site was not found in the preloaded reference list. Null whenever settlement_id or activity_site_id is set.';


-- ===== 0021_email_notifications.sql =====
-- Real email delivery for issue notifications (assignment / resolved / reopened), on top of the
-- existing in-app `notifications` rows (see #6 in DECISIONS.md).
--
-- All three notification types already funnel through create_notification() — assign_issue,
-- submit_dri_response, reject_and_reopen_issue (migrations 0007, 0016) — so extending that one
-- function covers every case without touching the RPCs that call it.
--
-- The actual send uses pg_net (async, non-blocking HTTP from Postgres) to call Resend's API. The
-- API key is never stored in a migration file — it lives in Supabase Vault, added separately via
-- tools/db/set-resend-key.js once available. Until a key is set, the email step is a silent no-op
-- (see the `if v_api_key is null then return` guard) — nothing breaks, in-app notifications keep
-- working exactly as before.
--
-- Email is strictly best-effort: any failure (missing key, Resend error, network issue) is caught
-- and swallowed so it can never block or fail the underlying workflow action (assigning an issue,
-- submitting a DRI response, etc.) that triggered the notification.
--
-- Sender is Resend's sandbox address (onboarding@resend.dev), which only delivers to the email
-- address the Resend account itself signed up with, until a real domain is verified — see chat.
-- Once a domain is verified, updating the `from` address below is a one-line follow-up migration.

create extension if not exists pg_net;

create or replace function create_notification(
  p_user_id uuid, p_type text, p_text text, p_link text, p_issue_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_api_key text;
  v_subject text;
begin
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
      return; -- no key configured yet — in-app notification above already succeeded
    end if;

    v_subject := case p_type
      when 'assignment' then 'New issue assigned to you'
      when 'resolved' then 'Your reported issue was resolved — awaiting your verification'
      when 'reopened' then 'An issue was reopened and needs your attention'
      else 'TPM Monitoring Platform notification'
    end;

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_api_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'from', 'TPM Monitoring Platform <onboarding@resend.dev>',
        'to', jsonb_build_array(v_email),
        'subject', v_subject,
        'html',
          '<p>' || p_text || '</p>' ||
          case when p_link is not null
            then '<p><a href="https://tpm-monitoring-platform.vercel.app' || p_link || '">View in the platform</a></p>'
            else ''
          end
      ),
      timeout_milliseconds := 8000
    );
  exception when others then
    -- Best-effort — never let an email problem fail the caller's transaction.
    null;
  end;
end;
$$;


-- ===== 0022_issue_photos_unique.sql =====
-- One MOV + one selfie per (issue, stage) is the actual usage pattern (see PhotoInsertDto /
-- uploadPhoto in the Android app — storage path is always "<issue_id>/<stage>_<kind>.jpg", so the
-- file itself already overwrites on retry via upsert=true). The DB row was never given the
-- matching constraint, so a retried sync could leave duplicate issue_photos rows pointing at the
-- same (now-overwritten) storage path. Add the constraint so the app-side fix (upsert instead of
-- plain insert, same change made to issue_gps_captures' existing unique(issue_id, stage) handling)
-- has something to target. No existing duplicates as of this migration (checked before applying).
alter table issue_photos add constraint issue_photos_issue_id_stage_kind_key unique (issue_id, stage, kind);


-- ===== 0023_gps_photos_update_policy.sql =====
-- The Android app now upserts (not plain-inserts) issue_gps_captures/issue_photos so a sync retry
-- after a partial failure can safely re-run without hitting the unique(issue_id, stage[, kind])
-- constraints (see migration 0022 and DECISIONS.md). An upsert whose conflict-resolution path
-- actually hits an existing row is, to Postgres, an UPDATE — and both tables only ever had
-- SELECT/INSERT (issue_gps_captures) or SELECT/INSERT/DELETE (issue_photos) policies. With no
-- UPDATE policy, RLS default-denies it: "new row violates row-level security policy (USING
-- expression)". Adding UPDATE policies with the same shape as each table's existing INSERT policy.
create policy issue_gps_captures_update on issue_gps_captures for update to authenticated
  using (current_user_role() <> 'viewer' and exists (select 1 from issues i where i.id = issue_gps_captures.issue_id))
  with check (current_user_role() <> 'viewer' and exists (select 1 from issues i where i.id = issue_gps_captures.issue_id));

create policy issue_photos_update on issue_photos for update to authenticated
  using (current_user_role() <> 'viewer' and exists (select 1 from issues i where i.id = issue_photos.issue_id))
  with check (current_user_role() <> 'viewer' and exists (select 1 from issues i where i.id = issue_photos.issue_id));


-- ===== 0024_verification_rpcs_idempotent.sql =====
-- reject_and_reopen_issue/verify_and_close_issue push from the mobile app's sync queue, which
-- retries a submission from the top if ANY step later in the same push fails (GPS capture, photo
-- upload) — see the Android repo's SupabaseSyncApiService.pushFinalVerification. Before the
-- GPS/photo upsert fix (migration 0022/0023 + the matching Android change), a retry after the RPC
-- had already succeeded would call it again — reject_and_reopen_issue's `where status = 'resolved'`
-- guard then permanently failed every subsequent retry (the issue is now correctly 'reopened', not
-- 'resolved' — a real state, just not the one this stale retry expects), leaving that queue item
-- stuck forever with no way to succeed. Reproduced live: see chat, issue ISS-1073.
--
-- Fix: tolerate being re-called when the issue is already in the exact state this call would
-- produce, treating it as a successful no-op rather than an error — and skip re-inserting
-- history/notifications in that case so a stuck-then-retried client doesn't spam duplicates.
create or replace function reject_and_reopen_issue(p_issue_id uuid, p_comment text)
returns issues language plpgsql as $$
declare
  v_issue issues;
  v_already_reopened boolean;
begin
  if coalesce(trim(p_comment), '') = '' then
    raise exception 'A comment explaining why the issue remains unresolved is required';
  end if;

  select (status = 'reopened') into v_already_reopened from issues where id = p_issue_id;

  update issues set status = 'reopened'
    where id = p_issue_id and status in ('resolved', 'reopened')
    returning * into v_issue;
  if not found then
    raise exception 'Issue not found, not awaiting verification, or not permitted';
  end if;

  if not coalesce(v_already_reopened, false) then
    insert into issue_history (issue_id, actor_id, actor_label, action, note) values
      (p_issue_id, auth.uid(), my_name(), 'Final Verification — Not Resolved', p_comment),
      (p_issue_id, auth.uid(), my_name(), 'Issue Reopened', 'Routed back to ' ||
        coalesce((select name from profiles where id = v_issue.assigned_dri), 'the assigned DRI') || '.');

    if v_issue.assigned_dri is not null then
      perform create_notification(v_issue.assigned_dri, 'reopened',
        v_issue.code || ' was reopened — additional action required', '/issues/' || v_issue.id, v_issue.id);
    end if;
  end if;

  return v_issue;
end;
$$;

create or replace function verify_and_close_issue(p_issue_id uuid, p_note text default null)
returns issues language plpgsql as $$
declare
  v_issue issues;
  v_already_closed boolean;
begin
  select (status = 'verified_closed') into v_already_closed from issues where id = p_issue_id;

  update issues set status = 'verified_closed', verified_by = auth.uid(), resolution_date = now()
    where id = p_issue_id
    returning * into v_issue;
  if not found then raise exception 'Issue not found or not permitted'; end if;

  if not coalesce(v_already_closed, false) then
    insert into issue_history (issue_id, actor_id, actor_label, action, note)
    values (p_issue_id, auth.uid(), my_name(), 'Verified and closed',
      coalesce(p_note, 'Confirmed resolution during follow-up visit.'));
  end if;

  return v_issue;
end;
$$;


-- ===== 0025_dri_response_rpcs_idempotent.sql =====
-- Same class of bug as migration 0024, on the DRI-response side: SupabaseSyncApiService.
-- pushDriResponse calls submit_dri_response (always) and record_corrective_action (whenever the
-- response is "Resolved") unconditionally on every push attempt, with no guard against having
-- already succeeded on a prior attempt whose later step (GPS capture / photo upload) then failed
-- before migration 0022/0023's fix. Reproduced live: one test issue (ISS-1073) picked up ~40
-- duplicate "Response submitted"/"Corrective action recorded" history rows from repeated retries
-- before the fix — see chat. Neither RPC had a hard status guard (unlike reject_and_reopen_issue),
-- so this didn't block sync, it just silently spammed history rows and (with migration 0021's
-- email hookup) would send duplicate notifications/emails on every retry too.
--
-- Fix: detect "this exact response/action was already recorded" (the column already holds the
-- same value — both start null and are only ever written by these functions, so equality is a
-- reliable idempotency signal) and skip the history/notification insert in that case, same pattern
-- as 0024. The status/column UPDATE itself is left unconditional — re-applying the same value is
-- harmless and keeps the function simple.
create or replace function submit_dri_response(p_issue_id uuid, p_response text, p_note text default null)
returns issues language plpgsql as $$
declare
  v_issue issues;
  v_already_applied boolean;
begin
  if not exists (select 1 from issues where id = p_issue_id and assigned_dri = auth.uid())
     and not is_super_admin() then
    raise exception 'Only the assigned DRI may submit this response';
  end if;

  select (dri_response is not distinct from p_response) into v_already_applied
    from issues where id = p_issue_id;

  update issues set status = 'in_progress', dri_response = p_response
    where id = p_issue_id
    returning * into v_issue;
  if not found then raise exception 'Issue not found or not permitted'; end if;

  if not coalesce(v_already_applied, false) then
    insert into issue_history (issue_id, actor_id, actor_label, action, note)
    values (p_issue_id, auth.uid(), my_name(), 'Response submitted', coalesce(p_note, p_response));
  end if;

  return v_issue;
end;
$$;

create or replace function record_corrective_action(p_issue_id uuid, p_action_taken text, p_note text default null)
returns issues language plpgsql as $$
declare
  v_issue issues;
  v_already_applied boolean;
begin
  if not exists (select 1 from issues where id = p_issue_id and assigned_dri = auth.uid())
     and not is_super_admin() then
    raise exception 'Only the assigned DRI may record corrective action';
  end if;

  select (corrective_action is not distinct from p_action_taken) into v_already_applied
    from issues where id = p_issue_id;

  update issues set status = 'resolved', corrective_action = p_action_taken
    where id = p_issue_id
    returning * into v_issue;
  if not found then raise exception 'Issue not found or not permitted'; end if;

  if not coalesce(v_already_applied, false) then
    insert into issue_history (issue_id, actor_id, actor_label, action, note)
    values (p_issue_id, auth.uid(), my_name(), 'Corrective action recorded', coalesce(p_note, p_action_taken));

    if v_issue.reported_by is not null then
      perform create_notification(v_issue.reported_by, 'resolved',
        v_issue.code || ' is ready for verification', '/issues/' || v_issue.id, v_issue.id);
    end if;
  end if;

  return v_issue;
end;
$$;


-- ===== 0026_structured_issue_id.sql =====
-- Structured Issue ID: LGA3-WARD3-CAT3-YY-INITIALS### (e.g. KMC-NAS-ROA-26-NI001).
--
-- Replaces how `issues.code` is *computed* (still the same column, same field everywhere in
-- the app — see DECISIONS.md #11). `code` was a generated stored column derived from a plain
-- bigserial ('ISS-' || (1000 + issue_number)); it becomes an ordinary text column populated by
-- a BEFORE INSERT trigger instead, because the new format needs table lookups (lga/ward/
-- category/profile) and a mutable, atomically-incremented counter — neither of which a
-- Postgres GENERATED ALWAYS AS expression can do (must be deterministic, same-row-only).
--
-- Existing rows are NOT touched: `ALTER COLUMN ... DROP EXPRESSION` preserves already-stored
-- values as plain data, so every pre-migration issue keeps its original ISS-NNNN code forever.
-- Only new inserts after this migration get the new format.

-- ─── 1. Reference-table abbreviation columns ────────────────────────────────────────────────

-- categories: only 10 rows, hand-curated directly (no algorithm needed).
alter table categories add column if not exists abbr text;

update categories set abbr = case name
  when 'Water & Sanitation Failure' then 'WSF'
  when 'Supply Chain / Stockout'    then 'SCS'
  when 'Infrastructure Damage'      then 'INF'
  when 'Safety Incident'            then 'SAF'
  when 'Service Quality Complaint'  then 'SVC'
  when 'Data Discrepancy'           then 'DAT'
  when 'Staff Absenteeism'          then 'STA'
  when 'Equipment Malfunction'      then 'EQP'
  when 'Environmental Hazard'       then 'ENV'
  when 'Community Grievance'        then 'COM'
  else abbr
end
where abbr is null;

alter table categories alter column abbr set not null;
alter table categories add constraint categories_abbr_format check (abbr ~ '^[A-Z]{3}$');
alter table categories add constraint categories_abbr_unique unique (abbr);

comment on column categories.abbr is
  'Curated 3-letter code used as the CAT3 segment of issues.code (structured Issue ID). '
  'Hand-set for every category — see migration 0026 and DECISIONS.md #11.';

-- lgas / wards: 774 + ~9,400 rows — too many to hand-curate, so backfilled by a deterministic
-- collision-safe algorithm below. Plain editable text columns afterward: correct any specific
-- one later with a normal UPDATE, no code change needed (only future issues pick it up).

create or replace function generate_abbr_candidates(p_name text)
returns text[]
language plpgsql
immutable
as $$
declare
  base text;
  candidates text[] := array[]::text[];
  i int;
  c1 int;
  c2 int;
begin
  base := upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z]', '', 'g'));
  if length(base) = 0 then
    base := 'XXX';
  elsif length(base) < 3 then
    base := rpad(base, 3, 'X');
  end if;

  -- 1) first three letters of the (letters-only) name
  candidates := candidates || left(base, 3);

  -- 2) first two letters + scan forward through the remaining letters
  if length(base) > 3 then
    for i in 3..length(base) loop
      candidates := candidates || (left(base, 2) || substr(base, i, 1));
    end loop;
  end if;

  -- 3) guaranteed-unique fallback: first letter + AA..ZZ (676 combinations)
  for c1 in 0..25 loop
    for c2 in 0..25 loop
      candidates := candidates || (left(base, 1) || chr(65 + c1) || chr(65 + c2));
    end loop;
  end loop;

  return candidates;
end;
$$;

comment on function generate_abbr_candidates(text) is
  'Ordered list of candidate 3-letter codes for a place/category name, most-natural first, '
  'ending in a guaranteed-unique first-letter+AA..ZZ fallback. Used to backfill and to derive '
  'codes for any lga/ward/category row added later. See DECISIONS.md #11.';

alter table lgas add column if not exists abbr text;
alter table wards add column if not exists abbr text;

-- One-time backfill: lgas (globally unique — LGA3 alone must disambiguate).
do $$
declare
  r record;
  cand text[];
  c text;
  chosen text;
begin
  for r in select id, name from lgas where abbr is null order by name, id loop
    cand := generate_abbr_candidates(r.name);
    chosen := null;
    foreach c in array cand loop
      if not exists (select 1 from lgas where abbr = c) then
        chosen := c;
        exit;
      end if;
    end loop;
    if chosen is null then
      raise exception 'Could not derive a unique abbr for lga % (%)', r.name, r.id;
    end if;
    update lgas set abbr = chosen where id = r.id;
  end loop;
end;
$$;

-- One-time backfill: wards (unique per LGA, not globally — the ID format's LGA3 segment
-- already disambiguates, so two different LGAs may reuse the same ward abbr).
do $$
declare
  r record;
  cand text[];
  c text;
  chosen text;
begin
  for r in select id, lga_id, name from wards where abbr is null order by lga_id, name, id loop
    cand := generate_abbr_candidates(r.name);
    chosen := null;
    foreach c in array cand loop
      if not exists (select 1 from wards where lga_id = r.lga_id and abbr = c) then
        chosen := c;
        exit;
      end if;
    end loop;
    if chosen is null then
      raise exception 'Could not derive a unique abbr for ward % in lga % (%)', r.name, r.lga_id, r.id;
    end if;
    update wards set abbr = chosen where id = r.id;
  end loop;
end;
$$;

alter table lgas alter column abbr set not null;
alter table lgas add constraint lgas_abbr_format check (abbr ~ '^[A-Z]{3}$');
alter table lgas add constraint lgas_abbr_unique unique (abbr);

alter table wards alter column abbr set not null;
alter table wards add constraint wards_abbr_format check (abbr ~ '^[A-Z]{3}$');
alter table wards add constraint wards_abbr_unique unique (lga_id, abbr);

comment on column lgas.abbr is
  'Algorithmically-derived 3-letter code (globally unique) used as the LGA3 segment of '
  'issues.code. Plain editable column — correct a specific one with UPDATE any time; only '
  'future issues for that LGA pick up the change. See migration 0026 and DECISIONS.md #11.';
comment on column wards.abbr is
  'Algorithmically-derived 3-letter code (unique within its LGA, not globally) used as the '
  'WARD3 segment of issues.code. Plain editable column, same correction story as lgas.abbr. '
  'See migration 0026 and DECISIONS.md #11.';

-- Keep abbr populated for any lga/ward row added after this migration (boundaries are
-- effectively static, but this closes the gap so abbr is never silently null going forward).

create or replace function lgas_derive_abbr_trigger()
returns trigger language plpgsql as $$
declare
  cand text[];
  c text;
begin
  if new.abbr is null then
    cand := generate_abbr_candidates(new.name);
    foreach c in array cand loop
      if not exists (select 1 from lgas where abbr = c) then
        new.abbr := c;
        exit;
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create trigger lgas_set_abbr
  before insert on lgas
  for each row execute function lgas_derive_abbr_trigger();

create or replace function wards_derive_abbr_trigger()
returns trigger language plpgsql as $$
declare
  cand text[];
  c text;
begin
  if new.abbr is null then
    cand := generate_abbr_candidates(new.name);
    foreach c in array cand loop
      if not exists (select 1 from wards where lga_id = new.lga_id and abbr = c) then
        new.abbr := c;
        exit;
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create trigger wards_set_abbr
  before insert on wards
  for each row execute function wards_derive_abbr_trigger();

-- ─── 2. profiles.initials ────────────────────────────────────────────────────────────────────

alter table profiles add column if not exists initials text;

create or replace function derive_initials(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  tokens text[];
  first_letter text;
  last_letter text;
begin
  tokens := regexp_split_to_array(trim(coalesce(p_name, '')), '\s+');
  if tokens is null or array_length(tokens, 1) is null or tokens[1] = '' then
    return 'XX';
  end if;
  first_letter := upper(substr(tokens[1], 1, 1));
  last_letter := upper(substr(tokens[array_length(tokens, 1)], 1, 1));
  if first_letter is null or first_letter = '' then
    first_letter := 'X';
  end if;
  if last_letter is null or last_letter = '' then
    last_letter := first_letter;
  end if;
  return first_letter || last_letter;
end;
$$;

comment on function derive_initials(text) is
  'First letter of the first name-token + first letter of the last name-token, e.g. '
  '"Najib Isah" -> NI. Single-word names double their first letter. Fallback XX if empty. '
  'Used for the INITIALS segment of issues.code. See DECISIONS.md #11.';

update profiles set initials = derive_initials(name) where initials is null;

alter table profiles alter column initials set not null;
alter table profiles add constraint profiles_initials_format check (initials ~ '^[A-Z]{2}$');

comment on column profiles.initials is
  'Auto-derived from name (see derive_initials()) when null; a manually-corrected value is '
  'never overwritten by a later name edit. Used as the INITIALS segment of issues.code.';

create or replace function profiles_derive_initials_trigger()
returns trigger language plpgsql as $$
begin
  if new.initials is null then
    new.initials := derive_initials(new.name);
  end if;
  return new;
end;
$$;

create trigger profiles_set_initials
  before insert or update of name on profiles
  for each row execute function profiles_derive_initials_trigger();

-- ─── 3. Atomic per-(prefix, year, initials) sequence counter ───────────────────────────────

create table issue_id_counters (
  prefix text not null,
  year smallint not null,
  initials text not null,
  last_number int not null default 0,
  primary key (prefix, year, initials)
);

alter table issue_id_counters enable row level security;
-- Deliberately no policies: only reachable through generate_issue_id() (security definer)
-- below, matching the existing current_user_role()/in_scope() pattern in 0007.

comment on table issue_id_counters is
  'Atomic sequence counter backing issues.code, scoped by (LGA+WARD+CAT prefix, year, '
  'reporter initials) exactly as specified — two different users who happen to share initials '
  'intentionally share a counter bucket (their sequence numbers interleave); a different '
  'prefix or different initials always gets its own 001. See migration 0026 and DECISIONS.md #11.';

-- ─── 4. generate_issue_id() + the issues.code triggers ─────────────────────────────────────

create or replace function generate_issue_id(
  p_lga_id uuid,
  p_ward_id uuid,
  p_category_id uuid,
  p_reported_by uuid,
  p_reported_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lga_abbr text;
  v_ward_abbr text;
  v_cat_abbr text;
  v_initials text;
  v_year text;
  v_prefix text;
  v_seq int;
begin
  select abbr into v_lga_abbr from lgas where id = p_lga_id;
  v_lga_abbr := coalesce(v_lga_abbr, 'GEN');

  if p_ward_id is not null then
    select abbr into v_ward_abbr from wards where id = p_ward_id;
  end if;
  v_ward_abbr := coalesce(v_ward_abbr, 'GEN');

  select abbr into v_cat_abbr from categories where id = p_category_id;
  v_cat_abbr := coalesce(v_cat_abbr, 'GEN');

  if p_reported_by is not null then
    select initials into v_initials from profiles where id = p_reported_by;
  end if;
  v_initials := coalesce(v_initials, 'XX');

  v_year := to_char(coalesce(p_reported_at, now()), 'YY');
  v_prefix := v_lga_abbr || '-' || v_ward_abbr || '-' || v_cat_abbr;

  insert into issue_id_counters (prefix, year, initials, last_number)
  values (v_prefix, v_year::smallint, v_initials, 1)
  on conflict (prefix, year, initials)
  do update set last_number = issue_id_counters.last_number + 1
  returning last_number into v_seq;

  return v_prefix || '-' || v_year || '-' || v_initials || lpad(v_seq::text, 3, '0');
end;
$$;

comment on function generate_issue_id(uuid, uuid, uuid, uuid, timestamptz) is
  'Formats a structured Issue ID (LGA3-WARD3-CAT3-YY-INITIALS###) and atomically claims the '
  'next sequence number via INSERT ... ON CONFLICT DO UPDATE (concurrency-safe, no lost '
  'updates under simultaneous inserts — never SELECT MAX()+1). GEN/XX fallbacks for a null '
  'ward/reporter. See migration 0026 and DECISIONS.md #11.';

create or replace function issues_set_code_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Unconditional: never trust a client-supplied code (see DECISIONS.md #11). No current
  -- caller (web report-issue action, Android sync, the demo seed script) ever sends `code` —
  -- this is a no-op for every real insert path today.
  new.code := generate_issue_id(new.lga_id, new.ward_id, new.category_id, new.reported_by, new.reported_at);
  return new;
end;
$$;

create trigger issues_set_code
  before insert on issues
  for each row execute function issues_set_code_trigger();

-- ─── 5. Immutability + uniqueness ───────────────────────────────────────────────────────────

alter table issues alter column code drop expression if exists;
alter table issues add constraint issues_code_unique unique (code);

create or replace function issues_protect_code_trigger()
returns trigger
language plpgsql
as $$
begin
  -- code is permanent once assigned at insert time — no update path may change it, regardless
  -- of role or what's submitted. See DECISIONS.md #11.
  new.code := old.code;
  return new;
end;
$$;

create trigger issues_protect_code
  before update on issues
  for each row execute function issues_protect_code_trigger();

comment on column issues.code is
  'Structured human-readable Issue ID: LGA3-WARD3-CAT3-YY-INITIALS### (e.g. KMC-NAS-ROA-26-'
  'NI001), generated server-side by the issues_set_code trigger at insert time and immutable '
  'thereafter (issues_protect_code trigger). Pre-migration rows keep their original ISS-NNNN '
  'value permanently -- only new inserts use the new format. Distinct from issues.mobile_code '
  '(Android offline placeholder, unrelated, unchanged). See migration 0026 and DECISIONS.md #11.';


-- ===== 0027_dashboard_stats_rpc.sql =====
-- Dashboard performance: replace "fetch every issue row, aggregate in JS" with one SQL
-- aggregate RPC, plus two indexes justified by real, currently-unindexed query patterns.
-- See the performance-investigation plan for the full root-cause trace.

-- ─── 1. get_dashboard_stats() ────────────────────────────────────────────────────────────────
--
-- Computes everything the Dashboard's KPI cards / donut / 14-day trend / state breakdown need
-- in one round trip, instead of pulling the entire `issues` table to the server and looping
-- over it in JavaScript. `security invoker` (the default — stated explicitly) means this runs
-- with the calling user's own privileges, so RLS on `issues`/`states` filters the aggregate
-- exactly as it filters today's row-by-row select — unlike the security-definer helper
-- functions in 0007 (current_user_role()/in_scope()), which exist to be called *inside* a
-- policy and must bypass RLS to avoid recursion. This function IS a query a policy applies to.
create or replace function get_dashboard_stats()
returns json
language sql
stable
security invoker
as $$
  select json_build_object(
    'total', (select count(*) from issues),
    'by_status', (
      select coalesce(json_object_agg(status, cnt), '{}'::json)
      from (select status, count(*) cnt from issues group by status) s
    ),
    -- Matches the current JS exactly: Math.round() per-row day-diff (not average-then-round),
    -- Math.max(0, ...) floor, then averaged and rounded to 1 decimal.
    'avg_resolution_days', (
      select round(avg(greatest(0, round(extract(epoch from (resolution_date - reported_at)) / 86400))), 1)
      from issues
      where resolution_date is not null
    ),
    -- Buckets by UTC calendar date, matching the current code's actual behavior (it buckets via
    -- reported_at's ISO string prefix, i.e. UTC; Vercel serverless functions run in UTC, so the
    -- day-of-month label the page renders already coincides with this in production).
    'trend_14d', (
      select json_agg(json_build_object('day', d::date, 'count', coalesce(c.cnt, 0)) order by d)
      from generate_series((current_date - interval '13 days')::date, current_date::date, interval '1 day') d
      left join (
        select (reported_at at time zone 'utc')::date rd, count(*) cnt
        from issues
        where reported_at >= (current_date - interval '13 days')
        group by rd
      ) c on c.rd = d::date
    ),
    'by_state', (
      select coalesce(json_agg(x), '[]'::json) from (
        select st.name, count(i.id) cnt
        from issues i
        join states st on st.id = i.state_id
        group by st.name
        order by cnt desc
        limit 6
      ) x
    )
  );
$$;

grant execute on function get_dashboard_stats() to authenticated;

-- ─── 2. issue_history: standalone occurred_at index ─────────────────────────────────────────
--
-- The existing issue_history_issue_id_idx is (issue_id, occurred_at) — useless for the
-- Dashboard's Activity Timeline query, which orders by occurred_at desc with NO issue_id
-- filter. Needs its own leading-column index.
create index if not exists issue_history_occurred_at_idx on issue_history (occurred_at desc);

-- ─── 3. Issues search: trigram indexes for ilike ────────────────────────────────────────────
--
-- issues/page.tsx's search filters via `description.ilike.%x%,code.ilike.%x%` — both
-- leading-wildcard, which a plain btree index can never use (forces a sequential scan,
-- linearly worse as the table grows). pg_trgm + GIN is the standard fix for this exact,
-- real query pattern.
create extension if not exists pg_trgm;

create index if not exists issues_description_trgm_idx on issues using gin (description gin_trgm_ops);
create index if not exists issues_code_trgm_idx on issues using gin (code gin_trgm_ops);


-- ===== 0028_time_efficiency_stats_rpc.sql =====
-- Time Efficiency Analysis: a stage-by-stage breakdown of the issue workflow, computed from the
-- real, already-written issue_history timestamps (no new instrumentation, no mock data). See the
-- Time Efficiency Analysis plan / DECISIONS.md for the full rationale.
--
-- Analytics only ever measures one span (issues.reported_at -> issues.resolution_date, "discovery
-- to closure"). This computes the four stage-to-stage intervals inside that span instead:
-- report -> assign -> first response -> corrective action -> verify/close.
create or replace function get_time_efficiency_stats()
returns json
language sql
stable
security invoker  -- RLS-respecting, same reasoning as get_dashboard_stats (0027) — this computes
                   -- over issues/issue_history the caller can already see, nothing more.
as $$
  with stage_times as (
    select
      i.id, i.priority, i.reported_at,
      -- FIRST occurrence of each action per issue. A reopened issue's second pass through
      -- corrective-action/verification isn't separately tracked here — this is an aggregate
      -- efficiency view, not a per-issue audit trail (that's the Issue Detail Activity History).
      min(h.occurred_at) filter (where h.action in ('Assigned to DRI','Self-assigned by DRI')) as assigned_at,
      min(h.occurred_at) filter (where h.action = 'Response submitted') as responded_at,
      min(h.occurred_at) filter (where h.action = 'Corrective action recorded') as corrective_at,
      min(h.occurred_at) filter (where h.action = 'Verified and closed') as verified_at
    from issues i
    left join issue_history h on h.issue_id = i.id
    group by i.id, i.priority, i.reported_at
  )
  select json_build_object(
    -- Each average filters out issues that haven't reached that stage yet (null, not 0) — a
    -- partially-progressed issue contributes to the stages it HAS reached, not ones it hasn't.
    'avg_report_to_assign_hours',
      (select round(avg(extract(epoch from (assigned_at - reported_at)) / 3600)::numeric, 1)
       from stage_times where assigned_at is not null),
    'avg_assign_to_response_hours',
      (select round(avg(extract(epoch from (responded_at - assigned_at)) / 3600)::numeric, 1)
       from stage_times where responded_at is not null and assigned_at is not null),
    'avg_response_to_corrective_hours',
      (select round(avg(extract(epoch from (corrective_at - responded_at)) / 3600)::numeric, 1)
       from stage_times where corrective_at is not null and responded_at is not null),
    'avg_corrective_to_verify_hours',
      (select round(avg(extract(epoch from (verified_at - corrective_at)) / 3600)::numeric, 1)
       from stage_times where verified_at is not null and corrective_at is not null),
    'by_priority', (
      select coalesce(json_agg(x), '[]'::json) from (
        select
          priority,
          count(*) filter (where verified_at is not null) as resolved_count,
          round((avg(extract(epoch from (verified_at - reported_at)) / 86400)
                 filter (where verified_at is not null))::numeric, 1) as avg_days
        from stage_times
        group by priority
        order by array_position(array['critical','high','medium','low'], priority::text)
      ) x
    )
  );
$$;

grant execute on function get_time_efficiency_stats() to authenticated;


-- ===== 0029_data_sets_search_indexes.sql =====
-- TPM Monitoring Platform — schema migration 29
-- Supports the Data Sets screen's move to real server-side pagination/search
-- (see DECISIONS.md #18, closing the loop opened in #17). settlements has
-- 354,148 rows and activity_sites has 32,201 — the screen used to
-- unconditionally select("*") both, which PostgREST silently capped at its
-- configured max-rows (observed 1000 here), so the admin never saw the real
-- data. That's now replaced with .range() pagination plus a search/filter UI
-- (name/state/LGA substring search, status filter), which needs real index
-- support at this scale rather than a sequential scan per request.
--
-- NOTE: these are plain (non-concurrent) CREATE INDEX statements, matching
-- every other migration in this repo — building the trigram indexes below
-- will briefly hold a lock against writes on these two tables. Run this in a
-- low-traffic window.

create extension if not exists pg_trgm;

-- Equality filters (State / LGA dropdowns in the new filter bar).
create index settlements_statename_lganame_idx on settlements (statename, lganame);
create index activity_sites_statename_lganame_idx on activity_sites (statename, lganame);

-- Substring search (the "Search…" box, `ilike '%term%'` across name/state/LGA)
-- — a leading wildcard can't use a btree index, so these are trigram GIN
-- indexes instead. One per column so Postgres can bitmap-OR across them for
-- the .or(name.ilike...,statename.ilike...,lganame.ilike...) query.
create index settlements_settlementname_trgm_idx on settlements using gin (settlementname gin_trgm_ops);
create index settlements_statename_trgm_idx on settlements using gin (statename gin_trgm_ops);
create index settlements_lganame_trgm_idx on settlements using gin (lganame gin_trgm_ops);

create index activity_sites_activitysitename_trgm_idx on activity_sites using gin (activitysitename gin_trgm_ops);
create index activity_sites_statename_trgm_idx on activity_sites using gin (statename gin_trgm_ops);
create index activity_sites_lganame_trgm_idx on activity_sites using gin (lganame gin_trgm_ops);


-- ===== 0030_download_requests.sql =====
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


-- ===== 0031_profile_fk_set_null_on_delete.sql =====
-- TPM Monitoring Platform — schema migration 31
-- Fixes "Database error deleting user" on permanent user removal.
--
-- Root cause (confirmed against the live database, not assumed): deleting an auth.users row
-- cascades to delete its profiles row (`profiles_id_fkey ... ON DELETE CASCADE`, migration 0003).
-- But 12 columns across 8 tables reference profiles(id) with the default NO ACTION, so if the
-- profile being deleted is referenced anywhere in operational/historical data, that cascade fails
-- with a foreign-key violation and the whole auth.users DELETE rolls back — GoTrue surfaces this
-- as the generic "Database error deleting user". Reproduced directly: deleting profile
-- ffd4596b-25c1-4a4b-89cd-b22c7abe8f92 (Adam najib, a DRI with 3 assigned issues) failed with
-- "violates foreign key constraint issues_assigned_dri_fkey".
--
-- Fix: these 12 columns all identify *who did something*, not *what happened* — the operational/
-- audit record (the issue, the history entry, the photo, the GPS capture, the settlement, the
-- settings row) must survive the user's removal. Switching them to ON DELETE SET NULL preserves
-- every one of those records while letting the now-meaningless user reference clear itself, so a
-- Super Admin can finally delete the auth user without deleting any historical data.
--
-- Deliberately NOT touched: download_requests.requester_id and notifications.user_id are already
-- ON DELETE CASCADE (migration 0030 / 0006) and NOT NULL — both are genuinely "this row belongs to
-- that user" data (a viewer's own download request, a user's own notification inbox), not a
-- historical record ABOUT something else, so cascading them away with the account is correct and
-- is left as-is here.

alter table issues drop constraint issues_reported_by_fkey;
alter table issues add constraint issues_reported_by_fkey
  foreign key (reported_by) references profiles(id) on delete set null;

alter table issues drop constraint issues_assigned_dri_fkey;
alter table issues add constraint issues_assigned_dri_fkey
  foreign key (assigned_dri) references profiles(id) on delete set null;

alter table issues drop constraint issues_verified_by_fkey;
alter table issues add constraint issues_verified_by_fkey
  foreign key (verified_by) references profiles(id) on delete set null;

alter table issue_history drop constraint issue_history_actor_id_fkey;
alter table issue_history add constraint issue_history_actor_id_fkey
  foreign key (actor_id) references profiles(id) on delete set null;

alter table issue_photos drop constraint issue_photos_uploaded_by_fkey;
alter table issue_photos add constraint issue_photos_uploaded_by_fkey
  foreign key (uploaded_by) references profiles(id) on delete set null;

alter table issue_gps_captures drop constraint issue_gps_captures_captured_by_fkey;
alter table issue_gps_captures add constraint issue_gps_captures_captured_by_fkey
  foreign key (captured_by) references profiles(id) on delete set null;

alter table settlements drop constraint settlements_submitted_by_fkey;
alter table settlements add constraint settlements_submitted_by_fkey
  foreign key (submitted_by) references profiles(id) on delete set null;

alter table settlements drop constraint settlements_reviewed_by_fkey;
alter table settlements add constraint settlements_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

alter table activity_sites drop constraint activity_sites_submitted_by_fkey;
alter table activity_sites add constraint activity_sites_submitted_by_fkey
  foreign key (submitted_by) references profiles(id) on delete set null;

alter table activity_sites drop constraint activity_sites_reviewed_by_fkey;
alter table activity_sites add constraint activity_sites_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

alter table settings drop constraint settings_updated_by_fkey;
alter table settings add constraint settings_updated_by_fkey
  foreign key (updated_by) references profiles(id) on delete set null;

alter table download_requests drop constraint download_requests_reviewed_by_fkey;
alter table download_requests add constraint download_requests_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;


-- ===== 0031_state_coordinator_sector_schema.sql =====
-- State Coordinator review/approval workflow + DRI sector scoping — schema primitives only.
-- See DECISIONS.md #22.
--
-- Split into two migrations (0031/0032) because Postgres forbids using a freshly-added enum
-- value inside the same transaction that added it, and apply-one.js wraps each file in one
-- transaction — this file ONLY adds the new enum values/columns; 0032 (which must run after this
-- one has committed) does everything that actually references them: the new status default, RLS
-- policies, RPCs, and the category→sector data swap.

alter type user_role add value if not exists 'state_coordinator';
alter type issue_status add value if not exists 'pending_review';
alter type issue_status add value if not exists 'returned_for_correction';

-- ─── State Coordinator scope ─────────────────────────────────────────────────────────────────

-- A coordinator reviews/approves only Findings whose state_id matches this — see 0032's
-- issues_select/issues_update policies. Single state per coordinator (not a state, keep it
-- simple per the requested design); null for every other role.
alter table profiles add column if not exists managed_state_id uuid references states(id);

comment on column profiles.managed_state_id is
  'Only meaningful for role = state_coordinator: the single State this coordinator reviews and '
  'approves Findings for. Null for every other role. See migration 0032 and DECISIONS.md #22.';

-- ─── DRI sector scope ────────────────────────────────────────────────────────────────────────

-- Named assigned_category_id because it references the existing `categories` table, which 0032
-- relabels to "Sector" in user-facing terminology (and repopulates with the new sector list)
-- without renaming the underlying table/column — see DECISIONS.md #22/#23. Enforced at the RLS
-- level (0032's issues_select), not just the UI.
alter table profiles add column if not exists assigned_category_id uuid references categories(id);

comment on column profiles.assigned_category_id is
  'Only meaningful for role = dri: the single sector (categories row) this DRI may see/act on. '
  'Null for every other role. See migration 0032 and DECISIONS.md #22.';

-- ─── Category → Sector: legacy-preservation flag ────────────────────────────────────────────

-- Old categories were incident *types* (Water & Sanitation Failure, Infrastructure Damage, ...);
-- the new Sector list is humanitarian program *areas* (WASH, Nutrition, Health Services, ...) —
-- a different taxonomy, not a 1:1 rename. Rows referenced by existing Findings must keep their
-- name/id (so historical Findings keep an accurate label and their category_id FK stays intact)
-- but should stop being offered for new submissions — is_active is how 0032 achieves that
-- without deleting anything a Finding still points to.
alter table categories add column if not exists is_active boolean not null default true;

comment on column categories.is_active is
  'False for a legacy category kept only because existing Findings still reference it (see the '
  'category→sector migration 0032) — excluded from any "pick a sector" list for new Findings, '
  'still resolves correctly wherever an existing Finding displays its historical category/sector.';


-- ===== 0032_state_coordinator_sector_rls_rpcs.sql =====
-- State Coordinator review/approval workflow + DRI sector scoping — RLS, RPCs, and the
-- category→sector data swap. Must run after 0031 has committed (see its header comment for why).
-- See DECISIONS.md #22.

-- ─── 1. New Findings start in review, not "new" ────────────────────────────────────────────
-- Existing 'new'-status Findings are deliberately left untouched and keep flowing through the
-- pre-existing dri_self_assign/assign_issue paths (both unchanged below) — "treat existing
-- Findings as already-approved" per the agreed migration approach. Only Findings inserted after
-- this migration ever reach 'pending_review'.

alter table issues alter column status set default 'pending_review';

-- ─── 2. Category → Sector data swap ─────────────────────────────────────────────────────────
-- Old categories were incident *types*; the new Sector list is humanitarian program *areas* — a
-- different taxonomy, not a 1:1 rename (see 0031's is_active comment). Rows a real Finding still
-- references (Water & Sanitation Failure / Infrastructure Damage / Safety Incident) keep their
-- id/name so that Finding's historical label stays accurate, but stop being offered for new
-- submissions. The 7 rows nothing ever referenced are simply removed and replaced.

update categories set is_active = false
  where name in ('Water & Sanitation Failure', 'Infrastructure Damage', 'Safety Incident');

delete from categories
  where name in (
    'Supply Chain / Stockout', 'Service Quality Complaint', 'Data Discrepancy',
    'Staff Absenteeism', 'Equipment Malfunction', 'Environmental Hazard', 'Community Grievance'
  );

insert into categories (name, sort_order, abbr, is_active) values
  ('Protection & AAP', 0, 'PRO', true),
  ('Nutrition (OTP)', 1, 'NUT', true),
  ('Health Services', 2, 'HEA', true),
  ('WASH', 3, 'WAS', true),
  ('MHPSS Services', 4, 'MHP', true),
  ('Food Assistance', 5, 'FOD', true),
  ('Fraud', 6, 'FRA', true);

-- ─── 3. issues_select: narrow State Coordinator/DRI, preserve everyone else exactly ─────────
-- The previous policy was a single blanket `in_scope(project_id)` grant with no role condition
-- at all — every authenticated role, DRI included, could see every Finding in scope. Replaced
-- with the same effective access for super_admin/project_admin/tpm_supervisor/viewer, plus real
-- restriction for the two roles this item is actually about.

drop policy issues_select on issues;

create policy issues_select on issues for select to authenticated using (
  is_super_admin()
  or (
    current_user_role() = any (array['project_admin'::user_role, 'tpm_supervisor'::user_role, 'viewer'::user_role])
    and in_scope(project_id)
  )
  or (
    current_user_role() = 'state_coordinator'
    and state_id = (select managed_state_id from profiles where id = auth.uid())
  )
  or (
    -- Both conditions matter: assigned_dri alone isn't enough — see DECISIONS.md #22's note on
    -- why sector is re-checked here even though a State Coordinator should only ever assign
    -- within a DRI's sector; this is the actual enforcement, not just trusting that discipline.
    current_user_role() = 'dri'
    and assigned_dri = auth.uid()
    and category_id = (select assigned_category_id from profiles where id = auth.uid())
  )
);

-- ─── 4. issues_update: additive carve-out for the coordinator's own review actions ──────────
-- A separate policy (not touching the existing issues_update) so nothing about the tested
-- existing per-role rules changes — permissive policies OR together, so this only ever adds
-- access, never removes any.

create policy issues_update_state_coordinator on issues for update to authenticated using (
  current_user_role() = 'state_coordinator'
  and state_id = (select managed_state_id from profiles where id = auth.uid())
  and status = any (array['pending_review'::issue_status, 'returned_for_correction'::issue_status])
) with check (
  current_user_role() = 'state_coordinator'
  and state_id = (select managed_state_id from profiles where id = auth.uid())
);

-- ─── 5. create_notification: subject line for the new "returned" type ──────────────────────

create or replace function create_notification(p_user_id uuid, p_type text, p_text text, p_link text, p_issue_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_api_key text;
  v_subject text;
begin
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
      else 'TPM Monitoring Platform notification'
    end;

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_api_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'from', 'TPM Monitoring Platform <onboarding@resend.dev>',
        'to', jsonb_build_array(v_email),
        'subject', v_subject,
        'html',
          '<p>' || p_text || '</p>' ||
          case when p_link is not null
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

-- ─── 6. approve_and_assign_finding: the ONLY place a fresh assignment notification fires ────
-- Combined approve+assign in one action per the agreed design — a coordinator picks a DRI and
-- approves at once, rather than "Approved" being its own separately-persisted, unassigned status.
-- SECURITY INVOKER (no `security definer` — matches dri_self_assign/assign_issue's existing
-- convention): the UPDATE below runs as the caller and is genuinely gated by
-- issues_update_state_coordinator above, not just by the explicit role check.

create or replace function approve_and_assign_finding(p_issue_id uuid, p_dri_id uuid, p_note text default null)
returns issues
language plpgsql
as $$
declare
  v_issue issues;
  v_dri record;
begin
  if current_user_role() <> 'state_coordinator' then
    raise exception 'Only a State Coordinator may approve and assign a finding';
  end if;

  select id, name into v_dri from profiles where id = p_dri_id and role = 'dri';
  if not found then
    raise exception 'Selected user is not a DRI';
  end if;

  update issues set status = 'assigned', assigned_dri = p_dri_id
    where id = p_issue_id and status = any (array['pending_review'::issue_status, 'returned_for_correction'::issue_status])
    returning * into v_issue;
  if not found then
    raise exception 'Finding not found, not awaiting review, or not permitted';
  end if;

  insert into issue_history (issue_id, actor_id, actor_label, action, note) values
    (p_issue_id, auth.uid(), my_name(), 'Approved by State Coordinator', coalesce(p_note, 'Reviewed and approved.')),
    (p_issue_id, auth.uid(), my_name(), 'Assigned to DRI', 'Routed to ' || v_dri.name || ' for action.');

  -- The only call to create_notification for a newly-approved finding — deliberately absent from
  -- the initial insert path, per "do not notify the DRI until after approval and assignment".
  perform create_notification(p_dri_id, 'assignment',
    'You were assigned finding ' || v_issue.code, '/issues/' || v_issue.id, v_issue.id);

  return v_issue;
end;
$$;

-- ─── 7. return_finding_for_correction ───────────────────────────────────────────────────────

create or replace function return_finding_for_correction(p_issue_id uuid, p_comment text)
returns issues
language plpgsql
as $$
declare
  v_issue issues;
begin
  if current_user_role() <> 'state_coordinator' then
    raise exception 'Only a State Coordinator may return a finding for correction';
  end if;
  if coalesce(trim(p_comment), '') = '' then
    raise exception 'A comment explaining what needs correcting is required';
  end if;

  update issues set status = 'returned_for_correction'
    where id = p_issue_id and status = any (array['pending_review'::issue_status, 'returned_for_correction'::issue_status])
    returning * into v_issue;
  if not found then
    raise exception 'Finding not found, not awaiting review, or not permitted';
  end if;

  insert into issue_history (issue_id, actor_id, actor_label, action, note)
  values (p_issue_id, auth.uid(), my_name(), 'Returned for correction', p_comment);

  if v_issue.reported_by is not null then
    perform create_notification(v_issue.reported_by, 'returned',
      'Finding ' || v_issue.code || ' was returned for correction', '/issues/' || v_issue.id, v_issue.id);
  end if;

  return v_issue;
end;
$$;

-- ─── 8. edit_issue_submission: extend to the assigned State Coordinator ─────────────────────
-- Reuses the existing edit RPC rather than adding a parallel one — same fields, same history
-- event, just a second class of caller who may invoke it while the finding awaits their review.

create or replace function edit_issue_submission(p_issue_id uuid, p_category_id uuid, p_priority issue_priority, p_description text)
returns issues
language plpgsql
as $$
declare
  v_issue issues;
  v_coordinator_can_edit boolean;
begin
  select (
    current_user_role() = 'state_coordinator'
    and state_id = (select managed_state_id from profiles where id = auth.uid())
    and status = any (array['pending_review'::issue_status, 'returned_for_correction'::issue_status])
  ) into v_coordinator_can_edit
  from issues where id = p_issue_id;

  if not is_super_admin() and not coalesce(v_coordinator_can_edit, false) then
    raise exception 'Only Super Admin or the assigned State Coordinator may edit a submission';
  end if;

  update issues set category_id = p_category_id, priority = p_priority, description = p_description
    where id = p_issue_id
    returning * into v_issue;
  if not found then raise exception 'Finding not found'; end if;

  insert into issue_history (issue_id, actor_id, actor_label, action, note)
  values (p_issue_id, auth.uid(), my_name(), 'Submission edited', 'Corrected field data on this submission.');

  return v_issue;
end;
$$;


-- ===== 0033_state_coordinator_super_admin_override.sql =====
-- Fix: approve_and_assign_finding / return_finding_for_correction (migration 0032) rejected
-- Super Admin outright — every other workflow RPC in this codebase (dri_self_assign aside, which
-- is intentionally DRI-only) allows an is_super_admin() override; these two should too, per
-- DECISIONS.md #22 / spec item 16 ("Super Admin has appropriate full administrative access").
-- Also needs a matching RLS carve-out, since these run SECURITY INVOKER — is_super_admin()
-- already covers UPDATE via the pre-existing issues_update policy, so no policy change needed
-- here, only the two function bodies.

create or replace function approve_and_assign_finding(p_issue_id uuid, p_dri_id uuid, p_note text default null)
returns issues
language plpgsql
as $$
declare
  v_issue issues;
  v_dri record;
begin
  if current_user_role() <> 'state_coordinator' and not is_super_admin() then
    raise exception 'Only a State Coordinator may approve and assign a finding';
  end if;

  select id, name into v_dri from profiles where id = p_dri_id and role = 'dri';
  if not found then
    raise exception 'Selected user is not a DRI';
  end if;

  update issues set status = 'assigned', assigned_dri = p_dri_id
    where id = p_issue_id and status = any (array['pending_review'::issue_status, 'returned_for_correction'::issue_status])
    returning * into v_issue;
  if not found then
    raise exception 'Finding not found, not awaiting review, or not permitted';
  end if;

  insert into issue_history (issue_id, actor_id, actor_label, action, note) values
    (p_issue_id, auth.uid(), my_name(), 'Approved by State Coordinator', coalesce(p_note, 'Reviewed and approved.')),
    (p_issue_id, auth.uid(), my_name(), 'Assigned to DRI', 'Routed to ' || v_dri.name || ' for action.');

  perform create_notification(p_dri_id, 'assignment',
    'You were assigned finding ' || v_issue.code, '/issues/' || v_issue.id, v_issue.id);

  return v_issue;
end;
$$;

create or replace function return_finding_for_correction(p_issue_id uuid, p_comment text)
returns issues
language plpgsql
as $$
declare
  v_issue issues;
begin
  if current_user_role() <> 'state_coordinator' and not is_super_admin() then
    raise exception 'Only a State Coordinator may return a finding for correction';
  end if;
  if coalesce(trim(p_comment), '') = '' then
    raise exception 'A comment explaining what needs correcting is required';
  end if;

  update issues set status = 'returned_for_correction'
    where id = p_issue_id and status = any (array['pending_review'::issue_status, 'returned_for_correction'::issue_status])
    returning * into v_issue;
  if not found then
    raise exception 'Finding not found, not awaiting review, or not permitted';
  end if;

  insert into issue_history (issue_id, actor_id, actor_label, action, note)
  values (p_issue_id, auth.uid(), my_name(), 'Returned for correction', p_comment);

  if v_issue.reported_by is not null then
    perform create_notification(v_issue.reported_by, 'returned',
      'Finding ' || v_issue.code || ' was returned for correction', '/issues/' || v_issue.id, v_issue.id);
  end if;

  return v_issue;
end;
$$;


-- ===== 0034_findings_terminology_notification_text.sql =====
-- Item 6 (Issues → Findings terminology): the legacy assign_issue RPC's notification text still
-- said "issue" — the only remaining backend-generated user-facing string using the old wording
-- (approve_and_assign_finding/return_finding_for_correction/create_notification's subject lines
-- were already updated in migration 0032). Text-only change, no behavior/signature change.

create or replace function assign_issue(p_issue_id uuid, p_dri_id uuid, p_note text default null)
returns issues
language plpgsql
as $$
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
    'You were assigned finding ' || v_issue.code, '/issues/' || v_issue.id, v_issue.id);

  return v_issue;
end;
$$;


-- ===== 0035_finding_reported_terminology.sql =====
-- Item 5/6 terminology: the auto-log trigger (migration 0007) writes 'Issue reported' as the
-- issue_history.action text for every new Finding, and 'Field Monitor' as its actor_label
-- fallback — both now stale wording. Text-only change, going forward only:
--
-- Existing rows keep their historical 'Issue reported' value untouched (matches the same
-- preserve-history approach as the category→sector migration) — only NEW inserts after this get
-- the new wording. The Android app's issue_history.action == "Issue reported" matches (used to
-- find the reporter/location on a pulled issue) are updated in the same change to also accept
-- "Finding reported", so both old and new rows resolve correctly either way.

create or replace function log_issue_reported()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into issue_history (issue_id, actor_id, actor_label, action, note)
  values (
    new.id,
    new.reported_by,
    coalesce((select name from profiles where id = new.reported_by), 'TPM Field Monitor'),
    'Finding reported',
    'Field visit finding logged with photo evidence and GPS capture.'
  );
  return new;
end;
$$;


-- ===== 0036_download_approval_project_admin.sql =====
-- Item 7: download approval was Super Admin-only at the actual RLS/RPC level (decide_download_
-- request is SECURITY INVOKER — it only succeeds because of download_requests_update's RLS, which
-- was `is_super_admin()` alone). Adds Project Admin, scoped to their own project — matching the
-- same super_admin=unscoped / project_admin=in_scope(project_id) pattern already used everywhere
-- else in this schema (issues, profiles, ...), rather than granting platform-wide approval.
--
-- Additive policies (not a rewrite of the existing simple ones) — same reasoning as the State
-- Coordinator RLS in migration 0032: adding, never touching what already works for Super Admin.

create policy download_requests_select_project_admin on download_requests for select to authenticated using (
  current_user_role() = 'project_admin' and in_scope(project_id)
);

create policy download_requests_update_project_admin on download_requests for update to authenticated using (
  current_user_role() = 'project_admin' and in_scope(project_id)
) with check (
  current_user_role() = 'project_admin' and in_scope(project_id)
);

-- Notify the requester's own Project Admin(s) too, not just every Super Admin — they can now
-- actually act on it.
create or replace function create_download_request(p_resource_type text, p_format text, p_filters jsonb, p_reason text default null)
returns download_requests
language plpgsql
as $$
declare
  v_request download_requests;
  v_admin record;
begin
  insert into download_requests (requester_id, project_id, resource_type, format, filters, reason)
  values (auth.uid(), current_project_id(), p_resource_type, p_format, coalesce(p_filters, '{}'::jsonb), p_reason)
  returning * into v_request;

  for v_admin in
    select id from profiles where role = 'super_admin'
    union
    select id from profiles where role = 'project_admin' and project_id = v_request.project_id
  loop
    perform create_notification(v_admin.id, 'download_request',
      coalesce(my_name(), 'A viewer') || ' requested a ' || p_resource_type || ' download',
      '/download-requests', null);
  end loop;

  return v_request;
end;
$$;


-- ===== 0037_field_monitor_attendance.sql =====
-- Field Monitor Daily Attendance (Items 9-15). See DECISIONS.md #24.
--
-- One row per Field Monitor per day (enforced by a real unique constraint, not just app-level
-- validation — see Item 12). Captured passively (camera-only selfie + assignment-location photo,
-- device GPS, device identifier) with no manual location picker, so the containing state/LGA is
-- resolved server-side from the GPS point via the existing resolve_administrative_location() RPC
-- (migration 0012) — the same function the issue-report form already uses for the same purpose.

create table field_monitor_attendance (
  id uuid primary key default gen_random_uuid(),
  field_monitor_id uuid not null references profiles(id),
  project_id uuid references projects(id),
  attendance_date date not null,
  captured_at timestamptz not null,          -- device-side timestamp of capture
  lat numeric not null,
  lng numeric not null,
  gps_accuracy_m numeric,
  state_id uuid references states(id),       -- resolved server-side, see below; null if outside all known boundaries
  lga_id uuid references lgas(id),
  selfie_storage_path text not null,
  assignment_location_storage_path text not null,
  device_id text not null,                   -- Settings.Secure.ANDROID_ID — see DECISIONS.md #24
  status text not null default 'submitted',
  created_at timestamptz not null default now(),
  unique (field_monitor_id, attendance_date)
);

comment on table field_monitor_attendance is
  'One row per Field Monitor per day — the unique(field_monitor_id, attendance_date) constraint '
  'is the real duplicate-prevention boundary (Item 12), not just an app-level check. device_id is '
  'monitored (not blocked) for the same device submitting under multiple different Field '
  'Monitor accounts — see the admin view''s device-reuse flag, DECISIONS.md #24.';

alter table field_monitor_attendance enable row level security;

create policy field_monitor_attendance_insert on field_monitor_attendance for insert to authenticated
  with check (current_user_role() = 'tpm_supervisor' and field_monitor_id = auth.uid());

create policy field_monitor_attendance_select on field_monitor_attendance for select to authenticated using (
  field_monitor_id = auth.uid()
  or is_super_admin()
  or (current_user_role() = 'project_admin' and in_scope(project_id))
  or (current_user_role() = 'state_coordinator' and state_id = (select managed_state_id from profiles where id = auth.uid()))
);

-- No update/delete policy at all — an attendance record is an immutable capture, matching the
-- "do not allow the user to manipulate the attendance date" and general audit-trail spirit of
-- Item 11.2. Correcting a bad record is an out-of-scope admin/DB-level action, not a normal app flow.

create or replace function resolve_attendance_location()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_loc record;
begin
  select * into v_loc from resolve_administrative_location(new.lat, new.lng);
  new.state_id := v_loc.state_id;
  new.lga_id := v_loc.lga_id;
  if new.project_id is null then
    new.project_id := (select project_id from profiles where id = new.field_monitor_id);
  end if;
  return new;
end;
$$;

create trigger field_monitor_attendance_resolve_location
  before insert on field_monitor_attendance
  for each row execute function resolve_attendance_location();

-- ─── Storage: camera-only evidence photos, one folder per (field_monitor_id, attendance_date) ──

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attendance-evidence', 'attendance-evidence', false, 10485760, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "attendance-evidence insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attendance-evidence'
    and current_user_role() = 'tpm_supervisor'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "attendance-evidence select" on storage.objects for select to authenticated
  using (
    bucket_id = 'attendance-evidence'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or is_super_admin()
      or exists (
        select 1 from field_monitor_attendance a
        where a.field_monitor_id::text = (storage.foldername(name))[1]
          and (
            (current_user_role() = 'project_admin' and in_scope(a.project_id))
            or (current_user_role() = 'state_coordinator' and a.state_id = (select managed_state_id from profiles where id = auth.uid()))
          )
      )
    )
  );


-- ===== 0038_pin_back_managed_state_and_sector_self_edit.sql =====
-- Security audit finding (Item 16 — "role & data security enforced at the backend/DB level, not
-- just the frontend UI") — see DECISIONS.md #25.
--
-- enforce_profile_update_rules() (migration 0007) already pins `role`, `project_id`, and `status`
-- back to their old values whenever a non-admin edits their OWN profile row — profiles_update's
-- RLS policy allows `id = auth.uid()`, so without this trigger a user could self-escalate by
-- PATCHing their own row directly (bypassing every "only an admin assigns this" UI control).
--
-- Migration 0031 (state_coordinator_sector_schema) added two more columns to profiles that are
-- just as security-sensitive — `managed_state_id` (which state a State Coordinator can review/
-- approve Findings in) and `assigned_category_id` (which sector a DRI can see Findings for) — but
-- never added them to this same pin-back list. Confirmed exploitable: a `dri` account could PATCH
-- its own `assigned_category_id` to a different sector's id and immediately gain visibility into
-- that sector's Findings via issues_select's `category_id = profiles.assigned_category_id` check;
-- a `state_coordinator` account could do the same to `managed_state_id` and gain review/approve
-- authority over a state they were never assigned. Neither requires any UI bug — a raw REST call
-- with a valid session is enough, since Supabase's anon/authenticated model always allows that.
--
-- Fix: extend the exact same pin-back the trigger already does for role/project_id/status.
-- Project Admin (and Super Admin) are unaffected — they're the roles meant to set these two
-- columns for OTHER users (see UsersTable.tsx's Managed State / Assigned Sector fields), and this
-- only tightens the final "editing my own row" branch.

create or replace function enforce_profile_update_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  acting_role user_role;
begin
  if auth.uid() is null then
    return new; -- service-role / direct DB connection: trusted, no client-side guard needed
  end if;

  acting_role := current_user_role();

  if acting_role = 'super_admin' then
    return new;
  end if;

  if acting_role = 'project_admin' then
    if old.project_id is distinct from current_project_id() then
      raise exception 'Not authorized to modify profiles outside your project';
    end if;
    if new.role in ('super_admin', 'project_admin') and new.role is distinct from old.role then
      raise exception 'Project Admin cannot assign the % role', new.role;
    end if;
    return new;
  end if;

  if old.id is distinct from auth.uid() then
    raise exception 'Not authorized to modify other profiles';
  end if;
  new.role := old.role;
  new.project_id := old.project_id;
  new.status := old.status;
  new.managed_state_id := old.managed_state_id;
  new.assigned_category_id := old.assigned_category_id;
  return new;
end;
$$;


-- ===== 0039_add_warehouse_sector.sql =====
-- Add "Warehouse" to the Sector list (Item 4 follow-up — user-requested addition after the
-- original 7-sector rollout in migration 0032). Sectors are pure reference data — both the web
-- and Android apps fetch the category/sector list live from this table (getCategories()/
-- getAllCategories() on web, ReferenceRepository on mobile), nothing is hardcoded in either
-- client — so this insert alone is enough to make it appear everywhere: new-submission pickers,
-- filter dropdowns, GIS "Sector" filter, CSV export, DRI "Assigned Sector" field.
--
-- sort_order = 7 continues the existing sequence (Fraud is 6); abbr = 'WAR' passes the existing
-- categories_abbr_format check ('^[A-Z]{3}$') and categories_abbr_unique constraint.

insert into categories (name, sort_order, abbr, is_active) values
  ('Warehouse', 7, 'WAR', true);


-- ===== 0040_expand_issue_review_to_project_admin.sql =====
-- Item: "Issue Review & Approval Privileges" — expand review/edit/approve/return-for-correction
-- authority from State Coordinator-only to State Coordinator + Project Admin + Super Admin.
-- Super Admin already had this (migration 0033's override), so the real change here is adding
-- Project Admin. See DECISIONS.md #29 for the full design writeup.
--
-- No RLS policy changes needed at all: `issues_update`'s existing project_admin branch
-- (`current_user_role() = 'project_admin' and in_scope(project_id)`) already permits a Project
-- Admin to UPDATE any issue row in their own project — it was only ever the three RPCs' own
-- internal role checks (`raise exception` gates, evaluated before the UPDATE) blocking Project
-- Admin from reaching that already-permitted UPDATE. `approve_and_assign_finding`/
-- `return_finding_for_correction` additionally filter their own UPDATE's WHERE clause to
-- `status = any('pending_review','returned_for_correction')`, so that's the real state-transition
-- guard regardless of which RLS branch ultimately authorizes the row — a Project Admin still
-- can't approve/return an issue that isn't awaiting review, same as a State Coordinator.

-- ─── 1. Audit trail: actor_role column (Item: "Security & Audit Trail") ─────────────────────
-- issue_history already captures actor_id/actor_label (who), occurred_at (when), action/note
-- (what) — but not the role the actor was acting *as* at the time. That distinction only started
-- to matter once a review/approval action can legitimately come from three different roles;
-- before this, "Approved by State Coordinator" was a safe thing to hardcode into the action text
-- because only a State Coordinator (or a Super Admin override) could ever produce that row.
-- Additive, nullable — every pre-existing row simply has no recorded role, which is honest (it
-- wasn't ambiguous at the time) rather than backfilled with a guess.

alter table issue_history add column actor_role user_role;

-- Small reusable helper so the three RPCs below (and any future one) don't each hardcode their
-- own copy of the role→display-name mapping — mirrors the web's ROLE_LABELS map, kept in sync
-- manually same as every other web/mobile/DB terminology constant in this project.
create or replace function role_label(p_role user_role) returns text
language sql immutable as $$
  select case p_role
    when 'super_admin' then 'Super Admin'
    when 'project_admin' then 'Project Admin'
    when 'state_coordinator' then 'State Coordinator'
    when 'tpm_supervisor' then 'TPM Field Monitor'
    when 'dri' then 'Direct Responsible Individual (DRI)'
    when 'viewer' then 'Viewer'
  end
$$;

-- ─── 2. approve_and_assign_finding: add Project Admin ───────────────────────────────────────

create or replace function approve_and_assign_finding(p_issue_id uuid, p_dri_id uuid, p_note text default null)
returns issues language plpgsql security invoker as $$
declare
  v_issue issues;
  v_dri record;
  v_role user_role := current_user_role();
begin
  if v_role not in ('state_coordinator', 'project_admin') and not is_super_admin() then
    raise exception 'Only a State Coordinator, Project Admin, or Super Admin may approve and assign a finding';
  end if;

  select id, name into v_dri from profiles where id = p_dri_id and role = 'dri';
  if not found then
    raise exception 'Selected user is not a DRI';
  end if;

  update issues set status = 'assigned', assigned_dri = p_dri_id
    where id = p_issue_id and status = any (array['pending_review'::issue_status, 'returned_for_correction'::issue_status])
    returning * into v_issue;
  if not found then
    raise exception 'Finding not found, not awaiting review, or not permitted';
  end if;

  insert into issue_history (issue_id, actor_id, actor_label, actor_role, action, note) values
    (p_issue_id, auth.uid(), my_name(), v_role, 'Approved by ' || role_label(v_role), coalesce(p_note, 'Reviewed and approved.')),
    (p_issue_id, auth.uid(), my_name(), v_role, 'Assigned to DRI', 'Routed to ' || v_dri.name || ' for action.');

  -- DRI is notified only now — after approval AND assignment, never at registration. See the
  -- unaffected create_notification-on-'new'-status path this deliberately does not touch.
  perform create_notification(p_dri_id, 'assignment',
    'You were assigned finding ' || v_issue.code, '/issues/' || v_issue.id, v_issue.id);

  return v_issue;
end;
$$;

-- ─── 3. return_finding_for_correction: add Project Admin ────────────────────────────────────

create or replace function return_finding_for_correction(p_issue_id uuid, p_comment text)
returns issues language plpgsql security invoker as $$
declare
  v_issue issues;
  v_role user_role := current_user_role();
begin
  if v_role not in ('state_coordinator', 'project_admin') and not is_super_admin() then
    raise exception 'Only a State Coordinator, Project Admin, or Super Admin may return a finding for correction';
  end if;
  if coalesce(trim(p_comment), '') = '' then
    raise exception 'A comment explaining what needs correcting is required';
  end if;

  update issues set status = 'returned_for_correction'
    where id = p_issue_id and status = any (array['pending_review'::issue_status, 'returned_for_correction'::issue_status])
    returning * into v_issue;
  if not found then
    raise exception 'Finding not found, not awaiting review, or not permitted';
  end if;

  insert into issue_history (issue_id, actor_id, actor_label, actor_role, action, note)
  values (p_issue_id, auth.uid(), my_name(), v_role, 'Returned for correction by ' || role_label(v_role), p_comment);

  if v_issue.reported_by is not null then
    perform create_notification(v_issue.reported_by, 'returned',
      'Finding ' || v_issue.code || ' was returned for correction', '/issues/' || v_issue.id, v_issue.id);
  end if;

  return v_issue;
end;
$$;

-- ─── 4. edit_issue_submission: add Project Admin ────────────────────────────────────────────

create or replace function edit_issue_submission(p_issue_id uuid, p_category_id uuid, p_priority issue_priority, p_description text)
returns issues language plpgsql security invoker as $$
declare
  v_issue issues;
  v_reviewer_can_edit boolean;
  v_role user_role := current_user_role();
begin
  select (
    (
      (v_role = 'state_coordinator' and state_id = (select managed_state_id from profiles where id = auth.uid()))
      or (v_role = 'project_admin' and in_scope(project_id))
    )
    and status = any (array['pending_review'::issue_status, 'returned_for_correction'::issue_status])
  ) into v_reviewer_can_edit
  from issues where id = p_issue_id;

  if not is_super_admin() and not coalesce(v_reviewer_can_edit, false) then
    raise exception 'Only Super Admin, a Project Admin, or the assigned State Coordinator may edit a submission';
  end if;

  update issues set category_id = p_category_id, priority = p_priority, description = p_description
    where id = p_issue_id
    returning * into v_issue;
  if not found then raise exception 'Finding not found'; end if;

  insert into issue_history (issue_id, actor_id, actor_label, actor_role, action, note)
  values (p_issue_id, auth.uid(), my_name(), v_role, 'Submission edited', 'Corrected field data on this submission.');

  return v_issue;
end;
$$;


-- ===== 0041_fix_review_dri_visibility_and_verify_role_guard.sql =====
-- Two pre-existing role gaps found while testing mobile access for senior roles (DECISIONS.md #31).
-- Neither is caused by that change; both are fixed here, additively, without touching any other
-- policy or function.

-- ─── 1. State Coordinator / Project Admin could not see any DRI, so could not assign one ────────
-- profiles_select (0008) is: own row, or Super Admin, or a Project Admin whose project_id equals
-- the row's. So:
--   * a State Coordinator saw only their own profile, and
--   * a Project Admin with no project_id (all real ones today — in_scope() treats that as "sees
--     everything" everywhere else) matched nothing either, because `null = null` is not true.
-- approve_and_assign_finding is SECURITY INVOKER and validates the chosen DRI with
-- `select ... from profiles where id = p_dri_id and role = 'dri'` — under those policies that
-- found nobody, so approve+assign raised "Selected user is not a DRI" for a State Coordinator
-- (and for a project-less Project Admin). The web's DRI picker (getDris) queries profiles as the
-- caller too, so it was empty for the same reason.
--
-- Fix: one narrow, additive SELECT policy — these two reviewing roles may read ACTIVE DRI
-- profiles, nothing else. Choosing a DRI to assign is inherent to the review action they already
-- have (0032/0040), so this exposes no more than the action itself needs. A Project Admin is still
-- limited by in_scope() (same null-passthrough rule as every other Project Admin capability); a
-- State Coordinator sees DRIs across projects, matching how they already see Findings by state
-- rather than by project. Permissive policies OR together, so nothing existing is narrowed.

create policy profiles_select_dris_for_reviewers on profiles for select to authenticated
  using (
    role = 'dri'
    and status = 'active'
    and (
      current_user_role() = 'state_coordinator'
      or (current_user_role() = 'project_admin' and in_scope(project_id))
    )
  );

-- ─── 2. A DRI could verify/close or reject/reopen their own Finding through the API ─────────────
-- verify_and_close_issue and reject_and_reopen_issue (0024) have no role check of their own and
-- rely on issues_update RLS, which lets the assigned DRI update their row — so a DRI calling the
-- RPC directly could close (or reopen) their own work, defeating "no Finding closes on
-- self-reporting alone". The web and mobile UIs never offer it; the API did.
--
-- Fix: the same roles the web's canVerify grants — Super Admin, Project Admin, TPM Field Monitor
-- — checked up front. Bodies are otherwise exactly 0024's (idempotent-retry behaviour included).
-- coalesce() because current_user_role() is null for a caller with no profile, and
-- `null not in (...)` is null, which would let the guard fall through.

create or replace function reject_and_reopen_issue(p_issue_id uuid, p_comment text)
returns issues language plpgsql as $$
declare
  v_issue issues;
  v_already_reopened boolean;
begin
  if coalesce(current_user_role()::text, '') not in ('super_admin', 'project_admin', 'tpm_supervisor') then
    raise exception 'Only a Super Admin, Project Admin, or TPM Field Monitor may reopen a finding after verification';
  end if;

  if coalesce(trim(p_comment), '') = '' then
    raise exception 'A comment explaining why the issue remains unresolved is required';
  end if;

  select (status = 'reopened') into v_already_reopened from issues where id = p_issue_id;

  update issues set status = 'reopened'
    where id = p_issue_id and status in ('resolved', 'reopened')
    returning * into v_issue;
  if not found then
    raise exception 'Issue not found, not awaiting verification, or not permitted';
  end if;

  if not coalesce(v_already_reopened, false) then
    insert into issue_history (issue_id, actor_id, actor_label, action, note) values
      (p_issue_id, auth.uid(), my_name(), 'Final Verification — Not Resolved', p_comment),
      (p_issue_id, auth.uid(), my_name(), 'Issue Reopened', 'Routed back to ' ||
        coalesce((select name from profiles where id = v_issue.assigned_dri), 'the assigned DRI') || '.');

    if v_issue.assigned_dri is not null then
      perform create_notification(v_issue.assigned_dri, 'reopened',
        v_issue.code || ' was reopened — additional action required', '/issues/' || v_issue.id, v_issue.id);
    end if;
  end if;

  return v_issue;
end;
$$;

create or replace function verify_and_close_issue(p_issue_id uuid, p_note text default null)
returns issues language plpgsql as $$
declare
  v_issue issues;
  v_already_closed boolean;
begin
  if coalesce(current_user_role()::text, '') not in ('super_admin', 'project_admin', 'tpm_supervisor') then
    raise exception 'Only a Super Admin, Project Admin, or TPM Field Monitor may verify and close a finding';
  end if;

  select (status = 'verified_closed') into v_already_closed from issues where id = p_issue_id;

  update issues set status = 'verified_closed', verified_by = auth.uid(), resolution_date = now()
    where id = p_issue_id
    returning * into v_issue;
  if not found then raise exception 'Issue not found or not permitted'; end if;

  if not coalesce(v_already_closed, false) then
    insert into issue_history (issue_id, actor_id, actor_label, action, note)
    values (p_issue_id, auth.uid(), my_name(), 'Verified and closed',
      coalesce(p_note, 'Confirmed resolution during follow-up visit.'));
  end if;

  return v_issue;
end;
$$;


-- ===== 0042_robust_derive_initials.sql =====
-- derive_initials() (0026) took the first character of the first and last whitespace-separated
-- words verbatim, but profiles.initials has CHECK (initials ~ '^[A-Z]{2}$'). Any name whose first
-- or last word does not start with a plain A-Z letter therefore made the profile insert fail,
-- which surfaced in the Add User form only as "Database error creating new user":
--   "Demo DRI (Health)"  -> last word "(Health)" starts with "("   -> "D("
--   "Ọlá Ṣola"           -> accented/dotted first letters           -> "Ọṣ"
--   "John (Lagos)", "Amina 2", a trailing "-" ... same failure.
-- Yoruba/Igbo diacritics are common in this program's staff names, so this was a real trap, not a
-- corner case.
--
-- New rule, identical for every name that already worked: decompose accents (NFD), keep only the
-- A-Z letters of each word, drop words left with no letters (brackets, digits, dashes), then take
-- the first letter of the first remaining word and of the last (a single word doubles its first
-- letter, as before). Nothing left at all (empty / no Latin letters) still falls back to 'XX'.
-- Existing profiles keep their stored initials — this only affects newly derived ones.

create or replace function derive_initials(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  words text[];
begin
  select array_agg(w) into words
  from (
    select upper(regexp_replace(normalize(t, NFD), '[^A-Za-z]', '', 'g')) as w
    from regexp_split_to_table(trim(coalesce(p_name, '')), '\s+') as t
  ) s
  where w <> '';

  if words is null then
    return 'XX';
  end if;

  return substr(words[1], 1, 1) || substr(words[array_length(words, 1)], 1, 1);
end;
$$;

comment on function derive_initials(text) is
  'First A-Z letter of the first + last name-word, accents stripped, words with no letters ignored '
  '(e.g. "Najib Isah" -> NI, "Ọlá Ṣola" -> OS, "John (Lagos)" -> JL). Single-word names double '
  'their first letter; fallback XX. Always matches profiles_initials_format. See DECISIONS.md #34.';


-- ===== 0100_rutf_reference.sql =====
-- RUTF Monitoring Platform — migration 0100 (brief §5, milestone M1)
-- Reference data: the facility registry (State store → LGA stores → health facilities / OTPs),
-- products and lots, dosing rules and thresholds, and the facility a `dri` user records for.
--
-- Facilities reuse the 0015 Data Sets approval workflow (enforce_dataset_workflow): Super Admin
-- writes go live, Project Admin writes become pending proposals. Products, protocol rules and
-- thresholds are programme sign-off values (brief §12.2–12.4), so only Super Admin edits them.

-- ── Pilot project ──────────────────────────────────────────────────────────────────────────────
-- Thresholds are keyed by project (brief §5), so the pilot project has to exist first.
insert into projects (name) values ('Katsina RUTF Pilot') on conflict (name) do nothing;

-- ── Facilities ─────────────────────────────────────────────────────────────────────────────────
create type facility_type as enum ('state_store', 'lga_store', 'health_facility');

create table facilities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  facility_type facility_type not null,
  name text not null,
  national_code text,                       -- registry globalid until a national code exists
  state_id uuid not null references states(id),
  lga_id uuid not null references lgas(id),
  ward_id uuid references wards(id),
  ward_name_source text,                    -- ward as written in the source list
  lat numeric(9,6),
  lng numeric(9,6),
  geocode_accuracy_m numeric,
  geocode_source text check (geocode_source in ('field_gps', 'registry', 'manual')),
  location_flag text,                       -- set by derive_facility_location(); never blocks
  is_otp_site boolean not null default false,
  supplied_by_facility_id uuid references facilities(id),  -- OTP -> LGA store -> State store
  is_hard_to_reach boolean not null default false,         -- uses variance_pct_max_remote
  is_active boolean not null default true,
  functional_status text,                   -- registry value: Functional / Unknown / blank
  registry_category text,                   -- registry value: Dispensary, Maternity Home, ...
  dummy_fields text,                        -- which fields are generated dummy data (DECISIONS R2)
  -- 0015 approval workflow columns
  status dataset_status not null default 'approved',
  pending_data jsonb,
  submitted_by uuid references profiles(id),
  reviewed_by uuid references profiles(id),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index facilities_project_id_idx on facilities(project_id);
create index facilities_lga_id_idx on facilities(lga_id);
create index facilities_ward_id_idx on facilities(ward_id);
create index facilities_supplier_idx on facilities(supplied_by_facility_id);
create index facilities_status_idx on facilities(status);
create index facilities_name_trgm_idx on facilities using gin (name gin_trgm_ops);
create unique index facilities_national_code_unique on facilities(national_code)
  where national_code is not null and status <> 'rejected';

comment on column facilities.location_flag is
  'outside_boundaries: point outside every known LGA; outside_declared_lga: point falls in a '
  'different LGA than lga_id; outside_declared_ward: point falls in a different ward than ward_id. '
  'Flags are for review — the declared location is kept.';

create trigger facilities_set_updated_at before update on facilities
  for each row execute function set_updated_at();

-- Resolves state from LGA, fills a missing ward from coordinates, flags (never blocks) a point
-- that sits outside its declared LGA/ward, and keeps the supply chain one level at a time.
-- Named to sort before facilities_enforce_workflow (BEFORE triggers fire in name order), so a
-- Project Admin's pending_data snapshot already holds the derived values — same as 0019.
create or replace function derive_facility_location()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_supplier_type facility_type;
begin
  NEW.location_flag := null;

  if NEW.lat is not null and NEW.lng is not null then
    select * into r from resolve_administrative_location(NEW.lat, NEW.lng);
    if r.lga_id is null then
      NEW.location_flag := 'outside_boundaries';
    elsif NEW.lga_id is null then
      NEW.lga_id := r.lga_id;
      NEW.ward_id := coalesce(NEW.ward_id, r.ward_id);
    elsif NEW.lga_id = r.lga_id then
      NEW.ward_id := coalesce(NEW.ward_id, r.ward_id);
      if r.ward_id is not null and NEW.ward_id is distinct from r.ward_id then
        NEW.location_flag := 'outside_declared_ward';
      end if;
    else
      NEW.location_flag := 'outside_declared_lga';
    end if;
  end if;

  if NEW.lga_id is null then
    raise exception 'lga_id is required (or coordinates inside a known LGA)';
  end if;
  select state_id into NEW.state_id from lgas where id = NEW.lga_id;
  if NEW.ward_id is not null and not exists (select 1 from wards where id = NEW.ward_id and lga_id = NEW.lga_id) then
    raise exception 'ward_id does not belong to the facility''s LGA';
  end if;

  if NEW.supplied_by_facility_id is not null then
    select facility_type into v_supplier_type from facilities where id = NEW.supplied_by_facility_id;
    if (NEW.facility_type = 'state_store')
       or (NEW.facility_type = 'lga_store' and v_supplier_type is distinct from 'state_store')
       or (NEW.facility_type = 'health_facility' and v_supplier_type is distinct from 'lga_store') then
      raise exception 'Supply chain is State store -> LGA store -> health facility: a % cannot be supplied by a %',
        NEW.facility_type, coalesce(v_supplier_type::text, 'missing facility');
    end if;
  end if;

  return NEW;
end;
$$;

create trigger facilities_derive_location before insert or update on facilities
  for each row execute function derive_facility_location();
create trigger facilities_enforce_workflow before insert or update or delete on facilities
  for each row execute function enforce_dataset_workflow();

-- Approve / reject a pending facility change (Super Admin only) — same semantics as 0015's
-- approve_activity_site / reject_activity_site, applied to every business column at once.
create or replace function approve_facility(p_id uuid, p_note text default null)
returns facilities language plpgsql as $$
declare
  v_row facilities;
  v_new facilities;
begin
  if not is_super_admin() then raise exception 'Only Super Admin may approve data set entries'; end if;
  select * into v_row from facilities where id = p_id;
  if not found then raise exception 'Entry not found'; end if;

  if v_row.status = 'pending_delete' then
    delete from facilities where id = p_id;
  elsif v_row.status = 'pending_update' then
    v_new := jsonb_populate_record(v_row, coalesce(v_row.pending_data, '{}'::jsonb));
    update facilities set
      facility_type = v_new.facility_type, name = v_new.name, national_code = v_new.national_code,
      lga_id = v_new.lga_id, ward_id = v_new.ward_id, ward_name_source = v_new.ward_name_source,
      lat = v_new.lat, lng = v_new.lng, geocode_accuracy_m = v_new.geocode_accuracy_m,
      geocode_source = v_new.geocode_source, is_otp_site = v_new.is_otp_site,
      supplied_by_facility_id = v_new.supplied_by_facility_id, is_hard_to_reach = v_new.is_hard_to_reach,
      is_active = v_new.is_active, functional_status = v_new.functional_status,
      registry_category = v_new.registry_category,
      status = 'approved', pending_data = null, reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  elsif v_row.status = 'pending_create' then
    update facilities set status = 'approved', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  else
    raise exception 'This entry has no pending change to approve';
  end if;
  return v_row;
end;
$$;

create or replace function reject_facility(p_id uuid, p_note text)
returns facilities language plpgsql as $$
declare v_row facilities;
begin
  if not is_super_admin() then raise exception 'Only Super Admin may reject data set entries'; end if;
  select * into v_row from facilities where id = p_id;
  if not found then raise exception 'Entry not found'; end if;

  if v_row.status in ('pending_delete', 'pending_update') then
    update facilities set status = 'approved', pending_data = null, reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  elsif v_row.status = 'pending_create' then
    update facilities set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  else
    raise exception 'This entry has no pending change to reject';
  end if;
  return v_row;
end;
$$;

-- ── Facility users ─────────────────────────────────────────────────────────────────────────────
alter table profiles add column if not exists facility_id uuid references facilities(id) on delete set null;
create index if not exists profiles_facility_id_idx on profiles(facility_id);
comment on column profiles.facility_id is
  'The one facility a `dri` (facility user) records for — brief §4. Its level (SST/LST/OTP) is '
  'copied into assigned_category_id by profiles_set_facility_level, so Finding scoping follows.';

create or replace function current_facility_id()
returns uuid language sql stable security definer set search_path = public as $$
  select facility_id from profiles where id = auth.uid();
$$;

-- The facility that supplies the caller's facility (receipts come from it).
create or replace function current_facility_supplier_id()
returns uuid language sql stable security definer set search_path = public as $$
  select f.supplied_by_facility_id from facilities f where f.id = current_facility_id();
$$;

-- Level follows facility: State store -> SST, LGA store -> LST, health facility -> OTP.
create or replace function set_profile_facility_level()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.facility_id is not null and (TG_OP = 'INSERT' or NEW.facility_id is distinct from OLD.facility_id) then
    select c.id into NEW.assigned_category_id
    from facilities f
    join categories c on c.abbr = case f.facility_type
      when 'state_store' then 'SST' when 'lga_store' then 'LST' else 'OTP' end
    where f.id = NEW.facility_id;
  end if;
  return NEW;
end;
$$;

-- "zz" so it runs after profiles_enforce_update_rules has pinned a self-edited facility_id back.
create trigger profiles_zz_set_facility_level before insert or update on profiles
  for each row execute function set_profile_facility_level();

-- Same pin-back as 0038, now also covering facility_id; a Project Admin may only assign a
-- facility in their own project.
create or replace function enforce_profile_update_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  acting_role user_role;
begin
  if auth.uid() is null then
    return new; -- service-role / direct DB connection: trusted, no client-side guard needed
  end if;

  acting_role := current_user_role();

  if acting_role = 'super_admin' then
    return new;
  end if;

  if acting_role = 'project_admin' then
    if old.project_id is distinct from current_project_id() then
      raise exception 'Not authorized to modify profiles outside your project';
    end if;
    if new.role in ('super_admin', 'project_admin') and new.role is distinct from old.role then
      raise exception 'Project Admin cannot assign the % role', new.role;
    end if;
    if new.facility_id is distinct from old.facility_id and new.facility_id is not null
       and not exists (select 1 from facilities where id = new.facility_id and status = 'approved'
                       and project_id is not distinct from current_project_id()) then
      raise exception 'Facility must be an approved facility in your project';
    end if;
    return new;
  end if;

  if old.id is distinct from auth.uid() then
    raise exception 'Not authorized to modify other profiles';
  end if;
  new.role := old.role;
  new.project_id := old.project_id;
  new.status := old.status;
  new.managed_state_id := old.managed_state_id;
  new.assigned_category_id := old.assigned_category_id;
  new.facility_id := old.facility_id;
  return new;
end;
$$;

-- ── Facility RLS ───────────────────────────────────────────────────────────────────────────────
-- A facility user sees only their own facility, its supplier, and the facilities it supplies
-- (what they receive from / issue to) — this is also all the Android app syncs for them.
-- Other roles see approved facilities in their project. Pending/rejected rows: submitter and
-- approvers only, as in 0015.
alter table facilities enable row level security;

create policy facilities_select on facilities for select to authenticated
  using (
    is_super_admin()
    or submitted_by = auth.uid()
    or (current_user_role() = 'project_admin' and in_scope(project_id))
    or (
      status = 'approved'
      and case
        when current_user_role() = 'dri' then
          id = current_facility_id()
          or id = current_facility_supplier_id()
          or supplied_by_facility_id = current_facility_id()
        else in_scope(project_id)
      end
    )
  );
create policy facilities_insert on facilities for insert to authenticated
  with check (current_user_role() in ('super_admin', 'project_admin'));
create policy facilities_update on facilities for update to authenticated
  using (
    is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id) and (submitted_by = auth.uid() or status = 'approved'))
  )
  with check (is_super_admin() or current_user_role() = 'project_admin');
create policy facilities_delete on facilities for delete to authenticated
  using (
    is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id) and (submitted_by = auth.uid() or status = 'approved'))
  );

-- ── Products and lots ──────────────────────────────────────────────────────────────────────────
create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null default 'sachet',
  units_per_carton int not null check (units_per_carton > 0),
  shelf_life_months int check (shelf_life_months > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger products_set_updated_at before update on products
  for each row execute function set_updated_at();

create table product_lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  lot_no text not null,
  expiry_date date not null,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, lot_no)
);
create index product_lots_expiry_idx on product_lots(expiry_date);
create trigger product_lots_set_updated_at before update on product_lots
  for each row execute function set_updated_at();

-- Brief §12.2 (settled). Fixed id so data/dummy/product_lots.csv can reference it.
insert into products (id, name, unit, units_per_carton, shelf_life_months)
values ('7f362a56-19fb-5960-a260-14f1c68b1e85', 'RUTF paste 92 g sachet', 'sachet', 150, 24)
on conflict (id) do nothing;

-- ── Dosing rules — data, never code (brief §12.3) ──────────────────────────────────────────────
create table protocol_rules (
  id uuid primary key default gen_random_uuid(),
  protocol_version text not null,
  weight_min_kg numeric not null,
  weight_max_kg numeric not null,
  sachets_per_week numeric not null check (sachets_per_week > 0),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (weight_max_kg >= weight_min_kg),
  check (effective_to is null or effective_to >= effective_from),
  unique (protocol_version, weight_min_kg)
);
create trigger protocol_rules_set_updated_at before update on protocol_rules
  for each row execute function set_updated_at();

-- [VALIDATE] seed defaults, to be signed off by the Katsina State nutrition unit (§12.3).
insert into protocol_rules (protocol_version, weight_min_kg, weight_max_kg, sachets_per_week, effective_from) values
  ('CMAM-175kcal-generic', 3.5, 3.9, 10, '2026-01-01'),
  ('CMAM-175kcal-generic', 4.0, 4.4, 11, '2026-01-01'),
  ('CMAM-175kcal-generic', 4.5, 4.9, 12, '2026-01-01'),
  ('CMAM-175kcal-generic', 5.0, 5.9, 14, '2026-01-01'),
  ('CMAM-175kcal-generic', 6.0, 6.9, 17, '2026-01-01'),
  ('CMAM-175kcal-generic', 7.0, 7.9, 20, '2026-01-01'),
  ('CMAM-175kcal-generic', 8.0, 8.9, 23, '2026-01-01'),
  ('CMAM-175kcal-generic', 9.0, 9.9, 26, '2026-01-01'),
  ('CMAM-175kcal-generic', 10.0, 11.9, 28, '2026-01-01'),
  ('CMAM-175kcal-generic', 12.0, 999, 35, '2026-01-01')
on conflict (protocol_version, weight_min_kg) do nothing;

-- ── Thresholds (brief §12.4) ───────────────────────────────────────────────────────────────────
create table rutf_thresholds (
  project_id uuid not null references projects(id) on delete cascade,
  key text not null,
  value numeric not null,
  note text,
  updated_at timestamptz not null default now(),
  primary key (project_id, key)
);
create trigger rutf_thresholds_set_updated_at before update on rutf_thresholds
  for each row execute function set_updated_at();

-- [VALIDATE] seed defaults (§12.4), confirm with programme.
insert into rutf_thresholds (project_id, key, value, note)
select p.id, t.key, t.value, t.note
from projects p
cross join (values
  ('variance_pct_max', 5, '± % stock card vs physical count'),
  ('variance_pct_max_remote', 10, 'Same, for facilities flagged hard-to-reach'),
  ('vf_min', 0.90, 'OTP verification factor: below suggests over-reporting'),
  ('vf_max', 1.10, 'OTP verification factor: above suggests under-reporting or a parallel supply'),
  ('geofence_m', 150, 'Supervision visit GPS distance from the facility point'),
  ('short_dispense_pct', 5, 'Cumulative dispensed-vs-prescribed deficit before flagging')
) as t(key, value, note)
where p.name = 'Katsina RUTF Pilot'
on conflict (project_id, key) do nothing;

-- ── RLS for products, lots, protocol rules, thresholds ─────────────────────────────────────────
-- Readable by every signed-in user (the Android app needs them offline). Lots: Super Admin and
-- Project Admin add/edit (new lots arrive with deliveries); the rest: Super Admin only.
alter table products enable row level security;
alter table product_lots enable row level security;
alter table protocol_rules enable row level security;
alter table rutf_thresholds enable row level security;

create policy products_select on products for select to authenticated using (true);
create policy products_write on products for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

create policy product_lots_select on product_lots for select to authenticated using (true);
create policy product_lots_insert on product_lots for insert to authenticated
  with check (current_user_role() in ('super_admin', 'project_admin'));
create policy product_lots_update on product_lots for update to authenticated
  using (current_user_role() in ('super_admin', 'project_admin'))
  with check (current_user_role() in ('super_admin', 'project_admin'));
create policy product_lots_delete on product_lots for delete to authenticated
  using (is_super_admin());

create policy protocol_rules_select on protocol_rules for select to authenticated using (true);
create policy protocol_rules_write on protocol_rules for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

create policy rutf_thresholds_select on rutf_thresholds for select to authenticated
  using (in_scope(project_id));
create policy rutf_thresholds_write on rutf_thresholds for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- ── Realtime — the Super Admin approval queue updates live, as for 0015 ────────────────────────
alter publication supabase_realtime add table facilities;
