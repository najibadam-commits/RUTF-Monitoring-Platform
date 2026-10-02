import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export const DOWNLOAD_REQUEST_SELECT = `
  id, requester_id, resource_type, format, filters, reason, status,
  reviewed_by, reviewed_at, review_note, download_token, fulfilled_at, created_at,
  requester:profiles!download_requests_requester_id_fkey(name, email)
`;

export type DownloadRequestRow = Database["public"]["Tables"]["download_requests"]["Row"] & {
  requester: { name: string; email: string } | null;
};

/** Super Admin/Project Admin review view — newest first. RLS already scopes this correctly:
 *  every request for Super Admin, only the caller's own project's requests for Project Admin
 *  (migration 0036/DECISIONS.md #23) — no manual role/project filter needed here. */
export async function getDownloadRequests(client: SupabaseClient<Database>) {
  const { data } = await client.from("download_requests").select(DOWNLOAD_REQUEST_SELECT).order("created_at", { ascending: false });
  return (data ?? []) as unknown as DownloadRequestRow[];
}

/** A Viewer's own request history — RLS scopes this to requester_id = auth.uid() regardless. */
export async function getMyDownloadRequests(client: SupabaseClient<Database>) {
  const { data } = await client
    .from("download_requests")
    .select(DOWNLOAD_REQUEST_SELECT)
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as DownloadRequestRow[];
}
