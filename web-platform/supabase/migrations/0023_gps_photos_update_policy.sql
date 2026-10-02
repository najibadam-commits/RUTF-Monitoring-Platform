-- The Android app now upserts (not plain-inserts) issue_gps_captures/issue_photos so a sync retry
-- after a partial failure can safely re-run without hitting the unique(issue_id, stage[, kind])
-- constraints (see migration 0022 and DECISIONS.md). An upsert whose conflict-resolution path
-- actually hits an existing row is, to Postgres, an UPDATE — and both tables only ever had
-- SELECT/INSERT (issue_gps_captures) or SELECT/INSERT/DELETE (issue_photos) policies. With no
-- UPDATE policy, RLS default-denies it: "new row violates row-level security policy (USING
-- expression)". Adding UPDATE policies with the same shape as each table's existing INSERT policy.
create policy issue_gps_captures_update on issue_gps_captures for update to authenticated
  using (current_user_role() <> 'viewer' and exists (select 1 from issues i where i.id = issue_gps_captures.issue_id))
  with check (current_user_role() <> 'viewer' and exists (select 1 from issues i where i.id = issue_gps_captures.issue_id));

create policy issue_photos_update on issue_photos for update to authenticated
  using (current_user_role() <> 'viewer' and exists (select 1 from issues i where i.id = issue_photos.issue_id))
  with check (current_user_role() <> 'viewer' and exists (select 1 from issues i where i.id = issue_photos.issue_id));
