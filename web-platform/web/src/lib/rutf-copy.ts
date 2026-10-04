/**
 * Public-facing copy shared by the landing page (app/page.tsx) and the login page. Taken from the
 * RUTF-DTAP landing mock-up wherever it holds for this platform (brief §1); mock-up claims about
 * QR codes, manufacturer-level tracking and per-child delivery are left out — out of scope.
 */

export const BRAND = {
  name: "RUTF-DTAP Monitoring Platform",
  line1: "Ready-to-Use Therapeutic Food",
  line2: "Digital Traceability & Accountability Platform",
};

export const TAGLINE = "Safe food. Healthy children. Accountable supply chains.";

export const QUOTE = "Nutrition with integrity, a healthier future for my child.";

// Shown on the landing page ("Why it matters") and over the login photo, so each body stays short.
export const WHY = [
  { icon: "ph-shield-check", tone: "blue", title: "Stops loss and diversion", body: "Every lot is traced store to OTP; gaps are flagged automatically." },
  { icon: "ph-seal-check", tone: "green", title: "Makes accountability visible", body: "Each discrepancy has an owner, a deadline and an audit trail." },
  { icon: "ph-tree-structure", tone: "purple", title: "Keeps stock where it's needed", body: "Early warning of stock-outs and expiries, before facilities run dry." },
  { icon: "ph-heartbeat", tone: "orange", title: "Saves children's lives", body: "RUTF on time at the OTP means more children recover from SAM." },
] as const;
