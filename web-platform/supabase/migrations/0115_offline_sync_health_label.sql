-- RUTF Monitoring Platform — migration 0115
-- Devices & Sync is now "Offline Sync Health" (DECISIONS R66): the morning sync digest points
-- administrators there. Same function as 0108 otherwise (live definition, wording changed); the
-- grants are kept (internal — not callable by API roles).

CREATE OR REPLACE FUNCTION public.notify_sync_problems()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a record;
  v_n int;
  v_sent int := 0;
begin
  for a in select p.id, p.role, p.project_id from profiles p
           where p.status = 'active' and p.role in ('super_admin', 'project_admin') loop
    select count(*) into v_n from sync_health_internal(case when a.role = 'super_admin' then null else a.project_id end) h
    where h.status in ('failing', 'stuck', 'not_syncing');
    continue when v_n = 0;
    continue when exists (select 1 from notifications n where n.user_id = a.id and n.type = 'sync_alert'
                          and not n.read and n.created_at > now() - interval '20 hours');
    insert into notifications (user_id, type, text, link)
    values (a.id, 'sync_alert',
            v_n || case when v_n = 1 then ' device user has' else ' device users have' end
              || ' records waiting to sync or have not synced recently. See Offline Sync Health.',
            '/devices');
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$function$;
