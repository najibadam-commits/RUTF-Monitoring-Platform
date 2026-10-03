-- RUTF Monitoring Platform — migration 0118
-- Finding ID in administrative order (DECISIONS R75):
--   STATE-LGA-WARD-LEVEL-YYNNN, e.g. KT-DAU-MAJ-OTP-26001
--   state code (states.code), LGA and ward abbreviations (lgas.abbr / wards.abbr), facility level
--   (categories.abbr: SST / LST / OTP), two-digit year and a sequence per state-LGA-ward-level and
--   year (3 digits, growing past 999 if ever needed). Replaces LGA-WARD-LEVEL-YY-INITIALS###; the
--   reporter's initials are dropped (automatic checks have none). Unknown parts read GEN.
-- The DUMMY Findings are re-numbered in the new format, in the order they were raised. Codes stay
-- permanent afterwards (issues_protect_code is re-enabled at the end).

create or replace function generate_issue_id(p_lga_id uuid, p_ward_id uuid, p_category_id uuid, p_reported_by uuid, p_reported_at timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_state text;
  v_lga text;
  v_ward text;
  v_level text;
  v_year text;
  v_prefix text;
  v_seq int;
begin
  select s.code, l.abbr into v_state, v_lga from lgas l left join states s on s.id = l.state_id where l.id = p_lga_id;
  if p_ward_id is not null then
    select abbr into v_ward from wards where id = p_ward_id;
  end if;
  select abbr into v_level from categories where id = p_category_id;

  v_prefix := coalesce(v_state, 'GEN') || '-' || coalesce(v_lga, 'GEN') || '-' || coalesce(v_ward, 'GEN') || '-' || coalesce(v_level, 'GEN');
  v_year := to_char(coalesce(p_reported_at, now()), 'YY');

  -- issue_id_counters keyed by (prefix, year, initials); the new scheme has no initials.
  insert into issue_id_counters (prefix, year, initials, last_number)
  values (v_prefix, v_year::smallint, '', 1)
  on conflict (prefix, year, initials)
  do update set last_number = issue_id_counters.last_number + 1
  returning last_number into v_seq;

  return v_prefix || '-' || v_year || lpad(v_seq::text, 3, '0');
end;
$$;
revoke execute on function generate_issue_id(uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;

-- ── Re-number the DUMMY Findings ────────────────────────────────────────────────────────────────
alter table issues disable trigger issues_protect_code;

with numbered as (
  select i.id,
         coalesce(s.code, 'GEN') || '-' || coalesce(l.abbr, 'GEN') || '-' || coalesce(w.abbr, 'GEN') || '-' || coalesce(c.abbr, 'GEN') as prefix,
         to_char(i.reported_at, 'YY') as yy,
         row_number() over (
           partition by coalesce(s.code, 'GEN'), coalesce(l.abbr, 'GEN'), coalesce(w.abbr, 'GEN'), coalesce(c.abbr, 'GEN'), to_char(i.reported_at, 'YY')
           order by i.reported_at, i.id) as seq
  from issues i
  join facilities f on f.id = i.facility_id and f.dummy_fields is not null
  left join lgas l on l.id = i.lga_id
  left join states s on s.id = l.state_id
  left join wards w on w.id = i.ward_id
  left join categories c on c.id = i.category_id
)
update issues i set code = n.prefix || '-' || n.yy || lpad(n.seq::text, 3, '0')
from numbered n where n.id = i.id;

alter table issues enable trigger issues_protect_code;

-- Carry the counters on from the re-numbered Findings so new ones continue the sequence.
insert into issue_id_counters (prefix, year, initials, last_number)
select regexp_replace(code, '-\d{2}\d{3,}$', ''), substring(code from '-(\d{2})\d{3,}$')::smallint, '',
       max(substring(code from '-\d{2}(\d{3,})$')::int)
from issues
where code ~ '^[A-Z]{2,3}-[A-Z]{3}-[A-Z]{3}-[A-Z]{3}-\d{5,}$'
group by 1, 2
on conflict (prefix, year, initials) do update set last_number = greatest(issue_id_counters.last_number, excluded.last_number);
