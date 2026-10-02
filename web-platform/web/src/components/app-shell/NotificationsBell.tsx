"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database";

type Notification = Database["public"]["Tables"]["notifications"]["Row"];

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const TYPE_ICON: Record<string, string> = {
  assignment: "ph-user-plus",
  resolved: "ph-check-circle",
  default: "ph-bell",
};

export function NotificationsBell({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (active && data) setNotifications(data);
      });

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          setNotifications((prev) => [payload.new as Notification, ...prev].slice(0, 20));
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function markAllRead() {
    if (unreadCount === 0) return;
    const supabase = createClient();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        className="btn btn-icon btn-secondary"
        style={{ position: "relative" }}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) markAllRead();
        }}
        aria-label="Notifications"
      >
        <i className="ph ph-bell" />
        {unreadCount > 0 && (
          <span style={{ position: "absolute", top: 6, right: 6, width: 7, height: 7, borderRadius: "50%", background: "var(--priority-critical)" }} />
        )}
      </button>
      {open && (
        <div className="card elev-lg" style={{ position: "absolute", top: 44, right: 0, width: 300, padding: 10, gap: 8, zIndex: 20 }}>
          <div className="card-title" style={{ fontSize: 14 }}>
            Notifications
          </div>
          {notifications.length === 0 && (
            <div className="text-muted" style={{ fontSize: 12.5, padding: "8px 0" }}>
              No notifications yet.
            </div>
          )}
          {notifications.map((n) => (
            <div key={n.id} style={{ display: "flex", gap: 8, padding: "8px 0", borderTop: "1px solid var(--color-divider)" }}>
              <i className={`ph ${TYPE_ICON[n.type] ?? TYPE_ICON.default}`} style={{ fontSize: 15, color: "var(--color-accent)", marginTop: 2 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5 }}>{n.text}</div>
                <div className="text-muted" style={{ fontSize: 11 }}>
                  {timeAgo(n.created_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
