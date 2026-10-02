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
