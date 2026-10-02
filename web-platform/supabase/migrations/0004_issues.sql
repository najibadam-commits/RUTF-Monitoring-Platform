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
