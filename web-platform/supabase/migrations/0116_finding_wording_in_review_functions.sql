-- RUTF Monitoring Platform — migration 0116
-- Finding wording in the review functions (DECISIONS R72): history entries and messages no longer
-- say "issue" or "TPM Field Monitor" — "Finding reopened", "Supervisor", "unassigned Findings list".
-- Live definitions with only those strings changed; grants are kept by CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.reject_and_reopen_issue(p_issue_id uuid, p_comment text)
 RETURNS issues
 LANGUAGE plpgsql
AS $function$
declare
  v_issue issues;
  v_already_reopened boolean;
begin
  if coalesce(current_user_role()::text, '') not in ('super_admin', 'project_admin', 'tpm_supervisor') then
    raise exception 'Only a Super Admin, Project Admin, or Supervisor may reopen a finding after verification';
  end if;

  if coalesce(trim(p_comment), '') = '' then
    raise exception 'A comment explaining why the Finding remains unresolved is required';
  end if;

  select (status = 'reopened') into v_already_reopened from issues where id = p_issue_id;

  update issues set status = 'reopened'
    where id = p_issue_id and status in ('resolved', 'reopened')
    returning * into v_issue;
  if not found then
    raise exception 'Issue not found, not awaiting verification, or not permitted';
  end if;

  if not coalesce(v_already_reopened, false) then
    insert into issue_history (issue_id, actor_id, actor_label, action, note) values
      (p_issue_id, auth.uid(), my_name(), 'Final Verification — Not Resolved', p_comment),
      (p_issue_id, auth.uid(), my_name(), 'Finding reopened', 'Routed back to ' ||
        coalesce((select name from profiles where id = v_issue.assigned_dri), 'the assigned DRI') || '.');

    if v_issue.assigned_dri is not null then
      perform create_notification(v_issue.assigned_dri, 'reopened',
        v_issue.code || ' was reopened — additional action required', '/issues/' || v_issue.id, v_issue.id);
    end if;
  end if;

  return v_issue;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dri_self_assign(p_issue_id uuid)
 RETURNS issues
 LANGUAGE plpgsql
AS $function$
declare
  v_issue issues;
begin
  if current_user_role() <> 'dri' then
    raise exception 'Only a DRI may self-assign a Finding';
  end if;

  update issues set status = 'assigned', assigned_dri = auth.uid()
    where id = p_issue_id and status = 'new' and assigned_dri is null
    returning * into v_issue;
  if not found then
    raise exception 'Issue not found, already assigned, or not permitted';
  end if;

  insert into issue_history (issue_id, actor_id, actor_label, action, note)
  values (p_issue_id, auth.uid(), my_name(), 'Self-assigned by DRI',
    'Picked up from the unassigned Findings list on the mobile app.');

  return v_issue;
end;
$function$;

CREATE OR REPLACE FUNCTION public.log_issue_reported()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.auto_generated then
    insert into issue_history (issue_id, actor_id, actor_label, action, note)
    values (new.id, null, 'RUTF Monitoring (automatic check)', 'Finding reported',
            'Raised automatically from ' ||
            case when (select source from finding_types where key = new.finding_type) = 'visit' or new.dedupe_key like '%:visit:%'
                 then 'a supervision visit' else 'the stock ledger' end ||
            ' for review — ' || coalesce((select label from finding_types where key = new.finding_type), new.finding_type) || '.');
  else
    insert into issue_history (issue_id, actor_id, actor_label, action, note)
    values (new.id, new.reported_by, coalesce((select name from profiles where id = new.reported_by), 'Supervisor'),
            'Finding reported', 'Field visit finding logged with photo evidence and GPS capture.');
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.verify_and_close_issue(p_issue_id uuid, p_note text DEFAULT NULL::text)
 RETURNS issues
 LANGUAGE plpgsql
AS $function$
declare
  v_issue issues;
  v_already_closed boolean;
begin
  if coalesce(current_user_role()::text, '') not in ('super_admin', 'project_admin', 'tpm_supervisor') then
    raise exception 'Only a Super Admin, Project Admin, or Supervisor may verify and close a finding';
  end if;

  select (status = 'verified_closed') into v_already_closed from issues where id = p_issue_id;

  update issues set status = 'verified_closed', verified_by = auth.uid(), resolution_date = now()
    where id = p_issue_id
    returning * into v_issue;
  if not found then raise exception 'Issue not found or not permitted'; end if;

  if not coalesce(v_already_closed, false) then
    insert into issue_history (issue_id, actor_id, actor_label, action, note)
    values (p_issue_id, auth.uid(), my_name(), 'Verified and closed',
      coalesce(p_note, 'Confirmed resolution during follow-up visit.'));
  end if;

  return v_issue;
end;
$function$;

