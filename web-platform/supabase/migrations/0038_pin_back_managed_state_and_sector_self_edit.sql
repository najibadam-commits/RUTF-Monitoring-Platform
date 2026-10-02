-- Security audit finding (Item 16 — "role & data security enforced at the backend/DB level, not
-- just the frontend UI") — see DECISIONS.md #25.
--
-- enforce_profile_update_rules() (migration 0007) already pins `role`, `project_id`, and `status`
-- back to their old values whenever a non-admin edits their OWN profile row — profiles_update's
-- RLS policy allows `id = auth.uid()`, so without this trigger a user could self-escalate by
-- PATCHing their own row directly (bypassing every "only an admin assigns this" UI control).
--
-- Migration 0031 (state_coordinator_sector_schema) added two more columns to profiles that are
-- just as security-sensitive — `managed_state_id` (which state a State Coordinator can review/
-- approve Findings in) and `assigned_category_id` (which sector a DRI can see Findings for) — but
-- never added them to this same pin-back list. Confirmed exploitable: a `dri` account could PATCH
-- its own `assigned_category_id` to a different sector's id and immediately gain visibility into
-- that sector's Findings via issues_select's `category_id = profiles.assigned_category_id` check;
-- a `state_coordinator` account could do the same to `managed_state_id` and gain review/approve
-- authority over a state they were never assigned. Neither requires any UI bug — a raw REST call
-- with a valid session is enough, since Supabase's anon/authenticated model always allows that.
--
-- Fix: extend the exact same pin-back the trigger already does for role/project_id/status.
-- Project Admin (and Super Admin) are unaffected — they're the roles meant to set these two
-- columns for OTHER users (see UsersTable.tsx's Managed State / Assigned Sector fields), and this
-- only tightens the final "editing my own row" branch.

create or replace function enforce_profile_update_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  acting_role user_role;
begin
  if auth.uid() is null then
    return new; -- service-role / direct DB connection: trusted, no client-side guard needed
  end if;

  acting_role := current_user_role();

  if acting_role = 'super_admin' then
    return new;
  end if;

  if acting_role = 'project_admin' then
    if old.project_id is distinct from current_project_id() then
      raise exception 'Not authorized to modify profiles outside your project';
    end if;
    if new.role in ('super_admin', 'project_admin') and new.role is distinct from old.role then
      raise exception 'Project Admin cannot assign the % role', new.role;
    end if;
    return new;
  end if;

  if old.id is distinct from auth.uid() then
    raise exception 'Not authorized to modify other profiles';
  end if;
  new.role := old.role;
  new.project_id := old.project_id;
  new.status := old.status;
  new.managed_state_id := old.managed_state_id;
  new.assigned_category_id := old.assigned_category_id;
  return new;
end;
$$;
