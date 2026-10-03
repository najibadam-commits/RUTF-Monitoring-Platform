-- RUTF Monitoring Platform — migration 0117
-- role_label(): tpm_supervisor reads "Supervisor" (as on the web since DECISIONS R5), so history entries say
-- "Approved by Supervisor" / "Returned for correction by Supervisor" (DECISIONS R72). Same function otherwise.

CREATE OR REPLACE FUNCTION public.role_label(p_role user_role)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_role
    when 'super_admin' then 'Super Admin'
    when 'project_admin' then 'Project Admin'
    when 'state_coordinator' then 'State Coordinator'
    when 'tpm_supervisor' then 'Supervisor'
    when 'dri' then 'Direct Responsible Individual (DRI)'
    when 'viewer' then 'Viewer'
  end
$function$;
