-- Two pre-existing role gaps found while testing mobile access for senior roles (DECISIONS.md #31).
-- Neither is caused by that change; both are fixed here, additively, without touching any other
-- policy or function.

-- ─── 1. State Coordinator / Project Admin could not see any DRI, so could not assign one ────────
-- profiles_select (0008) is: own row, or Super Admin, or a Project Admin whose project_id equals
-- the row's. So:
--   * a State Coordinator saw only their own profile, and
--   * a Project Admin with no project_id (all real ones today — in_scope() treats that as "sees
--     everything" everywhere else) matched nothing either, because `null = null` is not true.
-- approve_and_assign_finding is SECURITY INVOKER and validates the chosen DRI with
-- `select ... from profiles where id = p_dri_id and role = 'dri'` — under those policies that
-- found nobody, so approve+assign raised "Selected user is not a DRI" for a State Coordinator
-- (and for a project-less Project Admin). The web's DRI picker (getDris) queries profiles as the
-- caller too, so it was empty for the same reason.
--
-- Fix: one narrow, additive SELECT policy — these two reviewing roles may read ACTIVE DRI
-- profiles, nothing else. Choosing a DRI to assign is inherent to the review action they already
-- have (0032/0040), so this exposes no more than the action itself needs. A Project Admin is still
-- limited by in_scope() (same null-passthrough rule as every other Project Admin capability); a
-- State Coordinator sees DRIs across projects, matching how they already see Findings by state
-- rather than by project. Permissive policies OR together, so nothing existing is narrowed.

create policy profiles_select_dris_for_reviewers on profiles for select to authenticated
  using (
    role = 'dri'
    and status = 'active'
    and (
      current_user_role() = 'state_coordinator'
      or (current_user_role() = 'project_admin' and in_scope(project_id))
    )
  );

-- ─── 2. A DRI could verify/close or reject/reopen their own Finding through the API ─────────────
-- verify_and_close_issue and reject_and_reopen_issue (0024) have no role check of their own and
-- rely on issues_update RLS, which lets the assigned DRI update their row — so a DRI calling the
-- RPC directly could close (or reopen) their own work, defeating "no Finding closes on
-- self-reporting alone". The web and mobile UIs never offer it; the API did.
--
-- Fix: the same roles the web's canVerify grants — Super Admin, Project Admin, TPM Field Monitor
-- — checked up front. Bodies are otherwise exactly 0024's (idempotent-retry behaviour included).
-- coalesce() because current_user_role() is null for a caller with no profile, and
-- `null not in (...)` is null, which would let the guard fall through.

create or replace function reject_and_reopen_issue(p_issue_id uuid, p_comment text)
returns issues language plpgsql as $$
declare
  v_issue issues;
  v_already_reopened boolean;
begin
  if coalesce(current_user_role()::text, '') not in ('super_admin', 'project_admin', 'tpm_supervisor') then
    raise exception 'Only a Super Admin, Project Admin, or TPM Field Monitor may reopen a finding after verification';
  end if;

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
  if coalesce(current_user_role()::text, '') not in ('super_admin', 'project_admin', 'tpm_supervisor') then
    raise exception 'Only a Super Admin, Project Admin, or TPM Field Monitor may verify and close a finding';
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
$$;
