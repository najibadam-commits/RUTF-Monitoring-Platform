-- RUTF Monitoring Platform — migration 0140: correcting a child's or caregiver's details
-- (DECISIONS R176; DPIA §9 right to rectification and go-live checklist item 6)
-- The OTP Officer at the child's OTP site — the only person who can see the details — corrects
-- the child's name, sex, date of birth or age at registration, and the caregiver's name, address
-- and mobile number, with a reason. Removing the mobile number is how a caregiver stops being
-- contacted by phone (DPIA: object / restrict). The Child ID never changes.
-- The log is value-free, as the DPIA requires: which fields changed, why, who and when — never
-- the old or new names, addresses or numbers. (audit_log already records the fields changed on
-- otp_children and otp_child_identity with "values: not recorded", 0124.)

create table otp_child_corrections (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references otp_children(id) on delete cascade,
  fields text[] not null,
  reason text not null,
  source text not null check (source in ('caregiver_request', 'officer_error', 'other')),
  corrected_by uuid references profiles(id),
  corrected_at timestamptz not null default now()
);
create index otp_child_corrections_child_idx on otp_child_corrections(child_id, corrected_at);
alter table otp_child_corrections enable row level security;
revoke all on table otp_child_corrections from anon, authenticated;

-- p: {child_code, reason, source, and any of: child_name, caregiver_name, physical_address,
--     mobile_number, sex, date_of_birth, age_months_at_registration}. An empty string clears an
--     optional field (caregiver name, address, mobile, date of birth); a key left out is unchanged.
create or replace function otp_correct_child(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_child otp_children := otp_child_at_my_site(p ->> 'child_code');   -- the OTP Officer at the child's site only
  v_id otp_child_identity; v_new_c otp_children; v_new_i otp_child_identity;
  v_fields text[] := '{}'; v_mobile text; v_dob date; v_age int;
begin
  if coalesce(trim(p ->> 'reason'), '') = '' then raise exception 'Give the reason for the correction'; end if;
  if coalesce(p ->> 'source', '') not in ('caregiver_request', 'officer_error', 'other') then
    raise exception 'Say who asked for the correction: the caregiver, an officer''s error, or other';
  end if;
  select * into v_id from otp_child_identity where child_id = v_child.id;
  v_new_c := v_child; v_new_i := v_id;

  if p ? 'child_name' then
    if coalesce(trim(p ->> 'child_name'), '') = '' then raise exception 'The child''s name cannot be empty'; end if;
    v_new_i.child_name := trim(p ->> 'child_name');
  end if;
  if p ? 'caregiver_name' then v_new_i.caregiver_name := nullif(trim(p ->> 'caregiver_name'), ''); end if;
  if p ? 'physical_address' then v_new_i.physical_address := nullif(trim(p ->> 'physical_address'), ''); end if;
  if p ? 'mobile_number' then
    v_mobile := nullif(regexp_replace(coalesce(p ->> 'mobile_number', ''), '[\s-]', '', 'g'), '');
    if v_mobile is not null and v_mobile !~ '^\+?[0-9]{7,15}$' then raise exception 'The mobile number should be 7 to 15 digits'; end if;
    v_new_i.mobile_number := v_mobile;
  end if;
  if p ? 'sex' then
    if p ->> 'sex' not in ('M', 'F') then raise exception 'Sex is M or F'; end if;
    v_new_c.sex := p ->> 'sex';
  end if;
  if p ? 'date_of_birth' then
    v_dob := nullif(p ->> 'date_of_birth', '')::date;
    if v_dob is not null then
      if v_dob > v_child.registered_at::date then raise exception 'The date of birth is after the registration date'; end if;
      -- The age at registration follows a corrected date of birth.
      v_age := (extract(year from age(v_child.registered_at::date, v_dob)) * 12 + extract(month from age(v_child.registered_at::date, v_dob)))::int;
      if v_age > 120 then raise exception 'That date of birth makes the child % months old at registration', v_age; end if;
      v_new_c.age_months_at_registration := v_age;
    end if;
    v_new_c.date_of_birth := v_dob;
  end if;
  if p ? 'age_months_at_registration' and nullif(p ->> 'date_of_birth', '') is null then
    v_age := (p ->> 'age_months_at_registration')::int;
    if v_age is null or v_age < 0 or v_age > 120 then raise exception 'The age at registration is 0 to 120 months'; end if;
    v_new_c.age_months_at_registration := v_age;
  end if;

  -- Only the fields that really change (names, not values, are kept).
  if v_new_i.child_name is distinct from v_id.child_name then v_fields := v_fields || 'child name'::text; end if;
  if v_new_i.caregiver_name is distinct from v_id.caregiver_name then v_fields := v_fields || 'caregiver name'::text; end if;
  if v_new_i.physical_address is distinct from v_id.physical_address then v_fields := v_fields || 'address'::text; end if;
  if v_new_i.mobile_number is distinct from v_id.mobile_number then
    v_fields := v_fields || case when v_new_i.mobile_number is null then 'mobile number removed' else 'mobile number' end;
  end if;
  if v_new_c.sex is distinct from v_child.sex then v_fields := v_fields || 'sex'::text; end if;
  if v_new_c.date_of_birth is distinct from v_child.date_of_birth then v_fields := v_fields || 'date of birth'::text; end if;
  if v_new_c.age_months_at_registration is distinct from v_child.age_months_at_registration then v_fields := v_fields || 'age at registration'::text; end if;
  if cardinality(v_fields) = 0 then raise exception 'Nothing was changed'; end if;

  update otp_child_identity set child_name = v_new_i.child_name, caregiver_name = v_new_i.caregiver_name,
    physical_address = v_new_i.physical_address, mobile_number = v_new_i.mobile_number, updated_at = now()
  where child_id = v_child.id;
  update otp_children set sex = v_new_c.sex, date_of_birth = v_new_c.date_of_birth, age_months_at_registration = v_new_c.age_months_at_registration
  where id = v_child.id;
  insert into otp_child_corrections (child_id, fields, reason, source, corrected_by)
  values (v_child.id, v_fields, trim(p ->> 'reason'), p ->> 'source', auth.uid());

  return jsonb_build_object('child_code', v_child.child_code, 'fields_changed', to_jsonb(v_fields),
    'note', case when 'sex' = any(v_fields) or 'age at registration' = any(v_fields)
                 then 'Sex and age are counted in the reports: weekly reports already submitted keep their figures until amended.' end,
    'corrections', otp_child_corrections_list(v_child.child_code));
end;
$$;

-- The correction history on the card (OTP Officer at the child's site): fields, reason, who, when.
create or replace function otp_child_corrections_list(p_child_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_child otp_children := otp_child_at_my_site(p_child_code);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('fields', to_jsonb(c.fields), 'reason', c.reason, 'source', c.source,
            'by', (select name from profiles where id = c.corrected_by), 'at', c.corrected_at) order by c.corrected_at desc), '[]'::jsonb)
          from otp_child_corrections c where c.child_id = v_child.id);
end;
$$;

revoke execute on function otp_correct_child(jsonb), otp_child_corrections_list(text) from public, anon;
grant execute on function otp_correct_child(jsonb), otp_child_corrections_list(text) to authenticated;
