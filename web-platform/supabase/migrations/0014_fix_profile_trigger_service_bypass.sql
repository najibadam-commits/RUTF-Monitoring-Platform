-- TPM Monitoring Platform — schema migration 14
-- enforce_profile_update_rules() must not block trusted backend writes.
-- auth.uid() is NULL for any connection with no end-user JWT context — the
-- service-role client (used by admin-creation server actions and seed
-- scripts) and a direct superuser/postgres connection both fall in that
-- category, and both already bypass RLS entirely (service_role has
-- bypassrls; a superuser connection isn't subject to RLS at all). The RLS
-- policy on profiles is `to authenticated` only, so an anonymous/unauthenticated
-- PostgREST caller can never reach this trigger in the first place — a NULL
-- auth.uid() here can only mean "trusted backend", never "public caller
-- pretending to be nobody".

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
  return new;
end;
$$;
