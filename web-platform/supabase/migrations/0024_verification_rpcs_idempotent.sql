-- reject_and_reopen_issue/verify_and_close_issue push from the mobile app's sync queue, which
-- retries a submission from the top if ANY step later in the same push fails (GPS capture, photo
-- upload) — see the Android repo's SupabaseSyncApiService.pushFinalVerification. Before the
-- GPS/photo upsert fix (migration 0022/0023 + the matching Android change), a retry after the RPC
-- had already succeeded would call it again — reject_and_reopen_issue's `where status = 'resolved'`
-- guard then permanently failed every subsequent retry (the issue is now correctly 'reopened', not
-- 'resolved' — a real state, just not the one this stale retry expects), leaving that queue item
-- stuck forever with no way to succeed. Reproduced live: see chat, issue ISS-1073.
--
-- Fix: tolerate being re-called when the issue is already in the exact state this call would
-- produce, treating it as a successful no-op rather than an error — and skip re-inserting
-- history/notifications in that case so a stuck-then-retried client doesn't spam duplicates.
create or replace function reject_and_reopen_issue(p_issue_id uuid, p_comment text)
returns issues language plpgsql as $$
declare
  v_issue issues;
  v_already_reopened boolean;
begin
  if coalesce(trim(p_comment), '') = '' then
    raise exception 'A comment explaining why the issue remains unresolved is required';
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
      (p_issue_id, auth.uid(), my_name(), 'Issue Reopened', 'Routed back to ' ||
        coalesce((select name from profiles where id = v_issue.assigned_dri), 'the assigned DRI') || '.');

    if v_issue.assigned_dri is not null then
      perform create_notification(v_issue.assigned_dri, 'reopened',
        v_issue.code || ' was reopened — additional action required', '/issues/' || v_issue.id, v_issue.id);
    end if;
  end if;

  return v_issue;
end;
$$;

create or replace function verify_and_close_issue(p_issue_id uuid, p_note text default null)
returns issues language plpgsql as $$
declare
  v_issue issues;
  v_already_closed boolean;
begin
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
$$;
