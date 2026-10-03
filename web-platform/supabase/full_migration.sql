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


-- ===== 0101_rutf_ledger.sql =====
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


-- ===== 0102_rutf_findings.sql =====
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


-- ===== 0103_rutf_supervision.sql =====
-- RUTF Monitoring Platform — migration 0103 (brief §5 "0102_rutf_supervision" + §6, milestone M4)
-- Supervision visits by government nutrition officers (brief §4, §8): a Store Check at an LGA /
-- State store, an OTP Verification at an OTP site. A visit records the supervisor's physical
-- count by lot, the checklist, GPS and evidence; evaluate_visit() then raises the visit-based
-- Findings (brief §6) into review. Supervisors also confirm the adjustments facilities record.
-- Numbered 0103 (brief: 0102) — see DECISIONS R29.

-- ── Who supervises what (brief §4, §12.6) ──────────────────────────────────────────────────────
-- An LGA Nutrition Officer supervises the OTP sites in their LGA; a State nutrition / SMoH M&E
-- officer supervises the stores in the LGAs assigned to them (and the State store).
alter table profiles add column if not exists supervision_level text check (supervision_level in ('stores', 'otp_sites'));
comment on column profiles.supervision_level is
  'For a tpm_supervisor: which facilities they supervise in their LGAs (supervisor_lgas) — '
  'stores (LGA stores + the State store) or otp_sites.';

create table supervisor_lgas (
  profile_id uuid not null references profiles(id) on delete cascade,
  lga_id uuid not null references lgas(id) on delete cascade,
  primary key (profile_id, lga_id)
);
alter table supervisor_lgas enable row level security;
create policy supervisor_lgas_select on supervisor_lgas for select to authenticated
  using (profile_id = auth.uid() or current_user_role() in ('super_admin', 'project_admin', 'state_coordinator'));
create policy supervisor_lgas_write on supervisor_lgas for all to authenticated
  using (is_super_admin() or (current_user_role() = 'project_admin'
         and exists (select 1 from profiles p where p.id = profile_id and p.project_id is not distinct from current_project_id())))
  with check (is_super_admin() or (current_user_role() = 'project_admin'
         and exists (select 1 from profiles p where p.id = profile_id and p.project_id is not distinct from current_project_id())));

-- May the caller supervise this facility? Super Admin always; a supervisor by level and LGA.
-- A facility user never supervises (separation of duties — brief §4).
create or replace function can_supervise(p_facility_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when is_super_admin() then true
    when current_user_role() <> 'tpm_supervisor' then false
    else exists (
      select 1 from facilities f, profiles p
      where f.id = p_facility_id and p.id = auth.uid() and f.status = 'approved' and f.is_active
        and (
          (p.supervision_level = 'otp_sites' and f.facility_type = 'health_facility' and f.is_otp_site
             and exists (select 1 from supervisor_lgas s where s.profile_id = p.id and s.lga_id = f.lga_id))
          or (p.supervision_level = 'stores' and f.facility_type = 'state_store')
          or (p.supervision_level = 'stores' and f.facility_type = 'lga_store'
             and exists (select 1 from supervisor_lgas s where s.profile_id = p.id and s.lga_id = f.lga_id))
        )
    )
  end;
$$;

-- Self-edit pin-back (0038/0100) now also covers supervision_level.
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
  new.supervision_level := old.supervision_level;
  return new;
end;
$$;

-- ── Visits ─────────────────────────────────────────────────────────────────────────────────────
create type visit_type as enum ('store_check', 'otp_verification');
create sequence visit_code_seq;

create table monitoring_visits (
  id uuid primary key default gen_random_uuid(),
  code text unique,                         -- VIS-<LGA3>-<YY>-000123
  project_id uuid references projects(id) on delete set null,
  visit_type visit_type not null,
  facility_id uuid not null references facilities(id),
  supervisor_id uuid not null references profiles(id),
  visit_date date not null,
  period_start date,                        -- OTP verification: the period recounted
  period_end date,
  lat numeric(9,6) not null,
  lng numeric(9,6) not null,
  gps_accuracy_m numeric,
  distance_to_facility_m numeric,           -- computed vs the facility point
  outside_geofence boolean,                 -- distance > geofence_m (brief §7 distance flag)
  device_id text not null,
  local_id text unique,
  status text not null default 'submitted',
  created_at timestamptz not null default now(),
  check (period_start is null or period_end is null or period_start <= period_end)
);
create index monitoring_visits_facility_idx on monitoring_visits(facility_id, visit_date);
create index monitoring_visits_supervisor_idx on monitoring_visits(supervisor_id, visit_date);

create table stock_check_lines (            -- supervisor's physical count per lot
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references monitoring_visits(id) on delete cascade,
  lot_id uuid references product_lots(id),
  lot_no_seen text,
  expiry_seen date,
  stock_card_balance int,                   -- as written on the card
  system_balance int,                       -- ledger balance at visit time (filled server-side)
  physical_count int not null check (physical_count >= 0),
  damaged_count int not null default 0 check (damaged_count >= 0),
  expired_count int not null default 0 check (expired_count >= 0)
);
create index stock_check_lines_visit_idx on stock_check_lines(visit_id);

create table store_checks (                 -- 1:1 with a store_check visit
  visit_id uuid primary key references monitoring_visits(id) on delete cascade,
  stock_card_present boolean not null,
  stock_card_up_to_date boolean,
  storage_dry boolean,
  storage_off_floor boolean,
  storage_ventilated boolean,
  pests_seen boolean,
  fefo_followed boolean,
  notes text
);

create table otp_verifications (            -- 1:1 with an otp_verification visit
  visit_id uuid primary key references monitoring_visits(id) on delete cascade,
  register_present boolean not null,
  admissions_counted int,                   -- supervisor's tally for the period
  sachets_dispensed_counted int,
  admissions_recorded int,                  -- what the app has for the period (server-side)
  sachets_dispensed_recorded int,
  notes text
);

-- Evidence: stock card, stack, register page (names covered), selfie — brief §8.
create table visit_photos (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references monitoring_visits(id) on delete cascade,
  storage_path text not null unique,        -- {supervisor_id}/{visit local_id}/{kind}.jpg in visit-evidence
  kind text not null check (kind in ('stock_card', 'stock', 'register_page', 'selfie', 'other')),
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id) default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index visit_photos_visit_idx on visit_photos(visit_id);

-- Findings link back to the visit that raised them.
alter table issues add column if not exists visit_id uuid references monitoring_visits(id);
create index if not exists issues_visit_id_idx on issues(visit_id);

-- Adjustment confirmation note (supervisor, brief §8).
alter table stock_transactions add column if not exists confirmation_note text;

-- ── Visit-based rules (brief §6) ───────────────────────────────────────────────────────────────
-- Raised into review like the ledger rules (0102), one per rule per visit, linked to the visit.
create or replace function evaluate_visit_internal(p_visit_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v monitoring_visits;
  f facilities;
  sc store_checks;
  ov otp_verifications;
  v_raised int := 0;
  v_id uuid;
  v_limit numeric;
  v_sys int;
  v_phys int;
  v_expired int;
  v_vf numeric;
  v_min numeric;
  v_max numeric;
  v_problems text[];
begin
  select * into v from monitoring_visits where id = p_visit_id;
  if not found then return 0; end if;
  select * into f from facilities where id = v.facility_id;

  -- stock_variance: supervisor's count against the ledger at the visit, all lots together.
  select sum(system_balance)::int, sum(physical_count)::int, sum(expired_count)::int
    into v_sys, v_phys, v_expired from stock_check_lines where visit_id = p_visit_id;
  v_limit := rutf_threshold(f.project_id, case when f.is_hard_to_reach then 'variance_pct_max_remote' else 'variance_pct_max' end,
                            case when f.is_hard_to_reach then 10 else 5 end);
  if coalesce(v_sys, 0) > 0 and abs(v_sys - v_phys)::numeric / v_sys * 100 > v_limit then
    v_id := raise_auto_finding('stock_variance', f.id, 'stock_variance:visit:' || p_visit_id,
      format('Supervision count at %s on %s differs from the ledger by %s%% (counted %s, ledger %s sachets; limit %s%%). For review.',
             f.name, v.visit_date, round(abs(v_sys - v_phys)::numeric / v_sys * 100, 1),
             to_char(v_phys, 'FM999,999,999'), to_char(v_sys, 'FM999,999,999'), v_limit),
      jsonb_build_object('variance_pct', round(abs(v_sys - v_phys)::numeric / v_sys * 100, 1), 'threshold', v_limit,
                         'counted', v_phys, 'ledger_balance', v_sys, 'count_date', v.visit_date),
      v.visit_date, v.visit_date);
    if v_id is not null then update issues set visit_id = p_visit_id where id = v_id; v_raised := v_raised + 1; end if;
  end if;

  -- expired_stock: expired sachets found on the shelf.
  if coalesce(v_expired, 0) > 0 then
    v_id := raise_auto_finding('expired_stock', f.id, 'expired_stock:visit:' || p_visit_id,
      format('%s expired sachets were found on the shelf at %s during the visit on %s. For review.',
             to_char(v_expired, 'FM999,999,999'), f.name, v.visit_date),
      jsonb_build_object('balance', v_expired), v.visit_date, v.visit_date);
    if v_id is not null then update issues set visit_id = p_visit_id where id = v_id; v_raised := v_raised + 1; end if;
  end if;

  if v.visit_type = 'store_check' then
    select * into sc from store_checks where visit_id = p_visit_id;
    if found then
      if not sc.stock_card_present or sc.stock_card_up_to_date is false then
        v_id := raise_auto_finding('no_stock_card', f.id, 'no_stock_card:visit:' || p_visit_id,
          format('No up-to-date stock card at %s during the visit on %s (%s). For review.', f.name, v.visit_date,
                 case when not sc.stock_card_present then 'no stock card' else 'stock card not up to date' end),
          jsonb_build_object('stock_card_present', sc.stock_card_present, 'stock_card_up_to_date', sc.stock_card_up_to_date),
          v.visit_date, v.visit_date);
        if v_id is not null then update issues set visit_id = p_visit_id where id = v_id; v_raised := v_raised + 1; end if;
      end if;
      v_problems := array_remove(array[
        case when sc.storage_dry is false then 'store not dry' end,
        case when sc.storage_off_floor is false then 'stock on the floor' end,
        case when sc.pests_seen then 'signs of pests' end], null);
      if cardinality(v_problems) > 0 then
        v_id := raise_auto_finding('poor_storage', f.id, 'poor_storage:visit:' || p_visit_id,
          format('Storage at %s during the visit on %s: %s. For review.', f.name, v.visit_date, array_to_string(v_problems, ', ')),
          jsonb_build_object('storage_dry', sc.storage_dry, 'storage_off_floor', sc.storage_off_floor, 'pests_seen', sc.pests_seen),
          v.visit_date, v.visit_date);
        if v_id is not null then update issues set visit_id = p_visit_id where id = v_id; v_raised := v_raised + 1; end if;
      end if;
    end if;
  else
    select * into ov from otp_verifications where visit_id = p_visit_id;
    if found then
      if not ov.register_present then
        v_id := raise_auto_finding('register_missing', f.id, 'register_missing:visit:' || p_visit_id,
          format('The OTP register was not available at %s during the visit on %s. For review.', f.name, v.visit_date),
          jsonb_build_object('register_present', false), v.period_start, v.period_end);
        if v_id is not null then update issues set visit_id = p_visit_id where id = v_id; v_raised := v_raised + 1; end if;
      elsif ov.sachets_dispensed_counted is not null and coalesce(ov.sachets_dispensed_recorded, 0) > 0 then
        -- OTP VF = supervisor's register count ÷ app-recorded dispensing (brief §7).
        v_vf := round(ov.sachets_dispensed_counted::numeric / ov.sachets_dispensed_recorded, 2);
        v_min := rutf_threshold(f.project_id, 'vf_min', 0.90);
        v_max := rutf_threshold(f.project_id, 'vf_max', 1.10);
        if v_vf < v_min or v_vf > v_max then
          v_id := raise_auto_finding('dispensing_gap', f.id, 'dispensing_gap:visit:' || p_visit_id,
            format('At %s, the register shows %s sachets dispensed from %s to %s, against %s recorded in the app — verification factor %s (range %s–%s). For review.',
                   f.name, to_char(ov.sachets_dispensed_counted, 'FM999,999,999'), v.period_start, v.period_end,
                   to_char(ov.sachets_dispensed_recorded, 'FM999,999,999'), v_vf, v_min, v_max),
            jsonb_build_object('vf', v_vf, 'vf_min', v_min, 'vf_max', v_max,
                               'sachets_dispensed_counted', ov.sachets_dispensed_counted,
                               'sachets_dispensed_recorded', ov.sachets_dispensed_recorded),
            v.period_start, v.period_end);
          if v_id is not null then update issues set visit_id = p_visit_id where id = v_id; v_raised := v_raised + 1; end if;
        end if;
      end if;
    end if;
  end if;

  return v_raised;
end;
$$;

create or replace function evaluate_visit(p_visit_id uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and current_user_role() not in ('super_admin', 'project_admin') then
    raise exception 'Only an administrator can run Finding checks';
  end if;
  return evaluate_visit_internal(p_visit_id);
end;
$$;

-- History line: an auto-Finding says whether a ledger check or a visit raised it.
create or replace function log_issue_reported()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.auto_generated then
    insert into issue_history (issue_id, actor_id, actor_label, action, note)
    values (new.id, null, 'RUTF Monitoring (automatic check)', 'Finding reported',
            'Raised automatically from ' ||
            case when (select source from finding_types where key = new.finding_type) = 'visit' or new.dedupe_key like '%:visit:%'
                 then 'a supervision visit' else 'the stock ledger' end ||
            ' for review — ' || coalesce((select label from finding_types where key = new.finding_type), new.finding_type) || '.');
  else
    insert into issue_history (issue_id, actor_id, actor_label, action, note)
    values (new.id, new.reported_by, coalesce((select name from profiles where id = new.reported_by), 'TPM Field Monitor'),
            'Finding reported', 'Field visit finding logged with photo evidence and GPS capture.');
  end if;
  return new;
end;
$$;

-- ── Recording a visit (from the Android wizards, through the sync queue) ───────────────────────
-- p_lines: [{ lot_id?/lot_no?/expiry_date?, stock_card_balance?, physical_count, damaged_count?, expired_count? }]
-- p_checklist (store_check): { stock_card_present, stock_card_up_to_date, storage_dry, storage_off_floor,
--                              storage_ventilated, pests_seen, fefo_followed, notes }
-- p_checklist (otp_verification): { register_present, admissions_counted, sachets_dispensed_counted, notes }
-- Idempotent on p_local_id: a retried sync gets the stored result back, marked duplicate.
create or replace function record_visit(
  p_local_id text, p_visit_type visit_type, p_facility_id uuid, p_visit_date date,
  p_lat numeric, p_lng numeric, p_gps_accuracy_m numeric, p_lines jsonb, p_checklist jsonb,
  p_period_start date default null, p_period_end date default null, p_device_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f facilities;
  v monitoring_visits;
  v_line record;
  v_lot uuid;
  v_distance numeric;
  v_geofence numeric;
  v_lga_abbr text;
  v_raised int;
  v_adm int;
  v_disp int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if nullif(trim(p_local_id), '') is null then raise exception 'local_id is required'; end if;

  select * into v from monitoring_visits where local_id = p_local_id;
  if found then
    if v.supervisor_id <> auth.uid() then raise exception 'local_id % was already used by another user', p_local_id; end if;
    return jsonb_build_object('visit_id', v.id, 'code', v.code, 'duplicate', true,
                              'findings_raised', (select count(*) from issues where visit_id = v.id));
  end if;

  select * into f from facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found'; end if;
  if not can_supervise(p_facility_id) then raise exception 'You are not assigned to supervise this facility'; end if;
  if p_visit_type = 'store_check' and f.facility_type = 'health_facility' then raise exception 'A store check is for State and LGA stores'; end if;
  if p_visit_type = 'otp_verification' and not f.is_otp_site then raise exception 'An OTP verification is for OTP sites'; end if;
  if p_visit_date is null or p_visit_date > current_date then raise exception 'Visit date is missing or in the future'; end if;
  if p_lat is null or p_lng is null then raise exception 'GPS location is required'; end if;
  if p_visit_type = 'otp_verification' and (p_period_start is null or p_period_end is null or p_period_end > p_visit_date) then
    raise exception 'An OTP verification needs the period recounted, ending on or before the visit date';
  end if;
  if jsonb_typeof(p_checklist) <> 'object' then raise exception 'The checklist is required'; end if;

  if f.lat is not null and f.lng is not null then
    v_distance := round(st_distance(st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
                                    st_setsrid(st_makepoint(f.lng, f.lat), 4326)::geography));
  end if;
  v_geofence := rutf_threshold(f.project_id, 'geofence_m', 150);
  select abbr into v_lga_abbr from lgas where id = f.lga_id;

  insert into monitoring_visits (code, project_id, visit_type, facility_id, supervisor_id, visit_date, period_start, period_end,
    lat, lng, gps_accuracy_m, distance_to_facility_m, outside_geofence, device_id, local_id)
  values ('VIS-' || coalesce(v_lga_abbr, 'GEN') || '-' || to_char(p_visit_date, 'YY') || '-' || lpad(nextval('visit_code_seq')::text, 6, '0'),
    f.project_id, p_visit_type, p_facility_id, auth.uid(), p_visit_date, p_period_start, p_period_end,
    p_lat, p_lng, p_gps_accuracy_m, v_distance, v_distance > v_geofence, coalesce(p_device_id, 'unknown'), p_local_id)
  returning * into v;

  for v_line in select * from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb))
      as x(lot_id uuid, lot_no text, expiry_date date, stock_card_balance int, physical_count int, damaged_count int, expired_count int) loop
    if coalesce(v_line.physical_count, -1) < 0 then raise exception 'Each counted lot needs a count of zero or more'; end if;
    v_lot := resolve_lot(v_line.lot_id, v_line.lot_no, v_line.expiry_date);
    insert into stock_check_lines (visit_id, lot_id, lot_no_seen, expiry_seen, stock_card_balance, system_balance,
      physical_count, damaged_count, expired_count)
    values (v.id, v_lot, v_line.lot_no, v_line.expiry_date, v_line.stock_card_balance,
      ledger_balance(p_facility_id, v_lot, p_visit_date), v_line.physical_count,
      coalesce(v_line.damaged_count, 0), coalesce(v_line.expired_count, 0));
  end loop;

  if p_visit_type = 'store_check' then
    insert into store_checks (visit_id, stock_card_present, stock_card_up_to_date, storage_dry, storage_off_floor,
      storage_ventilated, pests_seen, fefo_followed, notes)
    values (v.id, coalesce((p_checklist->>'stock_card_present')::boolean, false), (p_checklist->>'stock_card_up_to_date')::boolean,
      (p_checklist->>'storage_dry')::boolean, (p_checklist->>'storage_off_floor')::boolean,
      (p_checklist->>'storage_ventilated')::boolean, (p_checklist->>'pests_seen')::boolean,
      (p_checklist->>'fefo_followed')::boolean, p_checklist->>'notes');
  else
    select coalesce(sum(new_admissions), 0)::int, coalesce(sum(sachets_dispensed), 0)::int into v_adm, v_disp
    from otp_daily_dispensing where facility_id = p_facility_id and dispense_date between p_period_start and p_period_end;
    insert into otp_verifications (visit_id, register_present, admissions_counted, sachets_dispensed_counted,
      admissions_recorded, sachets_dispensed_recorded, notes)
    values (v.id, coalesce((p_checklist->>'register_present')::boolean, false),
      (p_checklist->>'admissions_counted')::int, (p_checklist->>'sachets_dispensed_counted')::int,
      v_adm, v_disp, p_checklist->>'notes');
  end if;

  v_raised := evaluate_visit_internal(v.id);

  return jsonb_build_object('visit_id', v.id, 'code', v.code, 'duplicate', false, 'findings_raised', v_raised,
    'distance_to_facility_m', v_distance, 'outside_geofence', v.outside_geofence,
    'sachets_dispensed_recorded', v_disp, 'admissions_recorded', v_adm,
    'lines', (select jsonb_agg(jsonb_build_object('lot_id', lot_id, 'physical_count', physical_count, 'system_balance', system_balance))
              from stock_check_lines where visit_id = v.id));
end;
$$;

-- A supervisor confirms (or a Super Admin confirms) an adjustment a facility recorded (R7).
create or replace function confirm_adjustment(p_txn_id uuid, p_note text default null)
returns stock_transactions language plpgsql security definer set search_path = public as $$
declare t stock_transactions;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into t from stock_transactions where id = p_txn_id for update;
  if not found or t.txn_type <> 'adjustment' then raise exception 'Adjustment not found'; end if;
  if not can_supervise(t.facility_id) then raise exception 'You are not assigned to supervise this facility'; end if;
  if t.status = 'confirmed' then return t; end if; -- idempotent: a retried sync
  if t.status <> 'recorded' then raise exception 'This adjustment can no longer be confirmed'; end if;
  update stock_transactions set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(), confirmation_note = nullif(trim(p_note), '')
  where id = p_txn_id returning * into t;
  return t;
end;
$$;

revoke execute on function evaluate_visit_internal from public, anon, authenticated;
revoke execute on function record_visit, confirm_adjustment, evaluate_visit, can_supervise from public, anon;
grant execute on function record_visit, confirm_adjustment, evaluate_visit, can_supervise to authenticated;

-- ── RLS: reads only; writes go through record_visit ────────────────────────────────────────────
alter table monitoring_visits enable row level security;
alter table stock_check_lines enable row level security;
alter table store_checks enable row level security;
alter table otp_verifications enable row level security;
alter table visit_photos enable row level security;

-- A facility user sees the visits to their facility; everyone else, their project's visits.
create or replace function can_see_visit(p_visit_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from monitoring_visits v where v.id = p_visit_id
      and case when current_user_role() = 'dri' then v.facility_id = current_facility_id()
               else v.supervisor_id = auth.uid() or in_scope(v.project_id) end
  );
$$;

create policy monitoring_visits_select on monitoring_visits for select to authenticated using (can_see_visit(id));
create policy stock_check_lines_select on stock_check_lines for select to authenticated using (can_see_visit(visit_id));
create policy store_checks_select on store_checks for select to authenticated using (can_see_visit(visit_id));
create policy otp_verifications_select on otp_verifications for select to authenticated using (can_see_visit(visit_id));
create policy visit_photos_select on visit_photos for select to authenticated using (can_see_visit(visit_id));
create policy visit_photos_insert on visit_photos for insert to authenticated
  with check (exists (select 1 from monitoring_visits v where v.id = visit_id and v.supervisor_id = auth.uid()));

-- ── Evidence bucket: {supervisor_id}/{visit local_id}/{kind}.jpg ───────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-evidence', 'visit-evidence', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy "visit-evidence select" on storage.objects for select to authenticated
  using (bucket_id = 'visit-evidence' and exists (select 1 from visit_photos p where p.storage_path = name and can_see_visit(p.visit_id)));
create policy "visit-evidence insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'visit-evidence' and (storage.foldername(name))[1] = auth.uid()::text
              and current_user_role() in ('tpm_supervisor', 'super_admin'));



-- ===== 0104_findings_stockout_from_first_receipt.sql =====
-- RUTF Monitoring Platform — migration 0104 (fix to 0102)
-- The stockout rule counted every day of the month before a facility's first delivery as a
-- stockout, so a newly onboarded store or OTP got a stockout Finding for the days before it
-- entered the ledger. Days are now counted from the facility's first receipt (DECISIONS R35).
-- Only the stockout block of evaluate_facility_period_internal changes.

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
    -- From the facility's first receipt: days before it entered the ledger aren't a stockout.
    select g::date as d
    from generate_series(greatest(p_period_start,
                                  (select min(txn_date) from stock_transactions
                                   where facility_id = p_facility_id and txn_type = 'receipt')),
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


-- ===== 0105_rutf_metrics.sql =====
-- RUTF Monitoring Platform — migration 0105 (brief §7, §9, §12.8, milestone M5)
-- The single definitions behind the dashboards, the facility risk score and the Supervision
-- Planner, and the DHIS2 CSV import for triangulation. Every function is SECURITY INVOKER, so a
-- caller only ever aggregates the rows their RLS lets them see. Definitions: DECISIONS R38.
-- (Functions live in public, not a rutf_metrics schema — the API serves public only, R24.)

-- ── Headline KPIs for a period (brief §9) ──────────────────────────────────────────────────────
create or replace function rutf_kpis(p_start date, p_end date)
returns jsonb language sql stable security invoker set search_path = public as $$
  with
  fac as (                                  -- stores and OTP sites live by p_end
    select f.id, f.project_id,
           case when f.facility_type = 'state_store' then 'state_store' when f.facility_type = 'lga_store' then 'lga_store' else 'otp' end as lvl,
           (select min(t.txn_date) from stock_transactions t where t.facility_id = f.id and t.txn_type = 'receipt') as first_receipt
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
  running as (
    select dy.facility_id, dy.d,
           (select coalesce(sum(net), 0) from daily x where x.facility_id = dy.facility_id and x.d < p_start)
             + sum(coalesce(dl.net, 0)) over (partition by dy.facility_id order by dy.d) as balance
    from days dy left join daily dl on dl.facility_id = dy.facility_id and dl.d = dy.d
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
    where c.txn_type = 'physical_count' and coalesce(c.reason, '') <> 'opening balance'
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
$$;

-- ── Per-facility metrics for a period (Stock Integrity, OTP Dispensing, Reporting, risk) ──────
create or replace function facility_metrics(p_start date, p_end date)
returns table (
  facility_id uuid, facility_name text, facility_type facility_type, is_otp_site boolean, lga_id uuid,
  balance int, monthly_outflow numeric, months_of_stock numeric, expired_balance int,
  stockout_days int, last_count_date date, last_variance_pct numeric,
  sachets_prescribed int, sachets_dispensed int, short_pct numeric, children_seen int, new_admissions int,
  dispensing_weeks int, expected_weeks int, count_on_time boolean,
  last_visit_date date, last_vf numeric, open_findings int, open_critical int
) language sql stable security invoker set search_path = public as $$
  with fac as (
    select f.*, (select min(t.txn_date) from stock_transactions t where t.facility_id = f.id and t.txn_type = 'receipt') as first_receipt
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
    exists (select 1 from stock_transactions c where c.facility_id = a.id and c.txn_type = 'physical_count'
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
$$;

-- ── Facility risk score 0–100 (brief §7) ───────────────────────────────────────────────────────
-- Weighted over the last 90 days (DECISIONS R39): last count variance 20, VF deviation 15,
-- transfer discrepancies 10, stockout days 15, short-dispensing 10, reporting gaps 10,
-- open critical Findings 10, days since the last supervision visit 10.
create or replace function facility_risk(p_as_of date default current_date)
returns table (facility_id uuid, facility_name text, facility_type facility_type, lga_id uuid,
               risk_score int, components jsonb, last_visit_date date)
language sql stable security invoker set search_path = public as $$
  with m as (select * from facility_metrics(p_as_of - 89, p_as_of)),
  gaps as (
    select tr.to_facility_id as facility_id, count(*) as n
    from transfers tr where tr.status = 'discrepancy' and tr.received_date between p_as_of - 89 and p_as_of
    group by tr.to_facility_id
  ),
  scored as (
    select m.*,
      least(coalesce(m.last_variance_pct, 0) / 10.0, 1) * 20 as c_variance,
      least(abs(coalesce(m.last_vf, 1) - 1) / 0.2, 1) * 15 as c_vf,
      least(coalesce(g.n, 0) / 3.0, 1) * 10 as c_transfers,
      least(m.stockout_days / 14.0, 1) * 15 as c_stockout,
      least(greatest(coalesce(m.short_pct, 0), 0) / 10.0, 1) * 10 as c_short,
      case when m.is_otp_site and m.expected_weeks > 0 then (1 - least(m.dispensing_weeks::numeric / m.expected_weeks, 1)) * 10 else 0 end as c_reporting,
      least(m.open_critical / 2.0, 1) * 10 as c_critical,
      least(coalesce(p_as_of - m.last_visit_date, 180) / 180.0, 1) * 10 as c_visit
    from m left join gaps g on g.facility_id = m.facility_id
  )
  select facility_id, facility_name, facility_type, lga_id,
    round(c_variance + c_vf + c_transfers + c_stockout + c_short + c_reporting + c_critical + c_visit)::int,
    jsonb_build_object('variance', round(c_variance, 1), 'vf', round(c_vf, 1), 'transfers', round(c_transfers, 1),
                       'stockout', round(c_stockout, 1), 'short_dispensing', round(c_short, 1), 'reporting', round(c_reporting, 1),
                       'critical_findings', round(c_critical, 1), 'since_visit', round(c_visit, 1),
                       'last_variance_pct', last_variance_pct, 'last_vf', last_vf, 'stockout_days', stockout_days),
    last_visit_date
  from scored;
$$;

-- ── Supervision Planner (brief §9, §12.9) ──────────────────────────────────────────────────────
-- For each supervisor, the facilities they cover, ranked: due when high-risk (score ≥ the
-- high-risk threshold) and not visited in 30 days, or not visited in 90 days (once a quarter);
-- the top `workload` due facilities are suggested for the coming month.
insert into rutf_thresholds (project_id, key, value, note)
select p.id, t.key, t.value, t.note from projects p cross join (values
  ('risk_high', 50, 'Facility risk score from which supervision is monthly'),
  ('visits_per_supervisor_month', 8, 'Supervision workload per supervisor per month (5–10)')
) as t(key, value, note)
where p.name = 'Katsina RUTF Pilot'
on conflict (project_id, key) do nothing;

create or replace function supervision_plan(p_as_of date default current_date)
returns table (supervisor_id uuid, supervisor_name text, facility_id uuid, facility_name text, facility_type facility_type,
               lga_id uuid, risk_score int, last_visit_date date, days_since_visit int, due boolean, reason text, suggested boolean,
               rank int)
language sql stable security invoker set search_path = public as $$
  with r as (select * from facility_risk(p_as_of)),
  lim as (
    select coalesce((select max(value) from rutf_thresholds where key = 'risk_high'), 50) as high,
           coalesce((select max(value) from rutf_thresholds where key = 'visits_per_supervisor_month'), 8)::int as workload
  ),
  cover as (
    select p.id as supervisor_id, p.name as supervisor_name, r.*
    from profiles p
    join r on (p.supervision_level = 'otp_sites' and r.facility_type = 'health_facility'
                 and exists (select 1 from supervisor_lgas s where s.profile_id = p.id and s.lga_id = r.lga_id))
           or (p.supervision_level = 'stores' and (r.facility_type = 'state_store'
                 or (r.facility_type = 'lga_store' and exists (select 1 from supervisor_lgas s where s.profile_id = p.id and s.lga_id = r.lga_id))))
    where p.role = 'tpm_supervisor' and p.status = 'active'
  ),
  flagged as (
    select c.*, (p_as_of - c.last_visit_date) as since,
      case
        when c.last_visit_date is null then 'Never visited'
        when c.risk_score >= (select high from lim) and p_as_of - c.last_visit_date > 30 then 'High risk — monthly visit due'
        when p_as_of - c.last_visit_date > 90 then 'Quarterly visit due'
      end as why
    from cover c
  ),
  ranked as (
    select f.*, row_number() over (partition by f.supervisor_id order by (f.why is not null) desc, f.risk_score desc, f.last_visit_date nulls first) as rn
    from flagged f
  )
  select supervisor_id, supervisor_name, facility_id, facility_name, facility_type, lga_id, risk_score, last_visit_date,
         since, why is not null, why, why is not null and rn <= (select workload from lim), rn::int
  from ranked;
$$;

-- ── DHIS2 monthly reports for triangulation (brief §12.8) ──────────────────────────────────────
create table dhis2_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  facility_id uuid not null references facilities(id),
  period date not null,                     -- first day of the reported month
  otp_admissions int,
  sachets_received int,
  sachets_distributed int,
  sachets_wasted int,
  stockout_days int,
  imported_by uuid references profiles(id) default auth.uid(),
  imported_at timestamptz not null default now(),
  unique (facility_id, period),
  check (period = date_trunc('month', period)::date)
);
alter table dhis2_reports enable row level security;
create policy dhis2_reports_select on dhis2_reports for select to authenticated using (in_scope(project_id));
create policy dhis2_reports_write on dhis2_reports for all to authenticated
  using (current_user_role() in ('super_admin', 'project_admin') and in_scope(project_id))
  with check (current_user_role() in ('super_admin', 'project_admin'));

-- DHIS2 against the ledger, per facility and month: received, distributed (dispensed + issued),
-- wasted (losses) and stockout days, with the differences.
create or replace function dhis2_triangulation(p_start date, p_end date)
returns table (facility_id uuid, facility_name text, lga_id uuid, period date,
               dhis2_received int, ledger_received int, dhis2_distributed int, ledger_distributed int,
               dhis2_wasted int, ledger_wasted int, dhis2_stockout_days int, ledger_stockout_days int,
               distributed_diff_pct numeric)
language sql stable security invoker set search_path = public as $$
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
      and g::date >= (select min(txn_date) from stock_transactions t where t.facility_id = r.facility_id and t.txn_type = 'receipt')
  ) so
  where r.period between date_trunc('month', p_start)::date and p_end;
$$;

grant execute on function rutf_kpis, facility_metrics, facility_risk, supervision_plan, dhis2_triangulation to authenticated;


-- ===== 0106_kpis_opening_balance_once.sql =====
-- RUTF Monitoring Platform — migration 0106 (performance fix to 0105)
-- rutf_kpis recomputed each facility's opening balance once per day of the period (a correlated
-- subquery per facility-day), taking ~11 s on the pilot data. The opening balance is now one
-- grouped pass. Same definitions and results (test-kpis.js).

create or replace function rutf_kpis(p_start date, p_end date)
returns jsonb language sql stable security invoker set search_path = public as $$
  with
  fac as (                                  -- stores and OTP sites live by p_end
    select f.id, f.project_id,
           case when f.facility_type = 'state_store' then 'state_store' when f.facility_type = 'lga_store' then 'lga_store' else 'otp' end as lvl,
           (select min(t.txn_date) from stock_transactions t where t.facility_id = f.id and t.txn_type = 'receipt') as first_receipt
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
    where c.txn_type = 'physical_count' and coalesce(c.reason, '') <> 'opening balance'
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
$$;


-- ===== 0107_rls_initplan_performance.sql =====
-- RUTF Monitoring Platform — migration 0107 (performance, no change in who sees what)
-- The RUTF read policies called current_user_role() / in_scope() / current_facility_id() once
-- per row; each call looks up the caller's profile. Over the ~17k-row ledger that made
-- rutf_kpis() hit the API's statement timeout for a reviewer. Wrapping the per-caller values in
-- (select …) lets Postgres evaluate them once per query (an initplan) — Supabase's documented RLS
-- pattern. The rules are identical; test-mobile-role-access, test-ledger, test-findings and
-- test-visits still pass (DECISIONS R40).

-- "In my project" with the caller's values evaluated once: same as in_scope(project_id).
-- in_scope(p) = is_super_admin() or current_project_id() is null or current_project_id() = p

drop policy if exists facilities_select on facilities;
create policy facilities_select on facilities for select to authenticated
  using (
    (select is_super_admin())
    or submitted_by = (select auth.uid())
    or ((select current_user_role()) = 'project_admin'
        and ((select current_project_id()) is null or project_id = (select current_project_id())))
    or (
      status = 'approved'
      and case
        when (select current_user_role()) = 'dri' then
          id = (select current_facility_id())
          or id = (select current_facility_supplier_id())
          or supplied_by_facility_id = (select current_facility_id())
        else (select current_project_id()) is null or project_id = (select current_project_id())
      end
    )
  );

drop policy if exists transfers_select on transfers;
create policy transfers_select on transfers for select to authenticated
  using (case when (select current_user_role()) = 'dri'
              then (select current_facility_id()) in (from_facility_id, to_facility_id)
              else (select is_super_admin()) or (select current_project_id()) is null or project_id = (select current_project_id()) end);

drop policy if exists stock_transactions_select on stock_transactions;
create policy stock_transactions_select on stock_transactions for select to authenticated
  using (case when (select current_user_role()) = 'dri'
              then facility_id = (select current_facility_id())
                   or (txn_type = 'issue' and counterparty_facility_id = (select current_facility_id()))
              else (select is_super_admin()) or (select current_project_id()) is null or project_id = (select current_project_id()) end);

drop policy if exists otp_daily_dispensing_select on otp_daily_dispensing;
create policy otp_daily_dispensing_select on otp_daily_dispensing for select to authenticated
  using (case when (select current_user_role()) = 'dri' then facility_id = (select current_facility_id())
              else (select is_super_admin()) or (select current_project_id()) is null or project_id = (select current_project_id()) end);

drop policy if exists monitoring_visits_select on monitoring_visits;
create policy monitoring_visits_select on monitoring_visits for select to authenticated
  using (case when (select current_user_role()) = 'dri' then facility_id = (select current_facility_id())
              else supervisor_id = (select auth.uid()) or (select is_super_admin())
                   or (select current_project_id()) is null or project_id = (select current_project_id()) end);

-- Visit child rows: visible when their visit is (the visit policy above does the scoping).
drop policy if exists stock_check_lines_select on stock_check_lines;
create policy stock_check_lines_select on stock_check_lines for select to authenticated
  using (exists (select 1 from monitoring_visits v where v.id = visit_id));
drop policy if exists store_checks_select on store_checks;
create policy store_checks_select on store_checks for select to authenticated
  using (exists (select 1 from monitoring_visits v where v.id = visit_id));
drop policy if exists otp_verifications_select on otp_verifications;
create policy otp_verifications_select on otp_verifications for select to authenticated
  using (exists (select 1 from monitoring_visits v where v.id = visit_id));

drop policy if exists dhis2_reports_select on dhis2_reports;
create policy dhis2_reports_select on dhis2_reports for select to authenticated
  using ((select is_super_admin()) or (select current_project_id()) is null or project_id = (select current_project_id()));


-- ===== 0108_pilot_hardening.sql =====
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


-- ===== 0109_void_ledger_entries.sql =====
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


-- ===== 0110_email_without_tpm_link.sql =====
-- RUTF Monitoring Platform — migration 0110
-- Notification emails no longer link to the TPM deployment (tpm-monitoring-platform.vercel.app).
-- The email carries the notification text and asks the reader to sign in; the in-app notification
-- keeps its link (notifications.link), which resolves on whichever deployment the user signs in to.
-- Same function as 0108 otherwise: callable only from the review RPCs, text HTML-escaped.

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
          '<p>Sign in to the RUTF-DTAP Monitoring Platform to view it.</p>'
      ),
      timeout_milliseconds := 8000
    );
  exception when others then
    null;
  end;
end;
$$;


-- ===== 0111_email_sender_setting.sql =====
-- RUTF Monitoring Platform — migration 0111
-- The notification email sender becomes a setting (settings.email_from_address, Super Admin, in
-- Settings → Notifications). Empty = Resend's test sender, onboarding@resend.dev, as today. Set it
-- once the programme's domain is verified in Resend — Resend refuses unverified senders, and
-- create_notification never lets an email failure block the action that triggered it.

alter table settings add column if not exists email_from_address text
  check (email_from_address is null or email_from_address ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$');
comment on column settings.email_from_address is
  'Sender address for notification emails; null = onboarding@resend.dev. The domain must be verified in Resend.';

create or replace function create_notification(p_user_id uuid, p_type text, p_text text, p_link text, p_issue_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_api_key text;
  v_subject text;
  v_ctx text;
  v_from text;
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

    -- Sender: Settings → Notifications; Resend's test sender until the programme's domain is verified.
    v_from := coalesce((select email_from_address from settings where id = 1), 'onboarding@resend.dev');

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
        'from', 'RUTF-DTAP Monitoring Platform <' || v_from || '>',
        'to', jsonb_build_array(v_email),
        'subject', v_subject,
        'html',
          '<p>' || replace(replace(replace(p_text, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>' ||
          '<p>Sign in to the RUTF-DTAP Monitoring Platform to view it.</p>'
      ),
      timeout_milliseconds := 8000
    );
  exception when others then
    null;
  end;
end;
$$;


-- ===== 0112_findings_follow_up_label.sql =====
-- RUTF Monitoring Platform — migration 0112
-- "TPM Sub-Panel" is now "Findings Follow-up" everywhere (DECISIONS R56): assign_issue records that
-- name as the actor of the "Assigned to DRI" history entry. Same function otherwise (live
-- definition, label changed); no stored history rows used the old label.

CREATE OR REPLACE FUNCTION public.assign_issue(p_issue_id uuid, p_dri_id uuid, p_note text DEFAULT NULL::text)
 RETURNS issues
 LANGUAGE plpgsql
AS $function$
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
  values (p_issue_id, auth.uid(), 'Findings Follow-up', 'Assigned to DRI',
    coalesce(p_note, 'Routed to ' || v_dri.name || ' for action.'));

  perform create_notification(p_dri_id, 'assignment',
    'You were assigned finding ' || v_issue.code, '/issues/' || v_issue.id, v_issue.id);

  return v_issue;
end;
$function$;
