-- RUTF Monitoring Platform — migration 0123
-- Findings are never deleted (DECISIONS R129). The app lost its Delete button in R126; this closes
-- the two ways left to delete one through the API, both Super Admin only since 0007/0009:
--   • the delete_issue_submission() function, and
--   • the issues_delete row-level security policy (a DELETE on issues straight through the API).
-- With no DELETE policy, row-level security refuses every delete on issues for signed-in users, so
-- every Finding is followed to verified closure and stays on record with its history. A mistaken
-- one is returned for correction or edited. Administrator scripts on the database connection
-- (e.g. removing DUMMY demo data) are not affected.

drop policy if exists issues_delete on issues;
drop function if exists delete_issue_submission(uuid);
