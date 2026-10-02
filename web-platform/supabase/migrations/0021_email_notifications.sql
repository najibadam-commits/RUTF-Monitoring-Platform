-- Real email delivery for issue notifications (assignment / resolved / reopened), on top of the
-- existing in-app `notifications` rows (see #6 in DECISIONS.md).
--
-- All three notification types already funnel through create_notification() — assign_issue,
-- submit_dri_response, reject_and_reopen_issue (migrations 0007, 0016) — so extending that one
-- function covers every case without touching the RPCs that call it.
--
-- The actual send uses pg_net (async, non-blocking HTTP from Postgres) to call Resend's API. The
-- API key is never stored in a migration file — it lives in Supabase Vault, added separately via
-- tools/db/set-resend-key.js once available. Until a key is set, the email step is a silent no-op
-- (see the `if v_api_key is null then return` guard) — nothing breaks, in-app notifications keep
-- working exactly as before.
--
-- Email is strictly best-effort: any failure (missing key, Resend error, network issue) is caught
-- and swallowed so it can never block or fail the underlying workflow action (assigning an issue,
-- submitting a DRI response, etc.) that triggered the notification.
--
-- Sender is Resend's sandbox address (onboarding@resend.dev), which only delivers to the email
-- address the Resend account itself signed up with, until a real domain is verified — see chat.
-- Once a domain is verified, updating the `from` address below is a one-line follow-up migration.

create extension if not exists pg_net;

create or replace function create_notification(
  p_user_id uuid, p_type text, p_text text, p_link text, p_issue_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_api_key text;
  v_subject text;
begin
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
      return; -- no key configured yet — in-app notification above already succeeded
    end if;

    v_subject := case p_type
      when 'assignment' then 'New issue assigned to you'
      when 'resolved' then 'Your reported issue was resolved — awaiting your verification'
      when 'reopened' then 'An issue was reopened and needs your attention'
      else 'TPM Monitoring Platform notification'
    end;

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_api_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'from', 'TPM Monitoring Platform <onboarding@resend.dev>',
        'to', jsonb_build_array(v_email),
        'subject', v_subject,
        'html',
          '<p>' || p_text || '</p>' ||
          case when p_link is not null
            then '<p><a href="https://tpm-monitoring-platform.vercel.app' || p_link || '">View in the platform</a></p>'
            else ''
          end
      ),
      timeout_milliseconds := 8000
    );
  exception when others then
    -- Best-effort — never let an email problem fail the caller's transaction.
    null;
  end;
end;
$$;
