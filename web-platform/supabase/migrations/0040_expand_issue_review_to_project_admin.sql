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
