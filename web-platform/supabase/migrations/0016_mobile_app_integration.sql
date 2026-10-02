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
