-- One MOV + one selfie per (issue, stage) is the actual usage pattern (see PhotoInsertDto /
-- uploadPhoto in the Android app — storage path is always "<issue_id>/<stage>_<kind>.jpg", so the
-- file itself already overwrites on retry via upsert=true). The DB row was never given the
-- matching constraint, so a retried sync could leave duplicate issue_photos rows pointing at the
-- same (now-overwritten) storage path. Add the constraint so the app-side fix (upsert instead of
-- plain insert, same change made to issue_gps_captures' existing unique(issue_id, stage) handling)
-- has something to target. No existing duplicates as of this migration (checked before applying).
alter table issue_photos add constraint issue_photos_issue_id_stage_kind_key unique (issue_id, stage, kind);
