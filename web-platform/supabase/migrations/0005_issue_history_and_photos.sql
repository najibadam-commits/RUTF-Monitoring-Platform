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
