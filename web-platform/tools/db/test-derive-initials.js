// Proves migration 0042's derive_initials() (a) handles names the old one broke on and (b) returns
// EXACTLY what the old one did for every name that already worked — including every real profile
// name in the database (only match COUNTS are printed for those, never the names).
// Everything runs inside one rolled-back transaction; nothing is changed.
//
// Usage: node test-derive-initials.js [../../supabase/migrations/0042_robust_derive_initials.sql]
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const migration = path.resolve(process.argv[2] ?? path.join(__dirname, "../../supabase/migrations/0042_robust_derive_initials.sql"));

const OLD_FN = `
create function derive_initials_v1(p_name text) returns text language plpgsql immutable as $$
declare tokens text[]; first_letter text; last_letter text;
begin
  tokens := regexp_split_to_array(trim(coalesce(p_name, '')), '\\s+');
  if tokens is null or array_length(tokens, 1) is null or tokens[1] = '' then return 'XX'; end if;
  first_letter := upper(substr(tokens[1], 1, 1));
  last_letter := upper(substr(tokens[array_length(tokens, 1)], 1, 1));
  if first_letter is null or first_letter = '' then first_letter := 'X'; end if;
  if last_letter is null or last_letter = '' then last_letter := first_letter; end if;
  return first_letter || last_letter;
end; $$;`;

// [name, expected new result]. Names the OLD function also handled must give the same answer.
const CASES = [
  ["Najib Isah", "NI"], ["Fatima Yusuf", "FY"], ["Madonna", "MM"], ["  Ada   Obi  ", "AO"],
  ["Dr. Ada Obi", "DO"], ["Amina Bello-Musa", "AB"], ["mary jane watson", "MW"], ["Ibrahim Suleiman", "IS"],
  // previously broke the Add User form:
  ["Demo DRI (Health)", "DH"], ["John (Lagos)", "JL"], ["Ọlá Ṣola", "OS"], ["Ìbrahim Ẹzekiel", "IE"],
  ["Chidi - ", "CC"], ["Amina 2", "AA"], ["José Ñandú", "JN"],
  // nothing usable:
  ["", "XX"], ["   ", "XX"], ["12345", "XX"], ["(...)", "XX"],
];

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  let failures = 0;
  const fail = (m) => { failures++; console.log("FAIL", m); };
  try {
    await pg.query("begin");
    await pg.query(OLD_FN);
    await pg.query(fs.readFileSync(migration, "utf8"));

    const rows = [];
    for (const [name, want] of CASES) {
      const r = (await pg.query("select derive_initials($1) n, derive_initials_v1($1) o", [name])).rows[0];
      const validNew = /^[A-Z]{2}$/.test(r.n);
      const oldWorked = /^[A-Z]{2}$/.test(r.o);
      if (r.n !== want) fail(`"${name}": expected ${want}, got ${r.n}`);
      if (!validNew) fail(`"${name}": result ${r.n} violates profiles_initials_format`);
      if (oldWorked && r.n !== r.o) fail(`"${name}": old gave ${r.o} (valid) but new gives ${r.n}`);
      rows.push({ name, old: r.o, new: r.n, "old valid": oldWorked ? "yes" : "NO (broke)", ok: r.n === want ? "ok" : "FAIL" });
    }
    console.table(rows);

    // Parity over every real profile name: wherever the old result was valid, the new one must match.
    const real = (await pg.query("select name from profiles")).rows.map((r) => r.name);
    let same = 0, oldBroken = 0, newInvalid = 0, diff = 0;
    for (const name of real) {
      const r = (await pg.query("select derive_initials($1) n, derive_initials_v1($1) o", [name])).rows[0];
      if (!/^[A-Z]{2}$/.test(r.n)) newInvalid++;
      if (!/^[A-Z]{2}$/.test(r.o)) oldBroken++;
      else if (r.n === r.o) same++;
      else diff++;
    }
    console.log(`Real profiles checked: ${real.length} — identical: ${same}, differ: ${diff}, old result invalid: ${oldBroken}, new result invalid: ${newInvalid}`);
    if (diff || newInvalid) fail("new derive_initials disagrees with the old one on a real profile, or produced an invalid value");

    // Fuzz: random ASCII-letter names (the population the old function handled) must agree exactly.
    let fuzzBad = 0;
    for (let i = 0; i < 300; i++) {
      const words = 1 + (i % 4);
      const name = Array.from({ length: words }, (_, w) => {
        const len = 2 + ((i * 7 + w * 3) % 8);
        let s = ""; for (let k = 0; k < len; k++) s += String.fromCharCode(97 + ((i * 31 + w * 17 + k * 13) % 26));
        return (i + w) % 2 ? s[0].toUpperCase() + s.slice(1) : s;
      }).join(" ");
      const r = (await pg.query("select derive_initials($1) n, derive_initials_v1($1) o", [name])).rows[0];
      if (r.n !== r.o) { fuzzBad++; console.log("fuzz mismatch", name, r); }
    }
    console.log(`Fuzz (300 random plain names): ${fuzzBad === 0 ? "all identical to the old function" : fuzzBad + " mismatches"}`);
    if (fuzzBad) fail("fuzz mismatches");
  } finally {
    await pg.query("rollback").catch(() => {});
    await pg.end();
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll checks passed. (Rolled back — nothing changed.)");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
