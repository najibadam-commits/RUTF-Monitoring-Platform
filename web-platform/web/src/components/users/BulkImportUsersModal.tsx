"use client";

import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { ROLE_LABELS, assignableRolesFor } from "@/lib/rbac";
import type { Database, UserRole } from "@/lib/types/database";
import { bulkAddUsersAction } from "@/lib/actions/users";
import type { FacilityOption } from "./FacilityPicker";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const MAX_ROWS = 25;

type TargetField = "name" | "email" | "phone" | "role" | "facility";
const TARGET_FIELDS: { key: TargetField; label: string; required: boolean }[] = [
  { key: "name", label: "Full Name", required: true },
  { key: "email", label: "Email", required: true },
  { key: "phone", label: "Phone Number", required: false },
  { key: "role", label: "Role", required: true },
  // Required per row only for facility users (dri) — name or national code of a store / OTP site.
  { key: "facility", label: "Facility (facility users)", required: false },
];

const GUESS_KEYWORDS: Record<TargetField, string[]> = {
  name: ["name"],
  email: ["email", "e-mail", "mail"],
  phone: ["phone", "mobile", "tel"],
  role: ["role"],
  facility: ["facility", "store", "otp"],
};

function guessMapping(headers: string[]): Record<TargetField, string | null> {
  const used = new Set<string>();
  const mapping = {} as Record<TargetField, string | null>;
  for (const field of TARGET_FIELDS) {
    const keywords = GUESS_KEYWORDS[field.key];
    const match = headers.find((h) => !used.has(h) && keywords.some((k) => h.toLowerCase().includes(k)));
    mapping[field.key] = match ?? null;
    if (match) used.add(match);
  }
  return mapping;
}

function resolveRole(raw: string): UserRole | null {
  const norm = raw.trim().toLowerCase();
  if (!norm) return null;
  const byKey = (Object.keys(ROLE_LABELS) as UserRole[]).find((k) => k.toLowerCase() === norm);
  if (byKey) return byKey;
  const byLabel = (Object.entries(ROLE_LABELS) as [UserRole, string][]).find(([, label]) => label.toLowerCase() === norm);
  return byLabel ? byLabel[0] : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PreviewRow {
  line: number;
  name: string;
  email: string;
  phone: string;
  roleRaw: string;
  role: UserRole | null;
  facilityRaw: string;
  facilityId: string | null;
  error: string | null;
}

export function BulkImportUsersModal({
  users,
  callerRole,
  facilities,
  onClose,
}: {
  users: Profile[];
  callerRole: UserRole;
  facilities: FacilityOption[];
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [rawRows, setRawRows] = useState<Record<string, string>[] | null>(null);
  const [mapping, setMapping] = useState<Record<TargetField, string | null>>({ name: null, email: null, phone: null, role: null, facility: null });
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [results, setResults] = useState<{ email: string; success: boolean; error?: string }[] | null>(null);

  const existingEmails = useMemo(() => new Set(users.map((u) => u.email.trim().toLowerCase())), [users]);
  const assignable = assignableRolesFor(callerRole);
  // Facility by exact name or national code, case-insensitive.
  const facilityIndex = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of facilities) {
      m.set(f.name.trim().toLowerCase(), f.id);
      if (f.national_code) m.set(f.national_code.trim().toLowerCase(), f.id);
    }
    return m;
  }, [facilities]);

  const preview = useMemo<PreviewRow[] | null>(() => {
    if (!rawRows) return null;
    const seenInFile = new Set<string>();
    return rawRows.map((raw, idx) => {
      const line = idx + 2;
      const name = (mapping.name ? raw[mapping.name] : "")?.trim() ?? "";
      const email = (mapping.email ? raw[mapping.email] : "")?.trim() ?? "";
      const phone = (mapping.phone ? raw[mapping.phone] : "")?.trim() ?? "";
      const roleRaw = (mapping.role ? raw[mapping.role] : "")?.trim() ?? "";
      const role = resolveRole(roleRaw);
      const facilityRaw = (mapping.facility ? raw[mapping.facility] : "")?.trim() ?? "";
      const facilityId = facilityRaw ? (facilityIndex.get(facilityRaw.toLowerCase()) ?? null) : null;
      const emailLower = email.toLowerCase();

      let error: string | null = null;
      if (!name) error = "Missing name";
      else if (!email) error = "Missing email";
      else if (!EMAIL_RE.test(email)) error = "Invalid email format";
      else if (existingEmails.has(emailLower)) error = "Email already exists";
      else if (seenInFile.has(emailLower)) error = "Duplicate email in file";
      else if (!roleRaw) error = "Missing role";
      else if (!role) error = `Unrecognized role "${roleRaw}"`;
      else if (!assignable.includes(role)) error = `You cannot assign the ${ROLE_LABELS[role]} role`;
      else if (role === "dri" && !facilityRaw) error = "Facility users need a facility";
      else if (role === "dri" && !facilityId) error = `Unknown facility "${facilityRaw}" (use a store or OTP site name, or its national code)`;

      if (!error) seenInFile.add(emailLower);
      return { line, name, email, phone, roleRaw, role, facilityRaw, facilityId, error };
    });
  }, [rawRows, mapping, existingEmails, assignable, facilityIndex]);

  const validRows = preview?.filter((r) => !r.error && r.role) ?? [];
  const invalidRows = preview?.filter((r) => r.error) ?? [];

  function downloadTemplate() {
    const csv = "name,email,phone,role,facility\nJane Doe,jane@example.org,+234 800 000 0000,DRI,Bakori LGA Nutrition Store (DUMMY)\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk-import-users-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFile(file: File) {
    setFileName(file.name);
    setParseError(null);
    setResults(null);
    setSubmitError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (parsed) => {
        const detectedHeaders = parsed.meta.fields ?? [];
        setHeaders(detectedHeaders);
        setRawRows(parsed.data);
        setMapping(guessMapping(detectedHeaders));
      },
      error: (err) => setParseError(`Couldn't parse the file: ${err.message}`),
    });
  }

  async function submit() {
    if (validRows.length === 0) return;
    if (validRows.length > MAX_ROWS) {
      setSubmitError(`Up to ${MAX_ROWS} rows at a time — this file has ${validRows.length} valid rows. Split it into smaller batches.`);
      return;
    }
    setUploading(true);
    setSubmitError(null);
    const res = await bulkAddUsersAction(
      validRows.map((r) => ({ name: r.name, email: r.email, phone: r.phone, role: r.role!, facilityId: r.role === "dri" ? r.facilityId : null })),
    );
    setUploading(false);
    if (res.error) setSubmitError(res.error);
    if (res.results) setResults(res.results);
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" style={{ width: "min(760px, 100%)" }}>
        <div className="dialog-title">Bulk Import Users</div>
        <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ marginTop: 0, fontSize: 13 }}>
            Upload any CSV, then map its columns to the fields below — column names don&apos;t need to match.
            Up to {MAX_ROWS} rows per import (keeps Supabase&apos;s email rate limit in check).
          </p>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" onClick={downloadTemplate}>
              <i className="ph ph-download-simple" /> Download Template
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
              <i className="ph ph-upload-simple" /> Choose CSV File
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            {fileName && <span className="text-muted" style={{ fontSize: 12.5 }}>{fileName}</span>}
          </div>

          {parseError && (
            <div role="alert" style={{ fontSize: 12.5, color: "var(--priority-critical)" }}>
              {parseError}
            </div>
          )}

          {headers && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
              {TARGET_FIELDS.map((field) => (
                <div className="field" key={field.key}>
                  <label>
                    {field.label}
                    {field.required && " *"}
                  </label>
                  <select
                    className="input"
                    value={mapping[field.key] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value || null }))}
                  >
                    <option value="">— Not mapped —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          {preview && (
            <>
              <div style={{ fontSize: 12.5 }}>
                <span style={{ color: "var(--status-resolved)" }}>{validRows.length} ready to import</span>
                {invalidRows.length > 0 && (
                  <span style={{ color: "var(--priority-critical)", marginLeft: 12 }}>
                    {invalidRows.length} row{invalidRows.length === 1 ? "" : "s"} skipped (see below)
                  </span>
                )}
              </div>
              <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid var(--color-divider)", borderRadius: "var(--radius-md)" }}>
                <table className="table" style={{ fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>Role</th>
                      <th>Facility</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r) => (
                      <tr key={r.line}>
                        <td className="text-muted">{r.line}</td>
                        <td>{r.name}</td>
                        <td>{r.email}</td>
                        <td>{r.phone || "—"}</td>
                        <td>{r.roleRaw}</td>
                        <td>{r.facilityRaw || "—"}</td>
                        <td style={{ color: r.error ? "var(--priority-critical)" : "var(--status-resolved)" }}>{r.error ?? "OK"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {submitError && (
            <div role="alert" style={{ fontSize: 12.5, color: "var(--priority-critical)" }}>
              {submitError}
            </div>
          )}

          {results && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
              <div style={{ fontWeight: 600 }}>
                {results.filter((r) => r.success).length} invited, {results.filter((r) => !r.success).length} failed
              </div>
              {results.map((r) => (
                <div key={r.email} style={{ color: r.success ? "var(--status-resolved)" : "var(--priority-critical)" }}>
                  <i className={`ph ${r.success ? "ph-check-circle" : "ph-x-circle"}`} /> {r.email}
                  {r.error ? ` — ${r.error}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={uploading}>
            Close
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={uploading || validRows.length === 0}>
            {uploading ? "Inviting…" : `Invite ${validRows.length || ""} User${validRows.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
