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
