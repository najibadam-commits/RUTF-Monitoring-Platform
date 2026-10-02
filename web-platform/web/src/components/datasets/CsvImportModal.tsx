"use client";

import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";

// Generic CSV upload for the RUTF reference data sets (facilities, lots, protocol rules): pick a
// file, map its columns to the set's fields (names don't have to match), preview every row with
// its validation result, then upload only the valid rows. Each tab supplies the fields, a
// per-row validator and the upload action.

export type CsvField = { key: string; label: string; required?: boolean; keywords: string[] };

export type CsvRowResult<T> = { cells: string[]; error: string | null; value?: T };

function guessMapping(headers: string[], fields: CsvField[]) {
  const used = new Set<string>();
  const mapping: Record<string, string | null> = {};
  for (const field of fields) {
    const exact = headers.find((h) => !used.has(h) && h.toLowerCase().replace(/[\s_]+/g, "") === field.key.replace(/_/g, ""));
    const match = exact ?? headers.find((h) => !used.has(h) && field.keywords.some((k) => h.toLowerCase().includes(k)));
    mapping[field.key] = match ?? null;
    if (match) used.add(match);
  }
  return mapping;
}

export function CsvImportModal<T>({
  title,
  intro,
  fields,
  previewHeaders,
  templateCsv,
  templateName,
  validate,
  upload,
  maxRows = 3000,
  onClose,
}: {
  title: string;
  intro: React.ReactNode;
  fields: CsvField[];
  previewHeaders: string[];
  templateCsv: string;
  templateName: string;
  /** Turns one mapped row into preview cells plus a value to upload, or an error. `seen` is
   *  shared across the file so validators can flag duplicates. */
  validate: (row: Record<string, string>, seen: Set<string>) => CsvRowResult<T>;
  upload: (values: T[]) => Promise<{ error?: string; inserted?: number; updated?: number }>;
  maxRows?: number;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [rawRows, setRawRows] = useState<Record<string, string>[] | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ inserted: number; updated: number } | null>(null);

  const preview = useMemo(() => {
    if (!rawRows) return null;
    const seen = new Set<string>();
    return rawRows.map((raw, idx) => {
      const mapped: Record<string, string> = {};
      for (const f of fields) mapped[f.key] = (mapping[f.key] ? raw[mapping[f.key]!] : "")?.trim() ?? "";
      const missing = fields.filter((f) => f.required && !mapped[f.key]).map((f) => f.label);
      const res: CsvRowResult<T> = missing.length
        ? { cells: fields.slice(0, previewHeaders.length).map((f) => mapped[f.key]), error: `Missing ${missing.join(", ")}` }
        : validate(mapped, seen);
      return { line: idx + 2, ...res };
    });
  }, [rawRows, mapping, fields, previewHeaders.length, validate]);

  const validRows = preview?.filter((r) => !r.error && r.value !== undefined) ?? [];
  const invalidCount = preview?.filter((r) => r.error).length ?? 0;
  const missingRequiredMapping = fields.some((f) => f.required && !mapping[f.key]);

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([templateCsv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = templateName;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFile(file: File) {
    setFileName(file.name);
    setParseError(null);
    setResult(null);
    setSubmitError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (parsed) => {
        const detected = parsed.meta.fields ?? [];
        setHeaders(detected);
        setRawRows(parsed.data);
        setMapping(guessMapping(detected, fields));
      },
      error: (err) => setParseError(`Couldn't parse the file: ${err.message}`),
    });
  }

  async function submit() {
    if (validRows.length === 0) return;
    if (validRows.length > maxRows) {
      setSubmitError(`Up to ${maxRows} rows at a time — this file has ${validRows.length} valid rows. Split it into smaller batches.`);
      return;
    }
    setUploading(true);
    setSubmitError(null);
    const res = await upload(validRows.map((r) => r.value as T));
    setUploading(false);
    if (res.error) setSubmitError(res.error);
    if (res.inserted !== undefined || res.updated !== undefined) {
      setResult({ inserted: res.inserted ?? 0, updated: res.updated ?? 0 });
      if (!res.error) {
        setHeaders(null);
        setRawRows(null);
        setFileName("");
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" style={{ width: "min(860px, 100%)" }}>
        <div className="dialog-title">{title}</div>
        <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13 }}>{intro}</div>

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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
              {fields.map((field) => (
                <div className="field" key={field.key}>
                  <label>
                    {field.label}
                    {field.required ? " *" : ""}
                  </label>
                  <select
                    className="input"
                    value={mapping[field.key] ?? ""}
                    onChange={(e) => {
                      const value = e.target.value || null;
                      setMapping((m) => {
                        // One CSV column feeds one field — clear it elsewhere first.
                        const next = { ...m };
                        if (value) for (const k of Object.keys(next)) if (k !== field.key && next[k] === value) next[k] = null;
                        next[field.key] = value;
                        return next;
                      });
                    }}
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
                {missingRequiredMapping ? (
                  <span style={{ color: "var(--priority-critical)" }}>Map every field marked * to continue.</span>
                ) : (
                  <>
                    <span style={{ color: "var(--status-resolved)" }}>{validRows.length} ready to upload</span>
                    {invalidCount > 0 && (
                      <span style={{ color: "var(--priority-critical)", marginLeft: 12 }}>
                        {invalidCount} row{invalidCount === 1 ? "" : "s"} skipped (see below)
                      </span>
                    )}
                  </>
                )}
              </div>
              <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid var(--color-divider)", borderRadius: "var(--radius-md)" }}>
                <table className="table" style={{ fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th>Line</th>
                      {previewHeaders.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 500).map((r) => (
                      <tr key={r.line}>
                        <td className="text-muted">{r.line}</td>
                        {r.cells.map((c, i) => (
                          <td key={i}>{c}</td>
                        ))}
                        <td style={{ color: r.error ? "var(--priority-critical)" : "var(--status-resolved)" }}>{r.error ?? "OK"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.length > 500 && (
                  <div className="text-muted" style={{ fontSize: 12, padding: 8 }}>
                    Showing the first 500 of {preview.length} rows.
                  </div>
                )}
              </div>
            </>
          )}

          {submitError && (
            <div role="alert" style={{ fontSize: 12.5, color: "var(--priority-critical)" }}>
              {submitError}
            </div>
          )}
          {result && (
            <div style={{ fontSize: 12.5, color: "var(--status-resolved)" }}>
              {result.inserted > 0 && `Added ${result.inserted} row${result.inserted === 1 ? "" : "s"}. `}
              {result.updated > 0 && `Updated ${result.updated} row${result.updated === 1 ? "" : "s"}.`}
              {result.inserted === 0 && result.updated === 0 && "Nothing to change."}
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={uploading}>
            Close
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={uploading || missingRequiredMapping || validRows.length === 0}>
            {uploading ? "Uploading…" : `Upload ${validRows.length || ""} Row${validRows.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
