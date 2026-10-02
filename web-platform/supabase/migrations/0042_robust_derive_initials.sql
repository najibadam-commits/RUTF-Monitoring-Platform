-- derive_initials() (0026) took the first character of the first and last whitespace-separated
-- words verbatim, but profiles.initials has CHECK (initials ~ '^[A-Z]{2}$'). Any name whose first
-- or last word does not start with a plain A-Z letter therefore made the profile insert fail,
-- which surfaced in the Add User form only as "Database error creating new user":
--   "Demo DRI (Health)"  -> last word "(Health)" starts with "("   -> "D("
--   "Ọlá Ṣola"           -> accented/dotted first letters           -> "Ọṣ"
--   "John (Lagos)", "Amina 2", a trailing "-" ... same failure.
-- Yoruba/Igbo diacritics are common in this program's staff names, so this was a real trap, not a
-- corner case.
--
-- New rule, identical for every name that already worked: decompose accents (NFD), keep only the
-- A-Z letters of each word, drop words left with no letters (brackets, digits, dashes), then take
-- the first letter of the first remaining word and of the last (a single word doubles its first
-- letter, as before). Nothing left at all (empty / no Latin letters) still falls back to 'XX'.
-- Existing profiles keep their stored initials — this only affects newly derived ones.

create or replace function derive_initials(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  words text[];
begin
  select array_agg(w) into words
  from (
    select upper(regexp_replace(normalize(t, NFD), '[^A-Za-z]', '', 'g')) as w
    from regexp_split_to_table(trim(coalesce(p_name, '')), '\s+') as t
  ) s
  where w <> '';

  if words is null then
    return 'XX';
  end if;

  return substr(words[1], 1, 1) || substr(words[array_length(words, 1)], 1, 1);
end;
$$;

comment on function derive_initials(text) is
  'First A-Z letter of the first + last name-word, accents stripped, words with no letters ignored '
  '(e.g. "Najib Isah" -> NI, "Ọlá Ṣola" -> OS, "John (Lagos)" -> JL). Single-word names double '
  'their first letter; fallback XX. Always matches profiles_initials_format. See DECISIONS.md #34.';
