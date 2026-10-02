import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types/database";

/**
 * Server-side Supabase client (Server Components, Server Actions, Route
 * Handlers). Reads/writes the auth cookie via Next's cookies() API so the
 * session survives across requests. Still runs as the authenticated user —
 * RLS applies exactly as it does in the browser.
 *
 * Must be created fresh per request (cookies() is request-scoped) — do not
 * cache/reuse a single instance across requests.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component that can't set cookies (e.g. a
            // page render). Safe to ignore as long as proxy.ts refreshes the
            // session on every request — see src/proxy.ts.
          }
        },
      },
    },
  );
}
