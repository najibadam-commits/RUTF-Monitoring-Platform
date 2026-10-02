-- Item 5/6 terminology: the auto-log trigger (migration 0007) writes 'Issue reported' as the
-- issue_history.action text for every new Finding, and 'Field Monitor' as its actor_label
-- fallback — both now stale wording. Text-only change, going forward only:
--
-- Existing rows keep their historical 'Issue reported' value untouched (matches the same
-- preserve-history approach as the category→sector migration) — only NEW inserts after this get
-- the new wording. The Android app's issue_history.action == "Issue reported" matches (used to
-- find the reporter/location on a pulled issue) are updated in the same change to also accept
-- "Finding reported", so both old and new rows resolve correctly either way.

create or replace function log_issue_reported()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into issue_history (issue_id, actor_id, actor_label, action, note)
  values (
    new.id,
    new.reported_by,
    coalesce((select name from profiles where id = new.reported_by), 'TPM Field Monitor'),
    'Finding reported',
    'Field visit finding logged with photo evidence and GPS capture.'
  );
  return new;
end;
$$;
