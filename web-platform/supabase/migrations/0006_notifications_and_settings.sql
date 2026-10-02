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
