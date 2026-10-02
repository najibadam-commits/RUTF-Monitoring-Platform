-- TPM Monitoring Platform — schema migration 31
-- Fixes "Database error deleting user" on permanent user removal.
--
-- Root cause (confirmed against the live database, not assumed): deleting an auth.users row
-- cascades to delete its profiles row (`profiles_id_fkey ... ON DELETE CASCADE`, migration 0003).
-- But 12 columns across 8 tables reference profiles(id) with the default NO ACTION, so if the
-- profile being deleted is referenced anywhere in operational/historical data, that cascade fails
-- with a foreign-key violation and the whole auth.users DELETE rolls back — GoTrue surfaces this
-- as the generic "Database error deleting user". Reproduced directly: deleting profile
-- ffd4596b-25c1-4a4b-89cd-b22c7abe8f92 (Adam najib, a DRI with 3 assigned issues) failed with
-- "violates foreign key constraint issues_assigned_dri_fkey".
--
-- Fix: these 12 columns all identify *who did something*, not *what happened* — the operational/
-- audit record (the issue, the history entry, the photo, the GPS capture, the settlement, the
-- settings row) must survive the user's removal. Switching them to ON DELETE SET NULL preserves
-- every one of those records while letting the now-meaningless user reference clear itself, so a
-- Super Admin can finally delete the auth user without deleting any historical data.
--
-- Deliberately NOT touched: download_requests.requester_id and notifications.user_id are already
-- ON DELETE CASCADE (migration 0030 / 0006) and NOT NULL — both are genuinely "this row belongs to
-- that user" data (a viewer's own download request, a user's own notification inbox), not a
-- historical record ABOUT something else, so cascading them away with the account is correct and
-- is left as-is here.

alter table issues drop constraint issues_reported_by_fkey;
alter table issues add constraint issues_reported_by_fkey
  foreign key (reported_by) references profiles(id) on delete set null;

alter table issues drop constraint issues_assigned_dri_fkey;
alter table issues add constraint issues_assigned_dri_fkey
  foreign key (assigned_dri) references profiles(id) on delete set null;

alter table issues drop constraint issues_verified_by_fkey;
alter table issues add constraint issues_verified_by_fkey
  foreign key (verified_by) references profiles(id) on delete set null;

alter table issue_history drop constraint issue_history_actor_id_fkey;
alter table issue_history add constraint issue_history_actor_id_fkey
  foreign key (actor_id) references profiles(id) on delete set null;

alter table issue_photos drop constraint issue_photos_uploaded_by_fkey;
alter table issue_photos add constraint issue_photos_uploaded_by_fkey
  foreign key (uploaded_by) references profiles(id) on delete set null;

alter table issue_gps_captures drop constraint issue_gps_captures_captured_by_fkey;
alter table issue_gps_captures add constraint issue_gps_captures_captured_by_fkey
  foreign key (captured_by) references profiles(id) on delete set null;

alter table settlements drop constraint settlements_submitted_by_fkey;
alter table settlements add constraint settlements_submitted_by_fkey
  foreign key (submitted_by) references profiles(id) on delete set null;

alter table settlements drop constraint settlements_reviewed_by_fkey;
alter table settlements add constraint settlements_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

alter table activity_sites drop constraint activity_sites_submitted_by_fkey;
alter table activity_sites add constraint activity_sites_submitted_by_fkey
  foreign key (submitted_by) references profiles(id) on delete set null;

alter table activity_sites drop constraint activity_sites_reviewed_by_fkey;
alter table activity_sites add constraint activity_sites_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

alter table settings drop constraint settings_updated_by_fkey;
alter table settings add constraint settings_updated_by_fkey
  foreign key (updated_by) references profiles(id) on delete set null;

alter table download_requests drop constraint download_requests_reviewed_by_fkey;
alter table download_requests add constraint download_requests_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;
