import type { UserRole } from "@/lib/types/database";

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
  dri: "DRI",
  viewer: "Viewer",
  state_coordinator: "State Coordinator",
};

/** Role label for a *selection* context (an Add/Edit User role dropdown option) — full "Direct
 *  Responsible Individual (DRI)" wording on this first/deliberate reference per Item 8, vs. the
 *  short "DRI" ROLE_LABELS carries for repeated/space-limited display (table badges, tags). */
export function roleOptionLabel(role: UserRole): string {
  return role === "dri" ? "Direct Responsible Individual (DRI)" : ROLE_LABELS[role];
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
export function canAccessDownloadRequests(role: UserRole) {
  return role === "super_admin" || role === "project_admin" || role === "viewer";
}

/** Distinguishes the admin review table from a Viewer's own-requests list — see
 *  download-requests/page.tsx. */
export function canReviewDownloadRequests(role: UserRole) {
  return role === "super_admin" || role === "project_admin";
}

export function canAccessSubPanel(role: UserRole) {
  return role === "tpm_supervisor" || role === "super_admin";
}

/** Teams and Devices carry no restriction of their own today — every role but Viewer keeps
 * today's access; Viewer is excluded per the "no Administration access" requirement. */
export function canAccessTeams(role: UserRole) {
  return role !== "viewer";
}

export function canAccessDevices(role: UserRole) {
  return role !== "viewer";
}

export function canCreateIssue(role: UserRole) {
  return role === "super_admin" || role === "project_admin" || role === "tpm_supervisor";
}

export function canEditOrDeleteIssue(role: UserRole) {
  return role === "super_admin";
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

/** Admin → Field Monitor Attendance (Items 9/15) — Super Admin (unscoped), Project Admin (own
 *  project), State Coordinator (own state); RLS on field_monitor_attendance enforces the same
 *  three-way scoping server-side — see migration 0037/DECISIONS.md #24. */
export function canAccessAttendance(role: UserRole) {
  return role === "super_admin" || role === "project_admin" || role === "state_coordinator";
}

export type NavKey =
  | "dashboard"
  | "gis"
  | "issues"
  | "subpanel"
  | "implementationMonitoring"
  | "coverageAnalysis"
  | "analytics"
  | "timeEfficiency"
  | "reportingCentre"
  | "postImplementationReport"
  | "teamPerformance"
  | "teams"
  | "devices"
  | "users"
  | "datasets"
  | "projectadmins"
  | "settings"
  | "downloadRequests"
  | "attendance";

export type NavSection = "overview" | "analytics" | "reporting" | "administration";

export const NAV_SECTION_LABELS: Record<NavSection, string> = {
  overview: "Overview",
  analytics: "Analytics",
  reporting: "Reporting",
  administration: "Administration",
};

export const NAV_ITEMS: { key: NavKey; label: string; href: string; icon: string; section: NavSection }[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: "ph-squares-four", section: "overview" },
  { key: "gis", label: "Live GIS Map", href: "/gis", icon: "ph-map-trifold", section: "overview" },
  // key/href intentionally stay "issues"/"/issues" (route, not user-facing text). "Findings"
  // stays the sidebar/dashboard-level module name (Item 6); the detailed management screens
  // reached by clicking in revert to "Issue" terminology (see DECISIONS.md #29) — the module name
  // and the operational terminology inside it are deliberately different, not a naming mistake.
  { key: "issues", label: "Findings", href: "/issues", icon: "ph-list-bullets", section: "overview" },
  { key: "subpanel", label: "TPM Sub-Panel", href: "/subpanel", icon: "ph-kanban", section: "overview" },
  { key: "implementationMonitoring", label: "Implementation Monitoring", href: "/implementation-monitoring", icon: "ph-clipboard-text", section: "overview" },
  { key: "coverageAnalysis", label: "Coverage Analysis", href: "/coverage-analysis", icon: "ph-map-pin-area", section: "overview" },
  { key: "analytics", label: "Analytics", href: "/analytics", icon: "ph-chart-line", section: "analytics" },
  { key: "timeEfficiency", label: "Time Efficiency Analysis", href: "/time-efficiency", icon: "ph-gauge", section: "analytics" },
  { key: "reportingCentre", label: "Reporting Centre", href: "/reporting", icon: "ph-export", section: "reporting" },
  { key: "postImplementationReport", label: "Post Implementation Report", href: "/post-implementation-report", icon: "ph-file-text", section: "reporting" },
  { key: "teamPerformance", label: "Team Performance Report", href: "/team-performance", icon: "ph-chart-bar", section: "reporting" },
  { key: "teams", label: "Teams", href: "/teams", icon: "ph-users", section: "administration" },
  { key: "devices", label: "Devices", href: "/devices", icon: "ph-device-mobile", section: "administration" },
  { key: "users", label: "Users & Roles", href: "/users", icon: "ph-users-three", section: "administration" },
  { key: "datasets", label: "Data Sets", href: "/data-sets", icon: "ph-database", section: "administration" },
  { key: "projectadmins", label: "Project Admin Panel", href: "/project-admins", icon: "ph-identification-badge", section: "administration" },
  { key: "settings", label: "Settings", href: "/settings", icon: "ph-gear-six", section: "administration" },
  { key: "attendance", label: "Field Monitor Attendance", href: "/attendance", icon: "ph-calendar-check", section: "administration" },
  // "reporting", not "administration" — Viewer must have zero Administration-section access, and
  // Viewer is exactly the role that needs this item (to track their own requests).
  { key: "downloadRequests", label: "Download Requests", href: "/download-requests", icon: "ph-download-simple", section: "reporting" },
];

export function visibleNavItemsFor(role: UserRole) {
  return NAV_ITEMS.filter((item) => {
    if (item.key === "subpanel") return canAccessSubPanel(role);
    if (item.key === "users") return canAccessUsersScreen(role);
    if (item.key === "datasets") return canManageDatasets(role);
    if (item.key === "projectadmins") return canAccessProjectAdminPanel(role);
    if (item.key === "settings") return canAccessSettings(role);
    if (item.key === "teams") return canAccessTeams(role);
    if (item.key === "devices") return canAccessDevices(role);
    if (item.key === "downloadRequests") return canAccessDownloadRequests(role);
    if (item.key === "attendance") return canAccessAttendance(role);
    return true;
  });
}
