-- TPM Monitoring Platform — schema migration 10/11
-- Storage: one private bucket for issue evidence photos, one folder per
-- issue (README: "issue photo evidence... maps to a Supabase Storage
-- bucket, one folder per issue"). Objects are named `{issue_id}/{filename}`.
-- Access is never public — always via signed URL, gated by the same
-- project/role scoping as the issues table itself.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'issue-evidence', 'issue-evidence', false,
  10485760, -- 10 MB per file
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

create policy "issue-evidence select" on storage.objects for select to authenticated
  using (
    bucket_id = 'issue-evidence'
    and exists (
      select 1 from issues i
      where i.id::text = (storage.foldername(name))[1]
        and in_scope(i.project_id)
    )
  );

create policy "issue-evidence insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'issue-evidence'
    and current_user_role() <> 'viewer'
    and exists (
      select 1 from issues i
      where i.id::text = (storage.foldername(name))[1]
        and in_scope(i.project_id)
    )
  );

create policy "issue-evidence delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'issue-evidence'
    and (
      is_super_admin()
      or (
        current_user_role() = 'project_admin'
        and exists (
          select 1 from issues i
          where i.id::text = (storage.foldername(name))[1]
            and in_scope(i.project_id)
        )
      )
    )
  );
