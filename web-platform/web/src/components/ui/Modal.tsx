"use client";

import { useState, type ReactNode } from "react";

export function Modal({
  title,
  children,
  confirmLabel = "Confirm",
  onConfirm,
  onClose,
  confirmDisabled,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<{ error?: string } | void>;
  onClose: () => void;
  confirmDisabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setPending(true);
    setError(null);
    const result = await onConfirm();
    setPending(false);
    if (result && "error" in result && result.error) {
      setError(result.error);
      return;
    }
    onClose();
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <div className="dialog-title">{title}</div>
        {children}
        {error && (
          <div role="alert" style={{ fontSize: 12.5, color: "var(--priority-critical)" }}>
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={pending || confirmDisabled}>
            {pending ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
