-- TPM Monitoring Platform — schema migration 15
-- "Add Data Set" feature: Settlement Lists and Activity Sites, managed by
-- Super Admin and Project Admin, with Project Admin submissions requiring
-- Super Admin approval before going live.
--
-- Column names (statename/lganame/settlementname, activitysitename) are
-- plain text by explicit request, not FKs into states/lgas — these are
-- flat pick-lists synced to a field mobile app, matching how the app's own
-- source boundary files (state.sqlite/LGA.sqlite/Ward.sqlite) already carry
-- state/LGA as denormalized text fields rather than relational IDs. See
-- DECISIONS.md #7.

create type dataset_status as enum ('approved', 'pending_create', 'pending_update', 'pending_delete', 'rejected');

create table settlements (
  id uuid primary key default gen_random_uuid(),
  statename text not null,
  lganame text not null,
  settlementname text not null,
  project_id uuid references projects(id) on delete set null,
  status dataset_status not null default 'approved',
  pending_data jsonb,          -- proposed {statename,lganame,settlementname} while status = pending_update
  submitted_by uuid references profiles(id),
  reviewed_by uuid references profiles(id),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index settlements_status_idx on settlements(status);
create index settlements_project_id_idx on settlements(project_id);
-- Prevents duplicate live/pending entries for the same place; rejected rows
-- are exempt so resubmission after a rejection isn't blocked.
create unique index settlements_unique_name on settlements (statename, lganame, settlementname) where status <> 'rejected';

create table activity_sites (
  id uuid primary key default gen_random_uuid(),
  statename text not null,
  lganame text not null,
  activitysitename text not null,
  project_id uuid references projects(id) on delete set null,
  status dataset_status not null default 'approved',
  pending_data jsonb,
  submitted_by uuid references profiles(id),
  reviewed_by uuid references profiles(id),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index activity_sites_status_idx on activity_sites(status);
create index activity_sites_project_id_idx on activity_sites(project_id);
create unique index activity_sites_unique_name on activity_sites (statename, lganame, activitysitename) where status <> 'rejected';

create trigger settlements_set_updated_at before update on settlements
  for each row execute function set_updated_at();
create trigger activity_sites_set_updated_at before update on activity_sites
  for each row execute function set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
-- Approval workflow — one generic trigger, works on either table because
-- it operates on NEW/OLD as whole records (to_jsonb) rather than naming
-- table-specific columns, so it doesn't need to know settlementname vs
-- activitysitename.
-- ══════════════════════════════════════════════════════════════════════
create or replace function enforce_dataset_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  acting_role user_role := current_user_role();
  business_fields jsonb;
begin
  if TG_OP = 'INSERT' then
    if acting_role = 'super_admin' then
      NEW.status := 'approved';
      NEW.submitted_by := coalesce(NEW.submitted_by, auth.uid());
      NEW.reviewed_by := auth.uid();
    elsif acting_role = 'project_admin' then
      NEW.status := 'pending_create';
      NEW.submitted_by := auth.uid();
      NEW.reviewed_by := null;
      NEW.project_id := current_project_id(); -- always their own project, never client-supplied
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
        -- Redirect the edit into a proposal — live fields (returned to
        -- callers, and to the mobile app) stay exactly as they were.
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
        NEW.status := OLD.status; -- still awaiting review, just revise the proposal
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
      return OLD; -- deletes immediately
    elsif acting_role = 'project_admin' then
      if OLD.status = 'pending_create' and OLD.submitted_by = auth.uid() then
        return OLD; -- withdrawing their own never-approved submission: hard delete is fine
      end if;
      if OLD.status = 'approved' and OLD.project_id is not distinct from current_project_id() then
        execute format(
          'update %I set status = %L, submitted_by = %L, reviewed_by = null, review_note = null, updated_at = now() where id = %L',
          TG_TABLE_NAME, 'pending_delete', auth.uid(), OLD.id
        );
        return null; -- cancel the actual DELETE — it's now a pending request instead
      end if;
      raise exception 'Not authorized to delete this entry, or it already has a pending change';
    else
      raise exception 'Not authorized to delete data set entries';
    end if;
  end if;

  return null;
end;
$$;

create trigger settlements_enforce_workflow before insert or update or delete on settlements
  for each row execute function enforce_dataset_workflow();
create trigger activity_sites_enforce_workflow before insert or update or delete on activity_sites
  for each row execute function enforce_dataset_workflow();

-- ── approval RPCs (Super Admin only — also gated by RLS below) ──────────
create or replace function approve_settlement(p_id uuid, p_note text default null)
returns settlements language plpgsql as $$
declare v_row settlements;
begin
  if not is_super_admin() then raise exception 'Only Super Admin may approve data set entries'; end if;
  select * into v_row from settlements where id = p_id;
  if not found then raise exception 'Entry not found'; end if;

  if v_row.status = 'pending_delete' then
    delete from settlements where id = p_id;
  elsif v_row.status = 'pending_update' then
    update settlements set
      statename = coalesce(pending_data->>'statename', statename),
      lganame = coalesce(pending_data->>'lganame', lganame),
      settlementname = coalesce(pending_data->>'settlementname', settlementname),
      status = 'approved', pending_data = null, reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  elsif v_row.status = 'pending_create' then
    update settlements set status = 'approved', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  else
    raise exception 'This entry has no pending change to approve';
  end if;
  return v_row;
end;
$$;

create or replace function reject_settlement(p_id uuid, p_note text)
returns settlements language plpgsql as $$
declare v_row settlements;
begin
  if not is_super_admin() then raise exception 'Only Super Admin may reject data set entries'; end if;
  select * into v_row from settlements where id = p_id;
  if not found then raise exception 'Entry not found'; end if;

  if v_row.status = 'pending_delete' then
    update settlements set status = 'approved', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  elsif v_row.status = 'pending_update' then
    update settlements set pending_data = null, status = 'approved', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  elsif v_row.status = 'pending_create' then
    update settlements set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  else
    raise exception 'This entry has no pending change to reject';
  end if;
  return v_row;
end;
$$;

create or replace function approve_activity_site(p_id uuid, p_note text default null)
returns activity_sites language plpgsql as $$
declare v_row activity_sites;
begin
  if not is_super_admin() then raise exception 'Only Super Admin may approve data set entries'; end if;
  select * into v_row from activity_sites where id = p_id;
  if not found then raise exception 'Entry not found'; end if;

  if v_row.status = 'pending_delete' then
    delete from activity_sites where id = p_id;
  elsif v_row.status = 'pending_update' then
    update activity_sites set
      statename = coalesce(pending_data->>'statename', statename),
      lganame = coalesce(pending_data->>'lganame', lganame),
      activitysitename = coalesce(pending_data->>'activitysitename', activitysitename),
      status = 'approved', pending_data = null, reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  elsif v_row.status = 'pending_create' then
    update activity_sites set status = 'approved', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  else
    raise exception 'This entry has no pending change to approve';
  end if;
  return v_row;
end;
$$;

create or replace function reject_activity_site(p_id uuid, p_note text)
returns activity_sites language plpgsql as $$
declare v_row activity_sites;
begin
  if not is_super_admin() then raise exception 'Only Super Admin may reject data set entries'; end if;
  select * into v_row from activity_sites where id = p_id;
  if not found then raise exception 'Entry not found'; end if;

  if v_row.status = 'pending_delete' then
    update activity_sites set status = 'approved', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  elsif v_row.status = 'pending_update' then
    update activity_sites set pending_data = null, status = 'approved', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  elsif v_row.status = 'pending_create' then
    update activity_sites set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
    where id = p_id returning * into v_row;
  else
    raise exception 'This entry has no pending change to reject';
  end if;
  return v_row;
end;
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table settlements enable row level security;
alter table activity_sites enable row level security;

-- Approved rows are readable by everyone signed in — this is what the field
-- mobile app's pick-lists query (Supabase's auto-generated REST API is the
-- "sync" mechanism: GET .../settlements?status=eq.approved with a field
-- user's JWT). Pending/rejected rows are visible only to their submitter
-- and to whoever can approve them.
create policy settlements_select on settlements for select to authenticated
  using (
    status = 'approved'
    or submitted_by = auth.uid()
    or is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id))
  );
create policy settlements_insert on settlements for insert to authenticated
  with check (current_user_role() in ('super_admin', 'project_admin'));
create policy settlements_update on settlements for update to authenticated
  using (
    is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id) and (submitted_by = auth.uid() or status = 'approved'))
  )
  with check (is_super_admin() or current_user_role() = 'project_admin');
create policy settlements_delete on settlements for delete to authenticated
  using (
    is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id) and (submitted_by = auth.uid() or status = 'approved'))
  );

create policy activity_sites_select on activity_sites for select to authenticated
  using (
    status = 'approved'
    or submitted_by = auth.uid()
    or is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id))
  );
create policy activity_sites_insert on activity_sites for insert to authenticated
  with check (current_user_role() in ('super_admin', 'project_admin'));
create policy activity_sites_update on activity_sites for update to authenticated
  using (
    is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id) and (submitted_by = auth.uid() or status = 'approved'))
  )
  with check (is_super_admin() or current_user_role() = 'project_admin');
create policy activity_sites_delete on activity_sites for delete to authenticated
  using (
    is_super_admin()
    or (current_user_role() = 'project_admin' and in_scope(project_id) and (submitted_by = auth.uid() or status = 'approved'))
  );

-- ── Realtime — so the Super Admin's approval queue updates live ─────────
alter publication supabase_realtime add table settlements;
alter publication supabase_realtime add table activity_sites;
