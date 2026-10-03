-- RUTF Monitoring Platform — migration 0112
-- "TPM Sub-Panel" is now "Findings Follow-up" everywhere (DECISIONS R56): assign_issue records that
-- name as the actor of the "Assigned to DRI" history entry. Same function otherwise (live
-- definition, label changed); no stored history rows used the old label.

CREATE OR REPLACE FUNCTION public.assign_issue(p_issue_id uuid, p_dri_id uuid, p_note text DEFAULT NULL::text)
 RETURNS issues
 LANGUAGE plpgsql
AS $function$
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
  values (p_issue_id, auth.uid(), 'Findings Follow-up', 'Assigned to DRI',
    coalesce(p_note, 'Routed to ' || v_dri.name || ' for action.'));

  perform create_notification(p_dri_id, 'assignment',
    'You were assigned finding ' || v_issue.code, '/issues/' || v_issue.id, v_issue.id);

  return v_issue;
end;
$function$;
