// Loads the dummy ledger (DECISIONS R2) into the 0101 tables:
//   data/dummy/transfers.csv            -> transfers
//   data/dummy/stock_transactions.csv   -> stock_transactions
//   data/dummy/otp_daily_dispensing.csv -> otp_daily_dispensing
// Needs the facilities/lots (import-reference.js) and the demo accounts (seed-demo-accounts.js):
// recorded_by is the demo profile with the row's recorded_by_email.
//
// Rows keep the CSV's ids and insert with ON CONFLICT (id) DO NOTHING, so a re-run adds only
// what is missing. Direct connection: the tables have no write policies, by design.
//
// Usage: node import-ledger.js
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const DATA_DIR = path.join(__dirname, "..", "..", "..", "data", "dummy");
const BATCH = 500;
const read = (f) => parse(fs.readFileSync(path.join(DATA_DIR, f)), { columns: true, skip_empty_lines: true });
const blank = (s) => ((s ?? "").trim() === "" ? null : s.trim());

async function insertBatch(client, table, cols, rows) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const params = [];
    const tuples = rows.slice(i, i + BATCH).map((row) =>
      `(${cols.map((c) => { params.push(row[c]); return `$${params.length}`; }).join(",")})`);
    const res = await client.query(`insert into ${table} (${cols.join(",")}) values ${tuples.join(",")} on conflict (id) do nothing`, params);
    inserted += res.rowCount;
    process.stdout.write(`\r  ${table}: ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log("");
  return inserted;
}

(async () => {
  const transfers = read("transfers.csv");
  const txns = read("stock_transactions.csv");
  const dispensing = read("otp_daily_dispensing.csv");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");
    const profileByEmail = new Map((await client.query("select id, email from profiles")).rows.map((r) => [r.email.toLowerCase(), r.id]));
    const projectByFacility = new Map((await client.query("select id, project_id from facilities")).rows.map((r) => [r.id, r.project_id]));

    const missingEmails = new Set();
    const by = (email) => {
      const id = profileByEmail.get((email ?? "").toLowerCase());
      if (!id) missingEmails.add(email);
      return id;
    };
    const missingFacilities = [...new Set([...txns.map((t) => t.facility_id), ...transfers.flatMap((t) => [t.from_facility_id, t.to_facility_id])])]
      .filter((id) => !projectByFacility.has(id));
    if (missingFacilities.length) throw new Error(`${missingFacilities.length} facilities not found — run import-reference.js first`);

    const nT = await insertBatch(client, "transfers",
      ["id", "project_id", "code", "from_facility_id", "to_facility_id", "issued_date", "received_date", "sachets_issued", "sachets_received", "status"],
      transfers.map((t) => ({
        id: t.id, project_id: projectByFacility.get(t.from_facility_id), code: t.code, from_facility_id: t.from_facility_id,
        to_facility_id: t.to_facility_id, issued_date: t.issued_date, received_date: blank(t.received_date),
        sachets_issued: Number(t.sachets_issued), sachets_received: blank(t.sachets_received) === null ? null : Number(t.sachets_received), status: t.status,
      })));

    const txnRows = txns.map((t) => ({
      id: t.id, project_id: projectByFacility.get(t.facility_id), facility_id: t.facility_id, txn_type: t.txn_type, txn_date: t.txn_date,
      lot_id: blank(t.lot_id), quantity_sachets: Number(t.quantity_sachets), counterparty_facility_id: blank(t.counterparty_facility_id),
      transfer_id: blank(t.transfer_id), document_no: blank(t.document_no), reason: blank(t.reason), recorded_by: by(t.recorded_by_email),
      device_id: blank(t.device_id), local_id: blank(t.local_id), status: t.status || "recorded",
    }));
    const dispRows = dispensing.map((d) => ({
      id: d.id, project_id: projectByFacility.get(d.facility_id), facility_id: d.facility_id, dispense_date: d.dispense_date,
      new_admissions: Number(d.new_admissions), children_seen: Number(d.children_seen), sachets_prescribed: Number(d.sachets_prescribed),
      sachets_dispensed: Number(d.sachets_dispensed), recorded_by: by(d.recorded_by_email), local_id: blank(d.local_id),
    }));
    if (missingEmails.size) throw new Error(`No profile for ${missingEmails.size} recorder email(s), e.g. ${[...missingEmails].slice(0, 3).join(", ")} — run seed-demo-accounts.js first`);

    const nX = await insertBatch(client, "stock_transactions", Object.keys(txnRows[0]), txnRows);
    const nD = await insertBatch(client, "otp_daily_dispensing", Object.keys(dispRows[0]), dispRows);
    await client.query("commit");

    console.log(`\nInserted ${nT} transfers, ${nX} ledger rows, ${nD} dispensing days.`);
    const summary = await client.query(`
      select f.facility_type, count(distinct b.facility_id)::int facilities, sum(b.balance)::int sachets_on_hand,
             count(*) filter (where b.balance < 0)::int negative_lot_balances
        from stock_balances b join facilities f on f.id = b.facility_id group by 1 order by 1`);
    console.table(summary.rows);
    const tr = await client.query(`select status, count(*)::int from transfers group by 1 order by 1`);
    console.table(tr.rows);
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.error("\n❌ Import failed, rolled back:", e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
