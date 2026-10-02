-- TPM Monitoring Platform — schema migration 18
-- Same fix as 0014 (enforce_profile_update_rules), applied to
-- enforce_dataset_workflow(): auth.uid() is NULL for any connection with no
-- end-user JWT context (service-role client, direct postgres connection) —
-- both already bypass RLS entirely, so the trigger's client-side guardrails
-- should not block them. The RLS policies on settlements/activity_sites are
-- `to authenticated` only, so a NULL auth.uid() here can only mean trusted
-- backend, never a public caller pretending to be nobody.

create or replace function enforce_dataset_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  acting_role user_role;
  business_fields jsonb;
begin
  if auth.uid() is null then
    return coalesce(new, old); -- service-role / direct DB connection: trusted
  end if;

  acting_role := current_user_role();

  if TG_OP = 'INSERT' then
    if acting_role = 'super_admin' then
      NEW.status := 'approved';
      NEW.submitted_by := coalesce(NEW.submitted_by, auth.uid());
      NEW.reviewed_by := auth.uid();
    elsif acting_role = 'project_admin' then
      NEW.status := 'pending_create';
      NEW.submitted_by := auth.uid();
      NEW.reviewed_by := null;
      NEW.project_id := current_project_id();
    else
      raise exception 'Not authorized to add data set entries';
    end if;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if acting_role = 'super_admin' then
      NEW.reviewed_by := auth.uid();
      return NEW;
    elsif acting_role = 'project_admin' then
      if OLD.status = 'approved' then
        if OLD.project_id is distinct from current_project_id() then
          raise exception 'Not authorized to modify entries outside your project';
        end if;
        business_fields := to_jsonb(NEW) - 'id' - 'status' - 'pending_data' - 'submitted_by'
          - 'reviewed_by' - 'review_note' - 'created_at' - 'updated_at' - 'project_id';
        NEW := OLD;
        NEW.pending_data := business_fields;
        NEW.status := 'pending_update';
        NEW.submitted_by := auth.uid();
        NEW.reviewed_by := null;
        NEW.review_note := null;
        return NEW;
      elsif OLD.status in ('pending_create', 'pending_update') and OLD.submitted_by = auth.uid() then
        NEW.status := OLD.status;
        NEW.reviewed_by := null;
        return NEW;
      else
        raise exception 'You can only edit your own pending submissions or an approved entry in your project';
      end if;
    else
      raise exception 'Not authorized to modify data set entries';
    end if;
  end if;

  if TG_OP = 'DELETE' then
    if acting_role = 'super_admin' then
      return OLD;
    elsif acting_role = 'project_admin' then
      if OLD.status = 'pending_create' and OLD.submitted_by = auth.uid() then
        return OLD;
      end if;
      if OLD.status = 'approved' and OLD.project_id is not distinct from current_project_id() then
        execute format(
          'update %I set status = %L, submitted_by = %L, reviewed_by = null, review_note = null, updated_at = now() where id = %L',
          TG_TABLE_NAME, 'pending_delete', auth.uid(), OLD.id
        );
        return null;
      end if;
      raise exception 'Not authorized to delete this entry, or it already has a pending change';
    else
      raise exception 'Not authorized to delete data set entries';
    end if;
  end if;

  return null;
end;
$$;
