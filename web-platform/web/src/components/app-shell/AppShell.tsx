"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { logout } from "@/lib/actions/auth";
import { ROLE_LABELS, NAV_SECTION_LABELS, visibleNavItemsFor, type NavSection } from "@/lib/rbac";
import type { Profile } from "@/lib/supabase/dal";
import { NotificationsBell } from "./NotificationsBell";
import { TopSearch } from "./TopSearch";
import { RutfMark } from "@/components/RutfMark";

const VIEW_TITLES: Record<string, string> = {
  "/dashboard": "Command Centre",
  "/gis": "Live GIS Map",
  "/issues": "Issue Management",
  "/findings-follow-up": "Findings Follow-up",
  "/accountability": "Accountability Scorecard",
  "/reporting": "Reporting & Export Centre",
  "/devices": "Devices & Sync",
  "/users": "Users & Role Management",
  "/data-sets": "Data Sets",
  "/project-admins": "Project Admin Panel",
  "/settings": "System Settings",
};

const SECTION_ORDER: NavSection[] = ["overview", "stock", "supervision", "analytics", "reporting", "administration"];

const SIDEBAR_COLLAPSE_KEY = "tpm.sidebar.collapsed";

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function viewTitleFor(pathname: string) {
  if (pathname.startsWith("/issues/")) return "Issue Detail";
  return VIEW_TITLES[pathname] ?? "RUTF Monitoring Platform";
}

export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const navItems = visibleNavItemsFor(profile.role);
  const [signingOut, setSigningOut] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1");
    } catch {
      // Private-browsing / storage-blocked — fall back to expanded.
    }
  }, []);

  // Close the mobile drawer on every route change so navigating never leaves it stuck open.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Ignore — collapse still works for this session, just won't persist.
      }
      return next;
    });
  }

  const sectionsWithItems = SECTION_ORDER.map((section) => ({
    section,
    items: navItems.filter((item) => item.section === section),
  })).filter((group) => group.items.length > 0);

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-body)", fontSize: 14 }}>
      <div
        className={`app-sidebar-backdrop${mobileOpen ? " open" : ""}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      <aside
        className={`app-sidebar${collapsed ? " collapsed" : ""}${mobileOpen ? " mobile-open" : ""}`}
        style={{ flex: "none", display: "flex", flexDirection: "column", background: "var(--color-sidebar)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: collapsed ? 6 : 10, padding: collapsed ? "18px 10px 16px" : "18px 16px 16px" }}>
          <span style={{ flex: "none", lineHeight: 0 }}><RutfMark size={28} /></span>
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
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "9px 10px",
                      borderRadius: "var(--radius-md)",
                      textDecoration: "none",
                      color: active ? "var(--color-accent-200)" : "rgba(255,255,255,.82)",
                      background: active ? "color-mix(in srgb, #fff 14%, transparent)" : "transparent",
                      borderLeft: active ? "3px solid var(--color-accent-200)" : "3px solid transparent",
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
                background: "var(--color-accent-100)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-accent-800)",
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
            style={{ color: "#fff", borderColor: "rgba(255,255,255,.35)" }}
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
        <header style={{ height: 58, flex: "none", display: "flex", alignItems: "center", gap: 16, padding: "0 24px", borderBottom: "1px solid var(--color-divider)" }}>
          <button
            type="button"
            className="app-hamburger"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text)", padding: 4, lineHeight: 0, alignItems: "center" }}
          >
            <i className="ph ph-list" style={{ fontSize: 20 }} />
          </button>
          <h4 style={{ margin: 0, whiteSpace: "nowrap" }}>{viewTitleFor(pathname)}</h4>
          <TopSearch onSubmit={(q) => router.push(`/issues?search=${encodeURIComponent(q)}`)} />
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
            <NotificationsBell userId={profile.id} />
            <div className="tag tag-outline">{ROLE_LABELS[profile.role]}</div>
          </div>
        </header>
        <main style={{ flex: 1, overflow: "auto" }}>{children}</main>
      </div>
    </div>
  );
}
