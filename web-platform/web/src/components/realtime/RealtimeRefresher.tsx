"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Mount once per page that shows data derived from `issues`/`issue_history`.
 * Subscribes to Realtime changes (RLS still applies — a client only ever
 * receives events for rows it's allowed to SELECT) and re-runs the page's
 * Server Component data fetch via router.refresh() instead of duplicating
 * every screen's aggregation/query logic into client-side state. Debounced
 * so a burst of changes (e.g. an assign + history insert together) triggers
 * one refresh, not several.
 */
export function RealtimeRefresher({ table = "issues" }: { table?: "issues" | "issue_history" }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`realtime-refresh:${table}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => router.refresh(), 400);
      })
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  return null;
}
