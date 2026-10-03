import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/**
 * Service-role Supabase client. Bypasses Row Level Security entirely.
 *
 * `import "server-only"` makes any accidental import from a Client Component
 * fail the build. Only use this inside Server Actions / Route Handlers that
 * have already verified the *caller's* role via a normal (RLS-respecting)
 * client — this key must never reach the browser.
 *
 * Used for: creating/removing Supabase Auth users (Users & Access, Project
 * Admin Panel), and generating password reset links — operations the
 * `auth.users` table itself requires admin privileges for, which plain RLS
 * on `profiles` cannot express.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — admin operations are unavailable.",
    );
  }
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
