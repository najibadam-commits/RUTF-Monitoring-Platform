import type { UserRole } from "@/lib/types/database";

/** A facility officer's level (rutf_officer_level(), 0134): "state" = State Nutrition Officer,
 *  "lga" = LGA Nutrition Officer, "otp" = OTP Officer; null for every other role. */
export type OfficerLevel = "state" | "lga" | "otp" | null;

/** The role as people say it: a facility officer by their level (R141). */
export function roleLabelFor(role: UserRole, level: OfficerLevel = null): string {
  if (role === "dri") return level === "state" ? "State Nutrition Officer" : level === "lga" ? "LGA Nutrition Officer" : level === "otp" ? "OTP Officer" : ROLE_LABELS.dri;
  return ROLE_LABELS[role];
}

/**
 * Frontend mirror of the RLS policies in supabase/migrations/0008-0009.
 * This file is what drives nav visibility, route guards, and disabling
 * buttons — it is a UX convenience, not the security boundary. Every rule
 * here has a matching Postgres policy; if you change one, change both (see
 * DECISIONS.md #1).
 */

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  project_admin: "Project Admin",
  tpm_supervisor: "Supervisor",
  dri: "OTP / Nutrition Officer",
  viewer: "Viewer",
  state_coordinator: "State Coordinator",
};

/** Role label for a *selection* context (an Add/Edit User role dropdown option) — full "Direct
 *  Responsible Individual (DRI)" wording on this first/deliberate reference per Item 8, vs. the
 *  short "DRI" ROLE_LABELS carries for repeated/space-limited display (table badges, tags). */
export function roleOptionLabel(role: UserRole): string {
  return ROLE_LABELS[role];
}

export const ASSIGNABLE_ROLES_BY_SUPER_ADMIN: UserRole[] = [
  "project_admin",
  "tpm_supervisor",
  "state_coordinator",
  "dri",
  "viewer",
];
export const ASSIGNABLE_ROLES_BY_PROJECT_ADMIN: UserRole[] = ["tpm_supervisor", "state_coordinator", "dri", "viewer"];

export function isViewer(role: UserRole) {
  return role === "viewer";
}

export function canAccessUsersScreen(role: UserRole) {
  return role === "super_admin" || role === "project_admin";
}

export function canAccessProjectAdminPanel(role: UserRole) {
  return role === "super_admin";
}

/** "Add Data Set" (Settlements / Activity Sites) — Super Admin and Project Admin, per the approval-workflow requirement. */
export function canManageDatasets(role: UserRole) {
  return role === "super_admin" || role === "project_admin";
}

export function canAccessSettings(role: UserRole) {
  return role === "super_admin";
}

/** Super Admin and Project Admin review/decide requests here (Project Admin scoped to their own
 *  project — see migration 0036/DECISIONS.md #23); Viewer tracks their own — see
 *  download-requests/page.tsx. */
/** Weekly OTP Site Reports (R148, R171): the LGA Nutrition Officer reviews and accepts the OTP
 *  reports of their LGA; the State Nutrition Officer, the State Coordinator (technical oversight:
 *  query or return) and Supervisors (their LGAs) see them; administrators see them. OTP Officers
 *  prepare and submit theirs in the app. otp_reports_overview() scopes the rows. */
export function canAccessWeeklyReports(role: UserRole, level: OfficerLevel = null) {
  return role === "state_coordinator" || role === "super_admin" || role === "project_admin" || role === "tpm_supervisor"
    || (role === "dri" && (level === "lga" || level === "state"));
}

/** LGA Weekly Reports (R171): combined from the accepted OTP reports; the LGA Nutrition Officer
 *  submits, the State Nutrition Officer accepts, the State Coordinator may query or return. */
export const canAccessLgaReports = canAccessWeeklyReports;

/** Supply Requests (R170): the LGA and State Nutrition Officers review, request and approve on the
 *  web; OTP Officers request in the app; the State Coordinator and Supervisors see and comment. */
export const canAccessSupplyRequests = canAccessWeeklyReports;

export function canAccessDownloadRequests(role: UserRole) {
  return role === "super_admin" || role === "project_admin" || role === "viewer";
}

/** Distinguishes the admin review table from a Viewer's own-requests list — see
 *  download-requests/page.tsx. */
export function canReviewDownloadRequests(role: UserRole) {
  return role === "super_admin" || role === "project_admin";
}

export function canAccessActionTracker(role: UserRole) {
  return role === "tpm_supervisor" || role === "super_admin";
}

/** Offline Sync Health (migration 0108): sync_health() returns rows to these roles only. */
export function canAccessDevices(role: UserRole) {
  return role === "super_admin" || role === "project_admin" || role === "state_coordinator";
}

/** Void a ledger submission (migration 0109): void_ledger_submission() allows these roles only. */
export function canVoidLedger(role: UserRole) {
  return role === "super_admin" || role === "project_admin";
}

/** Audit trail (migration 0108): audit_log is readable by Super Admin and Project Admin. */
export function canAccessAuditLog(role: UserRole) {
  return role === "super_admin" || role === "project_admin";
}

export function canCreateIssue(role: UserRole) {
  return role === "super_admin" || role === "project_admin" || role === "tpm_supervisor";
}

export function canEditOrDeleteIssue(role: UserRole) {
  return role === "super_admin";
}

/** The officer who acts on a Finding, by where they work (DECISIONS R141): the OTP Officer at the
 *  OTP site (attends the child, fills the card, distributes the RUTF), the LGA Nutrition Officer at
 *  the LGA Nutrition Store, the State Nutrition Officer at the State Central Medical Store. All
 *  three are the one role `dri`; where no single level is meant, "Officer". A facility type is
 *  preferred; a Finding's facility level (category name) also works. */
export function officerTitle(level?: string | null): string {
  const l = (level ?? "").toLowerCase();
  if (l === "state_store" || l.includes("state store")) return "State Nutrition Officer";
  if (l === "lga_store" || l.includes("lga store")) return "LGA Nutrition Officer";
  if (l === "health_facility" || l.includes("otp")) return "OTP Officer";
  return "Officer";
}

const withArticle = (title: string) => (/^[AEIOU]/.test(title) ? `an ${title}` : `a ${title}`);

/** Older history entries and database messages still say "DRI" or "Direct Responsible
 *  Individual"; displayed text goes through this, with the right title where it is known. */
export function officerText(text: string, title = "Officer"): string {
  return text
    .replace(/Direct(?:ly)? Responsible Individuals? \(DRIs?\)/g, title)
    .replace(/Direct(?:ly)? Responsible Individual/g, title)
    .replace(/\ba DRI\b/g, withArticle(title))
    .replace(/\bDRIs\b/g, `${title}s`)
    .replace(/\bDRI\b/g, title);
}

/** Gates the *legacy* assign-a-DRI action — only ever reachable for a pre-migration Finding
 *  still sitting at status "new" (see DECISIONS.md #22). Every Finding created after the State
 *  Coordinator workflow shipped starts at "pending_review" instead, so this becomes dead for new
 *  Findings without needing its own removal — callers already gate it on `status === "new"`. */
export function canAssign(role: UserRole) {
  return role === "super_admin" || role === "project_admin" || role === "tpm_supervisor";
}

/** Issue review: approve+assign, edit, or return for correction. State Coordinator, Project
 *  Admin, and Super Admin all have this authority — gated further by the caller checking
 *  `issue.status` is "pending_review"/"returned_for_correction" AND the caller's own scope
 *  (`managed_state_id === issue.state_id` for a State Coordinator, project match for a Project
 *  Admin — see `isReviewerForThisIssue`). RLS + the RPCs' own row-scoped UPDATE enforce the real
 *  boundary; this only drives the UI. See DECISIONS.md #29. */
export function canReviewFinding(role: UserRole) {
  return role === "super_admin" || role === "state_coordinator" || role === "project_admin";
}

export function canRespond(role: UserRole, isAssignedDri: boolean) {
  return role === "super_admin" || (role === "dri" && isAssignedDri);
}

export function canRecordCorrective(role: UserRole, isAssignedDri: boolean) {
  return role === "super_admin" || (role === "dri" && isAssignedDri);
}

export function canVerify(role: UserRole) {
  return role === "super_admin" || role === "project_admin" || role === "tpm_supervisor";
}

export function assignableRolesFor(role: UserRole): UserRole[] {
  if (role === "super_admin") return ASSIGNABLE_ROLES_BY_SUPER_ADMIN;
  if (role === "project_admin") return ASSIGNABLE_ROLES_BY_PROJECT_ADMIN;
  return [];
}

export type NavKey =
  | "dashboard"
  | "gis"
  | "issues"
  | "actionTracker"
  | "accountability"
  | "reportingCentre"
  | "devices"
  | "users"
  | "datasets"
  | "projectadmins"
  | "settings"
  | "downloadRequests"
  | "auditLog"
  | "stockLedger"
  | "transfers"
  | "stockIntegrity"
  | "reportingCompleteness"
  | "otpDispensing"
  | "otpCaseload"
  | "clinicalRules"
  | "weeklyReports"
  | "lgaReports"
  | "dataRetention"
  | "supplyRequests"
  | "supervision"
  | "dhis2Triangulation";

export type NavSection = "overview" | "stock" | "supervision" | "analytics" | "reporting" | "administration";

export const NAV_SECTION_LABELS: Record<NavSection, string> = {
  overview: "Overview",
  stock: "Stock",
  supervision: "Supervision",
  analytics: "Analytics",
  reporting: "Reporting",
  administration: "Administration",
};

export const NAV_ITEMS: { key: NavKey; label: string; href: string; icon: string; section: NavSection }[] = [
  { key: "dashboard", label: "Overview Dashboard", href: "/dashboard", icon: "ph-squares-four", section: "overview" },
  { key: "gis", label: "Situation Map", href: "/gis", icon: "ph-map-trifold", section: "overview" },
  // key/href intentionally stay "issues"/"/issues" (route, not user-facing text). "Findings"
  // stays the sidebar/dashboard-level module name (Item 6); the detailed management screens
  // reached by clicking in revert to "Issue" terminology (see DECISIONS.md #29) — the module name
  // and the operational terminology inside it are deliberately different, not a naming mistake.
  { key: "issues", label: "Findings Register", href: "/issues", icon: "ph-list-bullets", section: "overview" },
  { key: "actionTracker", label: "Corrective Action Tracker", href: "/action-tracker", icon: "ph-kanban", section: "overview" },
  // Findings Analytics + Time Efficiency merged (DECISIONS R57).
  { key: "accountability", label: "Accountability Scorecard", href: "/accountability", icon: "ph-seal-check", section: "overview" },
  // RUTF stock (brief §9). Every role sees these; RLS scopes the rows (a facility user: their own
  // facility only).
  { key: "stockLedger", label: "Stock Ledger", href: "/stock-ledger", icon: "ph-book-open-text", section: "stock" },
  { key: "transfers", label: "Transfers", href: "/transfers", icon: "ph-truck", section: "stock" },
  // Supply requests OTP -> LGA store -> State store (R170); approval is separate from the stock issue.
  { key: "supplyRequests", label: "Supply Requests", href: "/supply-requests", icon: "ph-package", section: "stock" },
  // Analysis pages (brief §9, M5) — facility_metrics() is security invoker, so RLS scopes them too.
  { key: "stockIntegrity", label: "Stock Reconciliation", href: "/stock-integrity", icon: "ph-scales", section: "stock" },
  { key: "reportingCompleteness", label: "Completeness & Timeliness", href: "/reporting-completeness", icon: "ph-check-square-offset", section: "stock" },
  { key: "otpDispensing", label: "Last-Mile Dispensing", href: "/otp-dispensing", icon: "ph-hand-heart", section: "stock" },
  // OTP Caseload (DECISIONS R143): aggregates from the Digital OTP Admission Card; no child records.
  { key: "otpCaseload", label: "OTP Caseload", href: "/otp-caseload", icon: "ph-baby", section: "stock" },
  { key: "clinicalRules", label: "Clinical Rules", href: "/clinical-rules", icon: "ph-first-aid-kit", section: "stock" },
  { key: "supervision", label: "Risk-Based Supervision", href: "/supervision", icon: "ph-clipboard-text", section: "supervision" },
  { key: "dhis2Triangulation", label: "DHIS2 Triangulation", href: "/dhis2-triangulation", icon: "ph-intersect", section: "analytics" },
  { key: "reportingCentre", label: "Programme Reporting", href: "/reporting", icon: "ph-export", section: "reporting" },
  { key: "weeklyReports", label: "Weekly OTP Reports", href: "/weekly-reports", icon: "ph-calendar-check", section: "reporting" },
  { key: "lgaReports", label: "LGA Weekly Reports", href: "/lga-reports", icon: "ph-stack", section: "reporting" },
  { key: "devices", label: "Offline Sync Health", href: "/devices", icon: "ph-device-mobile", section: "administration" },
  { key: "auditLog", label: "Audit Trail", href: "/audit-log", icon: "ph-clock-counter-clockwise", section: "administration" },
  // Automatic deletion at the end of retention (R177; DPIA §8): Super Admin only.
  { key: "dataRetention", label: "Data Retention", href: "/data-retention", icon: "ph-trash-simple", section: "administration" },
  { key: "users", label: "Users & Access", href: "/users", icon: "ph-users-three", section: "administration" },
  { key: "datasets", label: "Master Data", href: "/data-sets", icon: "ph-database", section: "administration" },
  { key: "projectadmins", label: "Programme Administrators", href: "/project-admins", icon: "ph-identification-badge", section: "administration" },
  { key: "settings", label: "Settings", href: "/settings", icon: "ph-gear-six", section: "administration" },
  // "reporting", not "administration" — Viewer must have zero Administration-section access, and
  // Viewer is exactly the role that needs this item (to track their own requests).
  { key: "downloadRequests", label: "Data Access Requests", href: "/download-requests", icon: "ph-download-simple", section: "reporting" },
];

export function visibleNavItemsFor(role: UserRole, level: OfficerLevel = null) {
  return NAV_ITEMS.filter((item) => {
    if (item.key === "actionTracker") return canAccessActionTracker(role);
    if (item.key === "users") return canAccessUsersScreen(role);
    if (item.key === "datasets") return canManageDatasets(role);
    if (item.key === "projectadmins") return canAccessProjectAdminPanel(role);
    if (item.key === "settings") return canAccessSettings(role);
    if (item.key === "devices") return canAccessDevices(role);
    if (item.key === "auditLog") return canAccessAuditLog(role);
    if (item.key === "dataRetention") return role === "super_admin";
    if (item.key === "downloadRequests") return canAccessDownloadRequests(role);
    if (item.key === "weeklyReports") return canAccessWeeklyReports(role, level);
    if (item.key === "lgaReports") return canAccessLgaReports(role, level);
    if (item.key === "supplyRequests") return canAccessSupplyRequests(role, level);
    return true;
  });
}
