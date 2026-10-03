-- RUTF Monitoring Platform — migration 0110
-- Notification emails no longer link to the TPM deployment (tpm-monitoring-platform.vercel.app).
-- The email carries the notification text and asks the reader to sign in; the in-app notification
-- keeps its link (notifications.link), which resolves on whichever deployment the user signs in to.
-- Same function as 0108 otherwise: callable only from the review RPCs, text HTML-escaped.

create or replace function create_notification(p_user_id uuid, p_type text, p_text text, p_link text, p_issue_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_api_key text;
  v_subject text;
  v_ctx text;
begin
  if coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon') then
    get diagnostics v_ctx = pg_context;
    if v_ctx !~ '(approve_and_assign_finding|assign_issue|create_download_request|decide_download_request|record_corrective_action|reject_and_reopen_issue|return_finding_for_correction)\(' then
      raise exception 'create_notification can only be called by the platform';
    end if;
  end if;

  insert into notifications (user_id, type, text, link, issue_id)
  values (p_user_id, p_type, p_text, p_link, p_issue_id);

  begin
    select u.email into v_email from auth.users u where u.id = p_user_id;
    if v_email is null then
      return;
    end if;

    select decrypted_secret into v_api_key
      from vault.decrypted_secrets where name = 'resend_api_key';
    if v_api_key is null then
      return;
    end if;

    v_subject := case p_type
      when 'assignment' then 'New finding assigned to you'
      when 'resolved' then 'Your reported finding was resolved — awaiting your verification'
      when 'reopened' then 'A finding was reopened and needs your attention'
      when 'returned' then 'A finding you submitted was returned for correction'
      else 'RUTF-DTAP Monitoring Platform notification'
    end;

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_api_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'from', 'RUTF-DTAP Monitoring Platform <onboarding@resend.dev>',
        'to', jsonb_build_array(v_email),
        'subject', v_subject,
        'html',
          '<p>' || replace(replace(replace(p_text, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>' ||
          '<p>Sign in to the RUTF-DTAP Monitoring Platform to view it.</p>'
      ),
      timeout_milliseconds := 8000
    );
  exception when others then
    null;
  end;
end;
$$;
