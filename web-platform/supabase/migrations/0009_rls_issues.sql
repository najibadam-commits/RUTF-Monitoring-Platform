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
