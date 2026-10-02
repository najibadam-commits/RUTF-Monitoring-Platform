import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Every route under (app)/ reads cookies (Supabase session), so Next treats all of them as
    // fully dynamic and — with the default of 0 — never reuses a page the client already fetched,
    // even for a plain back-and-forth between two tabs a few seconds apart: every click re-runs
    // the full server round trip. Keep a short client-side reuse window instead so switching back
    // to a recently-visited tab is instant; RealtimeRefresher (components/realtime/
    // RealtimeRefresher.tsx) already forces a fresh server fetch via router.refresh() the moment
    // `issues`/`issue_history` actually changes, so this window never shows stale data past an
    // edit someone just made — only past a few idle seconds of nothing changing.
    staleTimes: {
      dynamic: 30,
    },
  },
};

export default nextConfig;
