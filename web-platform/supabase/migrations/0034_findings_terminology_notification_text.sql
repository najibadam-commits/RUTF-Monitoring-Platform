-- Item 6 (Issues → Findings terminology): the legacy assign_issue RPC's notification text still
-- said "issue" — the only remaining backend-generated user-facing string using the old wording
-- (approve_and_assign_finding/return_finding_for_correction/create_notification's subject lines
-- were already updated in migration 0032). Text-only change, no behavior/signature change.

create or replace function assign_issue(p_issue_id uuid, p_dri_id uuid, p_note text default null)
returns issues
language plpgsql
as $$
declare
  v_dri record;
  v_issue issues;
begin
  select id, name into v_dri from profiles where id = p_dri_id and role = 'dri';
  if not found then
    raise exception 'Selected user is not a DRI';
  end if;

  update issues set status = 'assigned', assigned_dri = p_dri_id
    where id = p_issue_id
    returning * into v_issue;
  if not found then
    raise exception 'Issue not found or not permitted';
  end if;

  insert into issue_history (issue_id, actor_id, actor_label, action, note)
  values (p_issue_id, auth.uid(), 'TPM Sub-Panel', 'Assigned to DRI',
    coalesce(p_note, 'Routed to ' || v_dri.name || ' for action.'));

  perform create_notification(p_dri_id, 'assignment',
    'You were assigned finding ' || v_issue.code, '/issues/' || v_issue.id, v_issue.id);

  return v_issue;
end;
$$;
