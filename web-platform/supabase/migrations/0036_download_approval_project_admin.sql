-- Item 7: download approval was Super Admin-only at the actual RLS/RPC level (decide_download_
-- request is SECURITY INVOKER — it only succeeds because of download_requests_update's RLS, which
-- was `is_super_admin()` alone). Adds Project Admin, scoped to their own project — matching the
-- same super_admin=unscoped / project_admin=in_scope(project_id) pattern already used everywhere
-- else in this schema (issues, profiles, ...), rather than granting platform-wide approval.
--
-- Additive policies (not a rewrite of the existing simple ones) — same reasoning as the State
-- Coordinator RLS in migration 0032: adding, never touching what already works for Super Admin.

create policy download_requests_select_project_admin on download_requests for select to authenticated using (
  current_user_role() = 'project_admin' and in_scope(project_id)
);

create policy download_requests_update_project_admin on download_requests for update to authenticated using (
  current_user_role() = 'project_admin' and in_scope(project_id)
) with check (
  current_user_role() = 'project_admin' and in_scope(project_id)
);

-- Notify the requester's own Project Admin(s) too, not just every Super Admin — they can now
-- actually act on it.
create or replace function create_download_request(p_resource_type text, p_format text, p_filters jsonb, p_reason text default null)
returns download_requests
language plpgsql
as $$
declare
  v_request download_requests;
  v_admin record;
begin
  insert into download_requests (requester_id, project_id, resource_type, format, filters, reason)
  values (auth.uid(), current_project_id(), p_resource_type, p_format, coalesce(p_filters, '{}'::jsonb), p_reason)
  returning * into v_request;

  for v_admin in
    select id from profiles where role = 'super_admin'
    union
    select id from profiles where role = 'project_admin' and project_id = v_request.project_id
  loop
    perform create_notification(v_admin.id, 'download_request',
      coalesce(my_name(), 'A viewer') || ' requested a ' || p_resource_type || ' download',
      '/download-requests', null);
  end loop;

  return v_request;
end;
$$;
