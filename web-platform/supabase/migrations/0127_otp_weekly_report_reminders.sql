-- RUTF Monitoring Platform — migration 0127
-- Weekly OTP report reminders (DECISIONS R149; brief §6). Every morning, the OTP Officers of each
-- active OTP site whose report for the last complete week is not yet submitted get an in-app
-- notification: the day before it is due ("due tomorrow"), and every day once it is overdue. One
-- reminder per officer per day. The deadline is the threshold otp_report_due_days_after (default
-- 2 days after the week ends: Tuesday). Returned reports are reminded the same way.

create or replace function otp_report_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_week date := lower(otp_week_of(current_date - 7))::date;   -- the last complete week
  v_count int := 0;
  r record;
begin
  for r in
    select p.id as user_id, f.name as site, f.project_id,
           v_week + 6 + rutf_threshold(f.project_id, 'otp_report_due_days_after', 2)::int as due,
           coalesce(rep.status, 'not_started') as status
    from facilities f
    join profiles p on p.facility_id = f.id and p.role = 'dri' and p.status = 'active'
    left join otp_weekly_reports rep on rep.facility_id = f.id and rep.week_start = v_week
    where f.facility_type = 'health_facility' and f.is_otp_site and f.is_active and f.status = 'approved'
      and coalesce(rep.status, 'not_started') in ('not_started', 'draft', 'returned')
  loop
    if current_date = r.due - 1 or current_date > r.due then
      if not exists (select 1 from notifications n where n.user_id = r.user_id and n.type = 'weekly_report_reminder' and n.created_at::date = current_date) then
        insert into notifications (user_id, type, text, link)
        values (r.user_id, 'weekly_report_reminder',
          case when current_date > r.due
            then format('The weekly OTP report for %s (week of %s) is overdue: it was due %s%s', r.site, to_char(v_week, 'DD Mon'), to_char(r.due, 'DD Mon'),
                        case when r.status = 'returned' then '. It was returned for revision.' else '' end)
            else format('The weekly OTP report for %s (week of %s) is due tomorrow', r.site, to_char(v_week, 'DD Mon')) end,
          null);
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke execute on function otp_report_reminders() from public, anon, authenticated;

select cron.schedule('rutf-weekly-report-reminders', '30 6 * * *', 'select public.otp_report_reminders()');
