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

export const WHY = [
  { icon: "ph-shield-check", tone: "blue", title: "Prevents diversion", body: "Tracking and verification at every step, by lot and level." },
  { icon: "ph-seal-check", tone: "green", title: "Builds accountability", body: "Up-to-date data and a full audit trail." },
  { icon: "ph-tree-structure", tone: "purple", title: "Strengthens supply chains", body: "Better coordination and planning between levels." },
  { icon: "ph-heartbeat", tone: "orange", title: "Saves lives", body: "More children recover and thrive." },
] as const;
