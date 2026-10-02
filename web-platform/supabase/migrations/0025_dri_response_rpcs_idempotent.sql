-- Same class of bug as migration 0024, on the DRI-response side: SupabaseSyncApiService.
-- pushDriResponse calls submit_dri_response (always) and record_corrective_action (whenever the
-- response is "Resolved") unconditionally on every push attempt, with no guard against having
-- already succeeded on a prior attempt whose later step (GPS capture / photo upload) then failed
-- before migration 0022/0023's fix. Reproduced live: one test issue (ISS-1073) picked up ~40
-- duplicate "Response submitted"/"Corrective action recorded" history rows from repeated retries
-- before the fix — see chat. Neither RPC had a hard status guard (unlike reject_and_reopen_issue),
-- so this didn't block sync, it just silently spammed history rows and (with migration 0021's
-- email hookup) would send duplicate notifications/emails on every retry too.
--
-- Fix: detect "this exact response/action was already recorded" (the column already holds the
-- same value — both start null and are only ever written by these functions, so equality is a
-- reliable idempotency signal) and skip the history/notification insert in that case, same pattern
-- as 0024. The status/column UPDATE itself is left unconditional — re-applying the same value is
-- harmless and keeps the function simple.
create or replace function submit_dri_response(p_issue_id uuid, p_response text, p_note text default null)
returns issues language plpgsql as $$
declare
  v_issue issues;
  v_already_applied boolean;
begin
  if not exists (select 1 from issues where id = p_issue_id and assigned_dri = auth.uid())
     and not is_super_admin() then
    raise exception 'Only the assigned DRI may submit this response';
  end if;

  select (dri_response is not distinct from p_response) into v_already_applied
    from issues where id = p_issue_id;

  update issues set status = 'in_progress', dri_response = p_response
    where id = p_issue_id
    returning * into v_issue;
  if not found then raise exception 'Issue not found or not permitted'; end if;

  if not coalesce(v_already_applied, false) then
    insert into issue_history (issue_id, actor_id, actor_label, action, note)
    values (p_issue_id, auth.uid(), my_name(), 'Response submitted', coalesce(p_note, p_response));
  end if;

  return v_issue;
end;
$$;

create or replace function record_corrective_action(p_issue_id uuid, p_action_taken text, p_note text default null)
returns issues language plpgsql as $$
declare
  v_issue issues;
  v_already_applied boolean;
begin
  if not exists (select 1 from issues where id = p_issue_id and assigned_dri = auth.uid())
     and not is_super_admin() then
    raise exception 'Only the assigned DRI may record corrective action';
  end if;

  select (corrective_action is not distinct from p_action_taken) into v_already_applied
    from issues where id = p_issue_id;

  update issues set status = 'resolved', corrective_action = p_action_taken
    where id = p_issue_id
    returning * into v_issue;
  if not found then raise exception 'Issue not found or not permitted'; end if;

  if not coalesce(v_already_applied, false) then
    insert into issue_history (issue_id, actor_id, actor_label, action, note)
    values (p_issue_id, auth.uid(), my_name(), 'Corrective action recorded', coalesce(p_note, p_action_taken));

    if v_issue.reported_by is not null then
      perform create_notification(v_issue.reported_by, 'resolved',
        v_issue.code || ' is ready for verification', '/issues/' || v_issue.id, v_issue.id);
    end if;
  end if;

  return v_issue;
end;
$$;
