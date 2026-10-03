"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import type { Database } from "@/lib/types/database";

// DHIS2 extract upload (brief §12.8): the same CSV format as tools/db/import-dhis2.js —
// facility_id, period (YYYYMM), otp_admissions, rutf_sachets_received, rutf_sachets_distributed,
// rutf_sachets_wasted, rutf_stockout_days. One row per facility and month, replaced on re-upload.

type Dhis2Insert = Database["public"]["Tables"]["dhis2_reports"]["Insert"];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    cell = "";
    if (row.some((v) => v.trim() !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else cell += c;
  }
  endRow();
  return rows;
}

export async function uploadDhis2Action(form: FormData): Promise<{ error?: string; loaded?: number }> {
  const profile = await getCurrentProfile();
  if (!["super_admin", "project_admin"].includes(profile.role)) return { error: "Only administrators can upload DHIS2 data." };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > 10 * 1024 * 1024) return { error: "The file is larger than 10 MB." };

  const [header, ...lines] = parseCsv((await file.text()).replace(/^﻿/, ""));
  const col: Record<string, number> = Object.fromEntries((header ?? []).map((h, i) => [h.trim().toLowerCase(), i]));
  const need = ["facility_id", "period", "rutf_sachets_received", "rutf_sachets_distributed", "rutf_sachets_wasted", "rutf_stockout_days"];
  const missing = need.filter((k) => col[k] === undefined);
  if (missing.length) return { error: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` };

  const supabase = await createClient();
  const { data: facilities } = await supabase.from("facilities").select("id, project_id");
  const project = new Map((facilities ?? []).map((f) => [f.id, f.project_id]));
  const num = (v: string | undefined) => {
    const s = (v ?? "").trim();
    if (s === "") return null;
    const n = Number(s);
    return Number.isInteger(n) && n >= 0 ? n : NaN;
  };

  const rows: Dhis2Insert[] = [];
  const now = new Date().toISOString();
  for (const [i, r] of lines.entries()) {
    const line = i + 2;
    const id = r[col.facility_id]?.trim() ?? "";
    if (!project.has(id)) return { error: `Line ${line}: unknown facility ${id || "(blank)"}.` };
    const p = r[col.period]?.trim() ?? "";
    if (!/^\d{4}(0[1-9]|1[0-2])$/.test(p)) return { error: `Line ${line}: period must be YYYYMM, got "${p}".` };
    const vals = {
      otp_admissions: col.otp_admissions === undefined ? null : num(r[col.otp_admissions]),
      sachets_received: num(r[col.rutf_sachets_received]),
      sachets_distributed: num(r[col.rutf_sachets_distributed]),
      sachets_wasted: num(r[col.rutf_sachets_wasted]),
      stockout_days: num(r[col.rutf_stockout_days]),
    };
    if (Object.values(vals).some((v) => Number.isNaN(v))) return { error: `Line ${line}: figures must be whole numbers of zero or more.` };
    rows.push({ project_id: project.get(id) ?? null, facility_id: id, period: `${p.slice(0, 4)}-${p.slice(4, 6)}-01`, ...vals, imported_at: now });
  }
  if (rows.length === 0) return { error: "The file has no rows." };

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("dhis2_reports").upsert(rows.slice(i, i + 500), { onConflict: "facility_id,period" });
    if (error) return { error: `Upload stopped after ${i} rows: ${error.message}` };
  }
  revalidatePath("/dhis2-triangulation");
  return { loaded: rows.length };
}
