"use client";

import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { bulkAddActivitySitesAction, bulkAddSettlementsAction } from "@/lib/actions/datasets";

type Kind = "settlements" | "activitySites";
type NamedRef = { id: string; name: string };

// No external rate limit applies here (a plain table insert, unlike Bulk Import Users' Auth
// API calls) — this cap is just a sane upper bound, not a workaround for a real constraint.
const MAX_ROWS = 1000;

type TargetField = "state" | "lga" | "ward" | "name";
const NAME_LABEL: Record<Kind, string> = {
  settlements: "Settlement Name",
  activitySites: "Activity Site Name",
};
const FIELD_LABEL: Record<TargetField, string> = { state: "State", lga: "LGA", ward: "Ward", name: "" };

function guessMapping(headers: string[], kind: Kind): Record<TargetField, string | null> {
  const keywords: Record<TargetField, string[]> = {
    state: ["state"],
    lga: ["lga", "local government"],
    ward: ["ward"],
    name: kind === "settlements" ? ["settlement", "name"] : ["activity", "site", "name"],
  };
  const used = new Set<string>();
  const mapping = {} as Record<TargetField, string | null>;
  for (const field of ["state", "lga", "ward", "name"] as TargetField[]) {
    const match = headers.find((h) => !used.has(h) && keywords[field].some((k) => h.toLowerCase().includes(k)));
    mapping[field] = match ?? null;
    if (match) used.add(match);
  }
  return mapping;
}

function normalize(s: string) {
  return s.trim().toLowerCase();
}

interface PreviewRow {
  line: number;
  statename: string;
  lganame: string;
  wardname: string;
  name: string;
  wardId: string | null;
  error: string | null;
}

export function CsvUploadModal({
  kind,
  states,
  lgasByState,
  wardsByLga,
  onClose,
}: {
  kind: Kind;
  states: NamedRef[];
  lgasByState: Record<string, NamedRef[]>;
  wardsByLga: Record<string, NamedRef[]>;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [rawRows, setRawRows] = useState<Record<string, string>[] | null>(null);
  const [mapping, setMapping] = useState<Record<TargetField, string | null>>({ state: null, lga: null, ward: null, name: null });
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ inserted: number } | null>(null);

  const nameLabel = NAME_LABEL[kind];
  const stateIndex = useMemo(() => new Map(states.map((s) => [normalize(s.name), s])), [states]);

  // Only duplicate-in-file is checked client-side, not duplicate-vs-existing: settlements/
  // activity_sites have 300k+/30k+ real rows nationally, and the page only ever has a bounded
  // subset of those loaded (see DECISIONS.md's note on the settlements/activity_sites unbounded
  // select — a separate, pre-existing issue). Checking against an incomplete list would give
  // false "OK" confidence on the vast majority of real duplicates, which is worse than no check.
  // The DB's unique index (ward_id, name) where status <> 'rejected' — migration 0019 — remains
  // the actual source of truth; a genuine duplicate still surfaces as a clear error on submit,
  // exactly as it did before this change.
  const preview = useMemo<PreviewRow[] | null>(() => {
    if (!rawRows) return null;
    const seenInFile = new Set<string>();
    return rawRows.map((raw, idx) => {
      const line = idx + 2; // +1 for header row, +1 for 1-indexing
      const rawState = (mapping.state ? raw[mapping.state] : "")?.trim() ?? "";
      const rawLga = (mapping.lga ? raw[mapping.lga] : "")?.trim() ?? "";
      const rawWard = (mapping.ward ? raw[mapping.ward] : "")?.trim() ?? "";
      const rawName = (mapping.name ? raw[mapping.name] : "")?.trim() ?? "";

      if (!rawState || !rawLga || !rawWard || !rawName) {
        return { line, statename: rawState, lganame: rawLga, wardname: rawWard, name: rawName, wardId: null, error: "Missing a required column value" };
      }
      const matchedState = stateIndex.get(normalize(rawState));
      if (!matchedState) {
        return { line, statename: rawState, lganame: rawLga, wardname: rawWard, name: rawName, wardId: null, error: `Unrecognized state "${rawState}"` };
      }
      const lgaList = lgasByState[matchedState.id] ?? [];
      const matchedLga = lgaList.find((l) => normalize(l.name) === normalize(rawLga));
      if (!matchedLga) {
        return { line, statename: matchedState.name, lganame: rawLga, wardname: rawWard, name: rawName, wardId: null, error: `Unrecognized LGA "${rawLga}" for ${matchedState.name}` };
      }
      const wardList = wardsByLga[matchedLga.id] ?? [];
      const matchedWard = wardList.find((w) => normalize(w.name) === normalize(rawWard));
      if (!matchedWard) {
        return { line, statename: matchedState.name, lganame: matchedLga.name, wardname: rawWard, name: rawName, wardId: null, error: `Unrecognized Ward "${rawWard}" for ${matchedLga.name}` };
      }

      const key = `${matchedWard.id}::${normalize(rawName)}`;
      if (seenInFile.has(key)) {
        return { line, statename: matchedState.name, lganame: matchedLga.name, wardname: matchedWard.name, name: rawName, wardId: null, error: "Duplicate row in file" };
      }
      seenInFile.add(key);
      return { line, statename: matchedState.name, lganame: matchedLga.name, wardname: matchedWard.name, name: rawName, wardId: matchedWard.id, error: null };
    });
  }, [rawRows, mapping, stateIndex, lgasByState, wardsByLga]);

  const validRows = preview?.filter((r) => !r.error && r.wardId) ?? [];
  const invalidRows = preview?.filter((r) => r.error) ?? [];

  function downloadTemplate() {
    const csv = `state,lga,ward,${kind === "settlements" ? "settlement name" : "activity site name"}\nLagos,Ikeja,Olusosun,Example ${kind === "settlements" ? "Settlement" : "Activity Site"} Name\n`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kind}-template.csv`;
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
        const detectedHeaders = parsed.meta.fields ?? [];
        setHeaders(detectedHeaders);
        setRawRows(parsed.data);
        setMapping(guessMapping(detectedHeaders, kind));
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
    const res =
      kind === "settlements"
        ? await bulkAddSettlementsAction(validRows.map((r) => ({ wardId: r.wardId!, settlementname: r.name })))
        : await bulkAddActivitySitesAction(validRows.map((r) => ({ wardId: r.wardId!, activitysitename: r.name })));
    setUploading(false);
    if (res.error) setSubmitError(res.error);
    if (res.inserted !== undefined) {
      setResult({ inserted: res.inserted });
      setHeaders(null);
      setRawRows(null);
      setFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" style={{ width: "min(760px, 100%)" }}>
        <div className="dialog-title">Upload {kind === "settlements" ? "Settlements" : "Activity Sites"} CSV</div>
        <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ marginTop: 0, fontSize: 13 }}>
            Upload any CSV, then map its columns to the fields below — column names don&apos;t need to match.
            State, LGA and Ward names are matched against the platform&apos;s real administrative boundary list
            (case-insensitive).
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
              {(["state", "lga", "ward", "name"] as TargetField[]).map((field) => (
                <div className="field" key={field}>
                  <label>{field === "name" ? nameLabel : FIELD_LABEL[field]} *</label>
                  <select
                    className="input"
                    value={mapping[field] ?? ""}
                    onChange={(e) => {
                      const value = e.target.value || null;
                      setMapping((m) => {
                        // A column already mapped to another field is cleared there first —
                        // two fields can't silently read the same CSV column.
                        const next = { ...m };
                        if (value) {
                          for (const f of Object.keys(next) as TargetField[]) {
                            if (f !== field && next[f] === value) next[f] = null;
                          }
                        }
                        next[field] = value;
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
                <span style={{ color: "var(--status-resolved)" }}>{validRows.length} ready to upload</span>
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
                      <th>State</th>
                      <th>LGA</th>
                      <th>Ward</th>
                      <th>Name</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r) => (
                      <tr key={r.line}>
                        <td className="text-muted">{r.line}</td>
                        <td>{r.statename}</td>
                        <td>{r.lganame}</td>
                        <td>{r.wardname}</td>
                        <td>{r.name}</td>
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
          {result && (
            <div style={{ fontSize: 12.5, color: "var(--status-resolved)" }}>
              Uploaded {result.inserted} row{result.inserted === 1 ? "" : "s"}.
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={uploading}>
            Close
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={uploading || validRows.length === 0}>
            {uploading ? "Uploading…" : `Upload ${validRows.length || ""} Row${validRows.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
