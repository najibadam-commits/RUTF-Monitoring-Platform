-- Structured Issue ID: LGA3-WARD3-CAT3-YY-INITIALS### (e.g. KMC-NAS-ROA-26-NI001).
--
-- Replaces how `issues.code` is *computed* (still the same column, same field everywhere in
-- the app — see DECISIONS.md #11). `code` was a generated stored column derived from a plain
-- bigserial ('ISS-' || (1000 + issue_number)); it becomes an ordinary text column populated by
-- a BEFORE INSERT trigger instead, because the new format needs table lookups (lga/ward/
-- category/profile) and a mutable, atomically-incremented counter — neither of which a
-- Postgres GENERATED ALWAYS AS expression can do (must be deterministic, same-row-only).
--
-- Existing rows are NOT touched: `ALTER COLUMN ... DROP EXPRESSION` preserves already-stored
-- values as plain data, so every pre-migration issue keeps its original ISS-NNNN code forever.
-- Only new inserts after this migration get the new format.

-- ─── 1. Reference-table abbreviation columns ────────────────────────────────────────────────

-- categories: only 10 rows, hand-curated directly (no algorithm needed).
alter table categories add column if not exists abbr text;

update categories set abbr = case name
  when 'Water & Sanitation Failure' then 'WSF'
  when 'Supply Chain / Stockout'    then 'SCS'
  when 'Infrastructure Damage'      then 'INF'
  when 'Safety Incident'            then 'SAF'
  when 'Service Quality Complaint'  then 'SVC'
  when 'Data Discrepancy'           then 'DAT'
  when 'Staff Absenteeism'          then 'STA'
  when 'Equipment Malfunction'      then 'EQP'
  when 'Environmental Hazard'       then 'ENV'
  when 'Community Grievance'        then 'COM'
  else abbr
end
where abbr is null;

alter table categories alter column abbr set not null;
alter table categories add constraint categories_abbr_format check (abbr ~ '^[A-Z]{3}$');
alter table categories add constraint categories_abbr_unique unique (abbr);

comment on column categories.abbr is
  'Curated 3-letter code used as the CAT3 segment of issues.code (structured Issue ID). '
  'Hand-set for every category — see migration 0026 and DECISIONS.md #11.';

-- lgas / wards: 774 + ~9,400 rows — too many to hand-curate, so backfilled by a deterministic
-- collision-safe algorithm below. Plain editable text columns afterward: correct any specific
-- one later with a normal UPDATE, no code change needed (only future issues pick it up).

create or replace function generate_abbr_candidates(p_name text)
returns text[]
language plpgsql
immutable
as $$
declare
  base text;
  candidates text[] := array[]::text[];
  i int;
  c1 int;
  c2 int;
begin
  base := upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z]', '', 'g'));
  if length(base) = 0 then
    base := 'XXX';
  elsif length(base) < 3 then
    base := rpad(base, 3, 'X');
  end if;

  -- 1) first three letters of the (letters-only) name
  candidates := candidates || left(base, 3);

  -- 2) first two letters + scan forward through the remaining letters
  if length(base) > 3 then
    for i in 3..length(base) loop
      candidates := candidates || (left(base, 2) || substr(base, i, 1));
    end loop;
  end if;

  -- 3) guaranteed-unique fallback: first letter + AA..ZZ (676 combinations)
  for c1 in 0..25 loop
    for c2 in 0..25 loop
      candidates := candidates || (left(base, 1) || chr(65 + c1) || chr(65 + c2));
    end loop;
  end loop;

  return candidates;
end;
$$;

comment on function generate_abbr_candidates(text) is
  'Ordered list of candidate 3-letter codes for a place/category name, most-natural first, '
  'ending in a guaranteed-unique first-letter+AA..ZZ fallback. Used to backfill and to derive '
  'codes for any lga/ward/category row added later. See DECISIONS.md #11.';

alter table lgas add column if not exists abbr text;
alter table wards add column if not exists abbr text;

-- One-time backfill: lgas (globally unique — LGA3 alone must disambiguate).
do $$
declare
  r record;
  cand text[];
  c text;
  chosen text;
begin
  for r in select id, name from lgas where abbr is null order by name, id loop
    cand := generate_abbr_candidates(r.name);
    chosen := null;
    foreach c in array cand loop
      if not exists (select 1 from lgas where abbr = c) then
        chosen := c;
        exit;
      end if;
    end loop;
    if chosen is null then
      raise exception 'Could not derive a unique abbr for lga % (%)', r.name, r.id;
    end if;
    update lgas set abbr = chosen where id = r.id;
  end loop;
end;
$$;

-- One-time backfill: wards (unique per LGA, not globally — the ID format's LGA3 segment
-- already disambiguates, so two different LGAs may reuse the same ward abbr).
do $$
declare
  r record;
  cand text[];
  c text;
  chosen text;
begin
  for r in select id, lga_id, name from wards where abbr is null order by lga_id, name, id loop
    cand := generate_abbr_candidates(r.name);
    chosen := null;
    foreach c in array cand loop
      if not exists (select 1 from wards where lga_id = r.lga_id and abbr = c) then
        chosen := c;
        exit;
      end if;
    end loop;
    if chosen is null then
      raise exception 'Could not derive a unique abbr for ward % in lga % (%)', r.name, r.lga_id, r.id;
    end if;
    update wards set abbr = chosen where id = r.id;
  end loop;
end;
$$;

alter table lgas alter column abbr set not null;
alter table lgas add constraint lgas_abbr_format check (abbr ~ '^[A-Z]{3}$');
alter table lgas add constraint lgas_abbr_unique unique (abbr);

alter table wards alter column abbr set not null;
alter table wards add constraint wards_abbr_format check (abbr ~ '^[A-Z]{3}$');
alter table wards add constraint wards_abbr_unique unique (lga_id, abbr);

comment on column lgas.abbr is
  'Algorithmically-derived 3-letter code (globally unique) used as the LGA3 segment of '
  'issues.code. Plain editable column — correct a specific one with UPDATE any time; only '
  'future issues for that LGA pick up the change. See migration 0026 and DECISIONS.md #11.';
comment on column wards.abbr is
  'Algorithmically-derived 3-letter code (unique within its LGA, not globally) used as the '
  'WARD3 segment of issues.code. Plain editable column, same correction story as lgas.abbr. '
  'See migration 0026 and DECISIONS.md #11.';

-- Keep abbr populated for any lga/ward row added after this migration (boundaries are
-- effectively static, but this closes the gap so abbr is never silently null going forward).

create or replace function lgas_derive_abbr_trigger()
returns trigger language plpgsql as $$
declare
  cand text[];
  c text;
begin
  if new.abbr is null then
    cand := generate_abbr_candidates(new.name);
    foreach c in array cand loop
      if not exists (select 1 from lgas where abbr = c) then
        new.abbr := c;
        exit;
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create trigger lgas_set_abbr
  before insert on lgas
  for each row execute function lgas_derive_abbr_trigger();

create or replace function wards_derive_abbr_trigger()
returns trigger language plpgsql as $$
declare
  cand text[];
  c text;
begin
  if new.abbr is null then
    cand := generate_abbr_candidates(new.name);
    foreach c in array cand loop
      if not exists (select 1 from wards where lga_id = new.lga_id and abbr = c) then
        new.abbr := c;
        exit;
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create trigger wards_set_abbr
  before insert on wards
  for each row execute function wards_derive_abbr_trigger();

-- ─── 2. profiles.initials ────────────────────────────────────────────────────────────────────

alter table profiles add column if not exists initials text;

create or replace function derive_initials(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  tokens text[];
  first_letter text;
  last_letter text;
begin
  tokens := regexp_split_to_array(trim(coalesce(p_name, '')), '\s+');
  if tokens is null or array_length(tokens, 1) is null or tokens[1] = '' then
    return 'XX';
  end if;
  first_letter := upper(substr(tokens[1], 1, 1));
  last_letter := upper(substr(tokens[array_length(tokens, 1)], 1, 1));
  if first_letter is null or first_letter = '' then
    first_letter := 'X';
  end if;
  if last_letter is null or last_letter = '' then
    last_letter := first_letter;
  end if;
  return first_letter || last_letter;
end;
$$;

comment on function derive_initials(text) is
  'First letter of the first name-token + first letter of the last name-token, e.g. '
  '"Najib Isah" -> NI. Single-word names double their first letter. Fallback XX if empty. '
  'Used for the INITIALS segment of issues.code. See DECISIONS.md #11.';

update profiles set initials = derive_initials(name) where initials is null;

alter table profiles alter column initials set not null;
alter table profiles add constraint profiles_initials_format check (initials ~ '^[A-Z]{2}$');

comment on column profiles.initials is
  'Auto-derived from name (see derive_initials()) when null; a manually-corrected value is '
  'never overwritten by a later name edit. Used as the INITIALS segment of issues.code.';

create or replace function profiles_derive_initials_trigger()
returns trigger language plpgsql as $$
begin
  if new.initials is null then
    new.initials := derive_initials(new.name);
  end if;
  return new;
end;
$$;

create trigger profiles_set_initials
  before insert or update of name on profiles
  for each row execute function profiles_derive_initials_trigger();

-- ─── 3. Atomic per-(prefix, year, initials) sequence counter ───────────────────────────────

create table issue_id_counters (
  prefix text not null,
  year smallint not null,
  initials text not null,
  last_number int not null default 0,
  primary key (prefix, year, initials)
);

alter table issue_id_counters enable row level security;
-- Deliberately no policies: only reachable through generate_issue_id() (security definer)
-- below, matching the existing current_user_role()/in_scope() pattern in 0007.

comment on table issue_id_counters is
  'Atomic sequence counter backing issues.code, scoped by (LGA+WARD+CAT prefix, year, '
  'reporter initials) exactly as specified — two different users who happen to share initials '
  'intentionally share a counter bucket (their sequence numbers interleave); a different '
  'prefix or different initials always gets its own 001. See migration 0026 and DECISIONS.md #11.';

-- ─── 4. generate_issue_id() + the issues.code triggers ─────────────────────────────────────

create or replace function generate_issue_id(
  p_lga_id uuid,
  p_ward_id uuid,
  p_category_id uuid,
  p_reported_by uuid,
  p_reported_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lga_abbr text;
  v_ward_abbr text;
  v_cat_abbr text;
  v_initials text;
  v_year text;
  v_prefix text;
  v_seq int;
begin
  select abbr into v_lga_abbr from lgas where id = p_lga_id;
  v_lga_abbr := coalesce(v_lga_abbr, 'GEN');

  if p_ward_id is not null then
    select abbr into v_ward_abbr from wards where id = p_ward_id;
  end if;
  v_ward_abbr := coalesce(v_ward_abbr, 'GEN');

  select abbr into v_cat_abbr from categories where id = p_category_id;
  v_cat_abbr := coalesce(v_cat_abbr, 'GEN');

  if p_reported_by is not null then
    select initials into v_initials from profiles where id = p_reported_by;
  end if;
  v_initials := coalesce(v_initials, 'XX');

  v_year := to_char(coalesce(p_reported_at, now()), 'YY');
  v_prefix := v_lga_abbr || '-' || v_ward_abbr || '-' || v_cat_abbr;

  insert into issue_id_counters (prefix, year, initials, last_number)
  values (v_prefix, v_year::smallint, v_initials, 1)
  on conflict (prefix, year, initials)
  do update set last_number = issue_id_counters.last_number + 1
  returning last_number into v_seq;

  return v_prefix || '-' || v_year || '-' || v_initials || lpad(v_seq::text, 3, '0');
end;
$$;

comment on function generate_issue_id(uuid, uuid, uuid, uuid, timestamptz) is
  'Formats a structured Issue ID (LGA3-WARD3-CAT3-YY-INITIALS###) and atomically claims the '
  'next sequence number via INSERT ... ON CONFLICT DO UPDATE (concurrency-safe, no lost '
  'updates under simultaneous inserts — never SELECT MAX()+1). GEN/XX fallbacks for a null '
  'ward/reporter. See migration 0026 and DECISIONS.md #11.';

create or replace function issues_set_code_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Unconditional: never trust a client-supplied code (see DECISIONS.md #11). No current
  -- caller (web report-issue action, Android sync, the demo seed script) ever sends `code` —
  -- this is a no-op for every real insert path today.
  new.code := generate_issue_id(new.lga_id, new.ward_id, new.category_id, new.reported_by, new.reported_at);
  return new;
end;
$$;

create trigger issues_set_code
  before insert on issues
  for each row execute function issues_set_code_trigger();

-- ─── 5. Immutability + uniqueness ───────────────────────────────────────────────────────────

alter table issues alter column code drop expression if exists;
alter table issues add constraint issues_code_unique unique (code);

create or replace function issues_protect_code_trigger()
returns trigger
language plpgsql
as $$
begin
  -- code is permanent once assigned at insert time — no update path may change it, regardless
  -- of role or what's submitted. See DECISIONS.md #11.
  new.code := old.code;
  return new;
end;
$$;

create trigger issues_protect_code
  before update on issues
  for each row execute function issues_protect_code_trigger();

comment on column issues.code is
  'Structured human-readable Issue ID: LGA3-WARD3-CAT3-YY-INITIALS### (e.g. KMC-NAS-ROA-26-'
  'NI001), generated server-side by the issues_set_code trigger at insert time and immutable '
  'thereafter (issues_protect_code trigger). Pre-migration rows keep their original ISS-NNNN '
  'value permanently -- only new inserts use the new format. Distinct from issues.mobile_code '
  '(Android offline placeholder, unrelated, unchanged). See migration 0026 and DECISIONS.md #11.';
