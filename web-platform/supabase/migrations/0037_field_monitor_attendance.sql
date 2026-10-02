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
