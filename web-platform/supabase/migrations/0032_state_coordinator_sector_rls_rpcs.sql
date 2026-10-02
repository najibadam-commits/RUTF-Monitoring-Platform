-- State Coordinator review/approval workflow + DRI sector scoping — RLS, RPCs, and the
-- category→sector data swap. Must run after 0031 has committed (see its header comment for why).
-- See DECISIONS.md #22.

-- ─── 1. New Findings start in review, not "new" ────────────────────────────────────────────
-- Existing 'new'-status Findings are deliberately left untouched and keep flowing through the
-- pre-existing dri_self_assign/assign_issue paths (both unchanged below) — "treat existing
-- Findings as already-approved" per the agreed migration approach. Only Findings inserted after
-- this migration ever reach 'pending_review'.

alter table issues alter column status set default 'pending_review';

-- ─── 2. Category → Sector data swap ─────────────────────────────────────────────────────────
-- Old categories were incident *types*; the new Sector list is humanitarian program *areas* — a
-- different taxonomy, not a 1:1 rename (see 0031's is_active comment). Rows a real Finding still
-- references (Water & Sanitation Failure / Infrastructure Damage / Safety Incident) keep their
-- id/name so that Finding's historical label stays accurate, but stop being offered for new
-- submissions. The 7 rows nothing ever referenced are simply removed and replaced.

update categories set is_active = false
  where name in ('Water & Sanitation Failure', 'Infrastructure Damage', 'Safety Incident');

delete from categories
  where name in (
    'Supply Chain / Stockout', 'Service Quality Complaint', 'Data Discrepancy',
    'Staff Absenteeism', 'Equipment Malfunction', 'Environmental Hazard', 'Community Grievance'
  );

insert into categories (name, sort_order, abbr, is_active) values
  ('Protection & AAP', 0, 'PRO', true),
  ('Nutrition (OTP)', 1, 'NUT', true),
  ('Health Services', 2, 'HEA', true),
  ('WASH', 3, 'WAS', true),
  ('MHPSS Services', 4, 'MHP', true),
  ('Food Assistance', 5, 'FOD', true),
  ('Fraud', 6, 'FRA', true);

-- ─── 3. issues_select: narrow State Coordinator/DRI, preserve everyone else exactly ─────────
-- The previous policy was a single blanket `in_scope(project_id)` grant with no role condition
-- at all — every authenticated role, DRI included, could see every Finding in scope. Replaced
-- with the same effective access for super_admin/project_admin/tpm_supervisor/viewer, plus real
-- restriction for the two roles this item is actually about.

drop policy issues_select on issues;

create policy issues_select on issues for select to authenticated using (
  is_super_admin()
  or (
    current_user_role() = any (array['project_admin'::user_role, 'tpm_supervisor'::user_role, 'viewer'::user_role])
    and in_scope(project_id)
  )
  or (
    current_user_role() = 'state_coordinator'
    and state_id = (select managed_state_id from profiles where id = auth.uid())
  )
  or (
    -- Both conditions matter: assigned_dri alone isn't enough — see DECISIONS.md #22's note on
    -- why sector is re-checked here even though a State Coordinator should only ever assign
    -- within a DRI's sector; this is the actual enforcement, not just trusting that discipline.
    current_user_role() = 'dri'
    and assigned_dri = auth.uid()
    and category_id = (select assigned_category_id from profiles where id = auth.uid())
  )
);

-- ─── 4. issues_update: additive carve-out for the coordinator's own review actions ──────────
-- A separate policy (not touching the existing issues_update) so nothing about the tested
-- existing per-role rules changes — permissive policies OR together, so this only ever adds
-- access, never removes any.

create policy issues_update_state_coordinator on issues for update to authenticated using (
  current_user_role() = 'state_coordinator'
  and state_id = (select managed_state_id from profiles where id = auth.uid())
  and status = any (array['pending_review'::issue_status, 'returned_for_correction'::issue_status])
) with check (
  current_user_role() = 'state_coordinator'
  and state_id = (select managed_state_id from profiles where id = auth.uid())
);

-- ─── 5. create_notification: subject line for the new "returned" type ──────────────────────

create or replace function create_notification(p_user_id uuid, p_type text, p_text text, p_link text, p_issue_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_api_key text;
  v_subject text;
begin
  insert into notifications (user_id, type, text, link, issue_id)
  values (p_user_id, p_type, p_text, p_link, p_issue_id);

  begin
    select u.email into v_email from auth.users u where u.id = p_user_id;
    if v_email is null then
      return;
    end if;

    select decrypted_secret into v_api_key
      from vault.decrypted_secrets where name = 'resend_api_key';
    if v_api_key is null then
      return;
    end if;

    v_subject := case p_type
      when 'assignment' then 'New finding assigned to you'
      when 'resolved' then 'Your reported finding was resolved — awaiting your verification'
      when 'reopened' then 'A finding was reopened and needs your attention'
      when 'returned' then 'A finding you submitted was returned for correction'
      else 'TPM Monitoring Platform notification'
    end;

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_api_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'from', 'TPM Monitoring Platform <onboarding@resend.dev>',
        'to', jsonb_build_array(v_email),
        'subject', v_subject,
        'html',
          '<p>' || p_text || '</p>' ||
          case when p_link is not null
            then '<p><a href="https://tpm-monitoring-platform.vercel.app' || p_link || '">View in the platform</a></p>'
            else ''
          end
      ),
      timeout_milliseconds := 8000
    );
  exception when others then
    null;
  end;
end;
$$;

-- ─── 6. approve_and_assign_finding: the ONLY place a fresh assignment notification fires ────
-- Combined approve+assign in one action per the agreed design — a coordinator picks a DRI and
-- approves at once, rather than "Approved" being its own separately-persisted, unassigned status.
-- SECURITY INVOKER (no `security definer` — matches dri_self_assign/assign_issue's existing
-- convention): the UPDATE below runs as the caller and is genuinely gated by
-- issues_update_state_coordinator above, not just by the explicit role check.

create or replace function approve_and_assign_finding(p_issue_id uuid, p_dri_id uuid, p_note text default null)
returns issues
language plpgsql
as $$
declare
  v_issue issues;
  v_dri record;
begin
  if current_user_role() <> 'state_coordinator' then
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

  -- The only call to create_notification for a newly-approved finding — deliberately absent from
  -- the initial insert path, per "do not notify the DRI until after approval and assignment".
  perform create_notification(p_dri_id, 'assignment',
    'You were assigned finding ' || v_issue.code, '/issues/' || v_issue.id, v_issue.id);

  return v_issue;
end;
$$;

-- ─── 7. return_finding_for_correction ───────────────────────────────────────────────────────

create or replace function return_finding_for_correction(p_issue_id uuid, p_comment text)
returns issues
language plpgsql
as $$
declare
  v_issue issues;
begin
  if current_user_role() <> 'state_coordinator' then
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

-- ─── 8. edit_issue_submission: extend to the assigned State Coordinator ─────────────────────
-- Reuses the existing edit RPC rather than adding a parallel one — same fields, same history
-- event, just a second class of caller who may invoke it while the finding awaits their review.

create or replace function edit_issue_submission(p_issue_id uuid, p_category_id uuid, p_priority issue_priority, p_description text)
returns issues
language plpgsql
as $$
declare
  v_issue issues;
  v_coordinator_can_edit boolean;
begin
  select (
    current_user_role() = 'state_coordinator'
    and state_id = (select managed_state_id from profiles where id = auth.uid())
    and status = any (array['pending_review'::issue_status, 'returned_for_correction'::issue_status])
  ) into v_coordinator_can_edit
  from issues where id = p_issue_id;

  if not is_super_admin() and not coalesce(v_coordinator_can_edit, false) then
    raise exception 'Only Super Admin or the assigned State Coordinator may edit a submission';
  end if;

  update issues set category_id = p_category_id, priority = p_priority, description = p_description
    where id = p_issue_id
    returning * into v_issue;
  if not found then raise exception 'Finding not found'; end if;

  insert into issue_history (issue_id, actor_id, actor_label, action, note)
  values (p_issue_id, auth.uid(), my_name(), 'Submission edited', 'Corrected field data on this submission.');

  return v_issue;
end;
$$;
