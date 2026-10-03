-- RUTF Monitoring Platform — migration 0113
-- Target time for a Finding to be verified and closed, used by the Accountability Scorecard's
-- "open past target" measure (DECISIONS R57). [VALIDATE] with the programme; Super Admin edits it in
-- Data Sets → Thresholds.

insert into rutf_thresholds (project_id, key, value, note)
select p.id, 'finding_target_days', 30, 'Days for a Finding to be verified and closed (Accountability Scorecard target)'
from projects p where p.name = 'Katsina RUTF Pilot'
on conflict (project_id, key) do nothing;
