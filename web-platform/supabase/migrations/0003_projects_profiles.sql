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
