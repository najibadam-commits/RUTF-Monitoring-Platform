"use client";

/** Prints the page (or saves it as PDF from the browser's print dialog). Hidden when printing. */
export function PrintButton({ label = "Print / save as PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn btn-primary no-print" onClick={() => window.print()}>
      <i className="ph ph-printer" aria-hidden="true" /> {label}
    </button>
  );
}
