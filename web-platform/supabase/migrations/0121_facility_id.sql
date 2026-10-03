-- RUTF Monitoring Platform — migration 0121
-- Facility ID in the same administrative order as Finding, transfer and visit IDs (DECISIONS R78),
-- without a year (facilities aren't yearly):
--   STATE-LGA-WARD-LEVEL-NNN, e.g. KT-DAU-MAJ-OTP-001
--   level: SST (State store), LST (LGA store), OTP (OTP site), HF (other health facility).
-- Numbered within each state-LGA-ward-level; permanent once given (a later ward correction or OTP
-- flag change doesn't re-code it). The registry's national_code (globalid; later the NHFR code)
-- stays alongside for registry and DHIS2 matching.
-- All existing facilities are coded by name within their group; the other facility triggers
-- (location, workflow, audit) are paused for that one-time fill only.

alter table facilities add column if not exists facility_code text unique;

create table if not exists facility_id_counters (
  prefix text primary key,
  last_number int not null
);
alter table facility_id_counters enable row level security;  -- no policies: only the trigger uses it

create or replace function facility_code_prefix_of(p_type facility_type, p_is_otp boolean, p_lga_id uuid, p_ward_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select s.code from lgas l join states s on s.id = l.state_id where l.id = p_lga_id), 'GEN') || '-' ||
         coalesce((select abbr from lgas where id = p_lga_id), 'GEN') || '-' ||
         coalesce((select abbr from wards where id = p_ward_id), 'GEN') || '-' ||
         case p_type when 'state_store' then 'SST' when 'lga_store' then 'LST'
                     else case when p_is_otp then 'OTP' else 'HF' end end;
$$;

create or replace function facilities_set_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_prefix text;
  v_seq int;
begin
  if tg_op = 'UPDATE' then
    new.facility_code := coalesce(old.facility_code, new.facility_code);  -- permanent
    if new.facility_code is not null then return new; end if;
  elsif new.facility_code is not null then
    return new;
  end if;
  v_prefix := facility_code_prefix_of(new.facility_type, new.is_otp_site, new.lga_id, new.ward_id);
  insert into facility_id_counters (prefix, last_number) values (v_prefix, 1)
  on conflict (prefix) do update set last_number = facility_id_counters.last_number + 1
  returning last_number into v_seq;
  new.facility_code := v_prefix || '-' || lpad(v_seq::text, 3, '0');
  return new;
end;
$$;
revoke execute on function facility_code_prefix_of(facility_type, boolean, uuid, uuid) from public, anon, authenticated;
revoke execute on function facilities_set_code() from public, anon, authenticated;

-- Fires after facilities_derive_location (alphabetical order of BEFORE triggers), so a ward filled
-- in from coordinates is in the code.
drop trigger if exists facilities_set_code on facilities;
create trigger facilities_set_code before insert or update on facilities
  for each row execute function facilities_set_code();

-- ── Code every existing facility ───────────────────────────────────────────────────────────────
alter table facilities disable trigger facilities_set_code;
alter table facilities disable trigger facilities_derive_location;
alter table facilities disable trigger facilities_enforce_workflow;
alter table facilities disable trigger facilities_audit;
alter table facilities disable trigger facilities_set_updated_at;

with numbered as (
  select f.id, p.prefix,
         row_number() over (partition by p.prefix order by f.name, f.id) as seq
  from facilities f
  cross join lateral (select facility_code_prefix_of(f.facility_type, f.is_otp_site, f.lga_id, f.ward_id) as prefix) p
  where f.facility_code is null
)
update facilities f set facility_code = n.prefix || '-' || lpad(n.seq::text, 3, '0')
from numbered n where n.id = f.id;

alter table facilities enable trigger facilities_set_code;
alter table facilities enable trigger facilities_derive_location;
alter table facilities enable trigger facilities_enforce_workflow;
alter table facilities enable trigger facilities_audit;
alter table facilities enable trigger facilities_set_updated_at;

insert into facility_id_counters (prefix, last_number)
select regexp_replace(facility_code, '-\d{3,}$', ''), max(substring(facility_code from '-(\d{3,})$')::int)
from facilities where facility_code is not null
group by 1
on conflict (prefix) do update set last_number = greatest(facility_id_counters.last_number, excluded.last_number);
