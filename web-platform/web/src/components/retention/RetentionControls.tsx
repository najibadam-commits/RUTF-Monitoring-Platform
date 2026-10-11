"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { runRetentionAction, setRetentionModeAction } from "@/lib/actions/retention";

const MODES = [["delete", "Delete"], ["report", "Report only"], ["off", "Off"]] as const;

/** Delete / Report only / Off for one rule. */
export function RetentionMode({ ruleKey, mode, label }: { ruleKey: string; mode: string; label: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <select className="input" style={{ maxWidth: 150 }} value={mode} aria-label={`What happens to ${label}`}
        onChange={async (e) => {
          setError(null);
          const r = await setRetentionModeAction(ruleKey, e.target.value as "delete" | "report" | "off");
          if (r.error) setError(r.error); else router.refresh();
        }}>
        {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {error && <div role="alert" style={{ color: "var(--priority-critical)", fontSize: 12 }}>{error}</div>}
    </div>
  );
}

/** Preview (counts only) and Run now (deletes what is due under the rules set to Delete). */
export function RetentionRunButtons({ due }: { due: number }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <button className="btn btn-secondary" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        const r = await runRetentionAction(true);
        setBusy(false);
        if (r.error) setError(r.error); else router.refresh();
      }}><i className="ph ph-eye" /> Preview</button>
      <button className="btn btn-primary" disabled={busy} onClick={() => setConfirm(true)}><i className="ph ph-trash-simple" /> Run now</button>
      {error && <span role="alert" style={{ color: "var(--priority-critical)", fontSize: 13 }}>{error}</span>}
      {confirm && (
        <Modal title="Run data retention now" confirmLabel="Delete what is due" onClose={() => setConfirm(false)} onConfirm={async () => {
          const r = await runRetentionAction(false);
          if (!r.error) router.refresh();
          return r;
        }}>
          <div className="dialog-body" style={{ fontSize: 13 }}>
            <p>{due === 0 ? "Nothing is past its retention period now: the run will delete nothing." :
              `${due.toLocaleString("en-GB")} record${due === 1 ? " is" : "s are"} past the retention period. Those under rules set to Delete are deleted permanently; rules set to Report only are counted.`}</p>
            <p className="text-muted">The same run happens every night at 02:00.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
