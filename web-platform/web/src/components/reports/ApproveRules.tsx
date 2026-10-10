"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { approveRulesAction } from "@/lib/actions/clinicalRules";

/** The State Nutrition Officer approves the draft rule set (otp_rule_set_approve checks the role).
 *  It applies from today to new admissions; children already admitted keep their rules. */
export function ApproveRules({ version, openQuestions }: { version: string; openQuestions: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  return (
    <div className="card elev-sm" style={{ gap: 10, borderLeft: "4px solid var(--stage-addressing)" }}>
      <div className="card-title">Your approval</div>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        As the State Nutrition Officer you set the rules the OTP Officers follow. Approving puts version {version} in force from today for new admissions.
        {openQuestions > 0 ? ` ${openQuestions} question${openQuestions === 1 ? " is" : "s are"} still open: those cases keep going for clinical review.` : ""}
      </p>
      <div><button className="btn btn-primary" onClick={() => { setOpen(true); setConfirmed(false); setNote(""); }}><i className="ph ph-seal-check" /> Approve the rules</button></div>
      {open && (
        <Modal
          title={`Approve rule set ${version}`}
          confirmLabel="Approve"
          confirmDisabled={!confirmed}
          onClose={() => setOpen(false)}
          onConfirm={async () => {
            const r = await approveRulesAction(version, note);
            if (!r.error) router.refresh();
            return r;
          }}
        >
          <div className="dialog-body">
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I have reviewed these rules against the approved guidelines
            </label>
            <div className="field">
              <label>Note (optional)</label>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the OTP Officers should know…" />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
