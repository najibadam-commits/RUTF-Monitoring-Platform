"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { logout } from "@/lib/actions/auth";
import { NAV_ITEMS, ROLE_LABELS, NAV_SECTION_LABELS, visibleNavItemsFor, type NavSection } from "@/lib/rbac";
import type { Profile } from "@/lib/supabase/dal";
import { NotificationsBell } from "./NotificationsBell";
import { TopSearch } from "./TopSearch";
import { RutfMark } from "@/components/RutfMark";

const VIEW_TITLES: Record<string, string> = {
  "/dashboard": "Overview Dashboard",
  "/gis": "Situation Map",
  "/issues": "Findings Register",
  "/action-tracker": "Corrective Action Tracker",
  "/accountability": "Accountability Scorecard",
  "/stock-integrity": "Stock Reconciliation",
  "/reporting-completeness": "Completeness & Timeliness",
  "/otp-dispensing": "Last-Mile Dispensing",
  "/otp-caseload": "OTP Caseload",
  "/weekly-reports": "Weekly OTP Reports",
  "/supervision": "Risk-Based Supervision",
  "/reporting": "Programme Reporting",
  "/download-requests": "Data Access Requests",
  "/devices": "Offline Sync Health",
  "/users": "Users & Access",
  "/data-sets": "Master Data",
  "/project-admins": "Programme Administrators",
  "/settings": "System Settings",
};

const SECTION_ORDER: NavSection[] = ["overview", "stock", "supervision", "analytics", "reporting", "administration"];

const SIDEBAR_COLLAPSE_KEY = "tpm.sidebar.collapsed";

// The collapsed sidebar is remembered in localStorage and read as an external store, so the first
// paint matches the server (expanded) and the saved choice applies straight after. If storage is
// blocked (private browsing) the choice is kept in memory for this session instead.
const COLLAPSE_EVENT = "tpm-sidebar-collapse";
let collapsedInMemory: boolean | null = null;
function readCollapsed() {
  if (collapsedInMemory !== null) return collapsedInMemory;
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeCollapsed(next: boolean) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? "1" : "0");
  } catch {
    collapsedInMemory = next;
  }
  window.dispatchEvent(new Event(COLLAPSE_EVENT));
}
function subscribeCollapsed(onChange: () => void) {
  window.addEventListener(COLLAPSE_EVENT, onChange);
  return () => window.removeEventListener(COLLAPSE_EVENT, onChange);
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/** Top-bar title. Detail pages get their own name; anything else falls back to the menu label of
 *  the section it sits under. (Browser-tab titles: each page's metadata, with the root layout's template.) */
const PLATFORM = "RUTF-DTAP Monitoring Platform";
const DETAIL_TITLES: [prefix: string, title: string][] = [
  ["/issues/", "Finding detail"],
  ["/supervision/", "Supervision visit"],
];

function viewTitleFor(pathname: string) {
  if (VIEW_TITLES[pathname]) return VIEW_TITLES[pathname];
  const detail = DETAIL_TITLES.find(([prefix]) => pathname.startsWith(prefix));
  if (detail) return detail[1];
  const section = [...NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  return section?.label ?? PLATFORM;
}

export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const title = viewTitleFor(pathname);

  const navItems = visibleNavItemsFor(profile.role);
  const [signingOut, setSigningOut] = useState(false);
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  // The mobile drawer remembers the page it was opened on, so navigating closes it and never
  // leaves it stuck open.
  const [drawerOpenOn, setDrawerOpenOn] = useState<string | null>(null);
  const mobileOpen = drawerOpenOn === pathname;

  function toggleCollapsed() {
    writeCollapsed(!collapsed);
  }

  const sectionsWithItems = SECTION_ORDER.map((section) => ({
    section,
    items: navItems.filter((item) => item.section === section),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="app-root" style={{ display: "flex", height: "100vh", background: "var(--page-bg)", color: "var(--color-text)", fontFamily: "var(--font-body)", fontSize: 14 }}>
      <div
        className={`app-sidebar-backdrop${mobileOpen ? " open" : ""}`}
        onClick={() => setDrawerOpenOn(null)}
        aria-hidden="true"
      />

      <aside
        className={`app-sidebar${collapsed ? " collapsed" : ""}${mobileOpen ? " mobile-open" : ""}`}
        style={{ flex: "none", display: "flex", flexDirection: "column", background: "var(--sidebar-bg)", boxShadow: "4px 0 24px rgba(11, 58, 125, 0.18)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: collapsed ? 6 : 10, padding: collapsed ? "18px 10px 16px" : "18px 16px 16px" }}>
          <span style={{ flex: "none", lineHeight: 0, background: "#fff", borderRadius: 10, padding: 4, boxShadow: "0 2px 8px rgba(0,0,0,.15)" }}><RutfMark size={26} /></span>
          <span className="app-brand-label" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 14, lineHeight: 1.25, color: "#fff", whiteSpace: "nowrap", overflow: "hidden" }}>
            RUTF Monitoring
            <br />
            Platform
          </span>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="app-collapse-toggle"
            style={{ marginLeft: "auto", display: "inline-flex", background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,.7)", padding: 4, lineHeight: 0, flex: "none" }}
          >
            <i className={collapsed ? "ph ph-caret-right" : "ph ph-caret-left"} style={{ fontSize: 16 }} />
          </button>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 10px", flex: 1, overflow: "auto" }}>
          {sectionsWithItems.map(({ section, items }) => (
            <div key={section}>
              <div className="app-nav-section-label">{NAV_SECTION_LABELS[section]}</div>
              {items.map((item) => {
                const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    title={item.label}
                    className="app-nav-link"
                    aria-current={active ? "page" : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "9px 11px",
                      borderRadius: 12,
                      textDecoration: "none",
                      fontWeight: active ? 600 : 400,
                      color: active ? "#fff" : "rgba(255,255,255,.86)",
                      background: active ? "rgba(255,255,255,.18)" : "transparent",
                      boxShadow: active ? "inset 3px 0 0 var(--brand-turquoise), 0 2px 10px rgba(0,0,0,.08)" : "none",
                    }}
                  >
                    <i className={`ph ${item.icon}`} style={{ fontSize: 16, flex: "none" }} />
                    <span className="app-nav-label" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--color-sidebar-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div
              style={{
                width: 32,
                height: 32,
                flex: "none",
                borderRadius: "50%",
                background: "var(--gradient-edge)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {initials(profile.name)}
            </div>
            <div className="app-profile-detail" style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {profile.name}
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,.65)" }}>
                {ROLE_LABELS[profile.role]}
              </div>
            </div>
          </div>
          <button
            className="btn btn-secondary btn-block"
            disabled={signingOut}
            title="Sign Out"
            style={{ color: "#fff", background: "rgba(255,255,255,.10)", borderColor: "rgba(255,255,255,.35)" }}
            onClick={() => {
              setSigningOut(true);
              logout();
            }}
          >
            <i className="ph ph-sign-out" />
            <span className="app-nav-label">{signingOut ? "Signing out…" : "Sign Out"}</span>
          </button>
        </div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header className="app-topbar" style={{ height: 60, flex: "none", display: "flex", alignItems: "center", gap: 16, padding: "0 24px" }}>
          <button
            type="button"
            className="app-hamburger"
            onClick={() => setDrawerOpenOn(pathname)}
            aria-label="Open navigation menu"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text)", padding: 4, lineHeight: 0, alignItems: "center" }}
          >
            <i className="ph ph-list" style={{ fontSize: 20 }} />
          </button>
          <h4 style={{ margin: 0, whiteSpace: "nowrap" }}>{title}</h4>
          <TopSearch onSubmit={(q) => router.push(`/issues?search=${encodeURIComponent(q)}`)} />
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
            <NotificationsBell userId={profile.id} />
            <div className="tag tag-outline">{ROLE_LABELS[profile.role]}</div>
          </div>
        </header>
        <main className="app-main" style={{ flex: 1, overflow: "auto" }}>{children}</main>
      </div>
    </div>
  );
}
