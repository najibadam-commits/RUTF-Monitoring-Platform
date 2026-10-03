"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { buildIssuesExportQuery, renderIssuesExport, type IssuesExportFilters } from "@/lib/exports/issuesExport";
import type { IssueWithRelations } from "@/lib/queries/issues";
import type { Json } from "@/lib/types/database";
import { buildRutfExport, resourceToKind, RUTF_EXPORTS, type RutfExportKind } from "@/lib/exports/rutfExports";

export type ActionResult = { error?: string } | { error?: undefined };

/** Viewer clicks "Request Download" on /issues — creates a pending row instead of downloading,
 * and notifies every Super Admin (see create_download_request in migrations/0030). */
export async function requestDownloadAction(format: string, filters: IssuesExportFilters, reason: string): Promise<ActionResult> {
  await getCurrentProfile(); // enforces auth; RLS/RPC enforce the role/ownership check itself
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_download_request", {
    p_resource_type: "issues_export",
    p_format: format === "json" ? "json" : "csv",
    p_filters: filters as unknown as Json,
    p_reason: reason || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/download-requests");
  return {};
}

/** Viewer requests a RUTF export (Programme Reporting) — same approval flow as the Findings export;
 *  built on approval by fetchApprovedDownloadAction below. */
export async function requestRutfDownloadAction(kind: RutfExportKind, month: string, reason: string): Promise<ActionResult> {
  await getCurrentProfile();
  if (!(kind in RUTF_EXPORTS) || !/^\d{4}-\d{2}$/.test(month)) return { error: "Choose an export and a month." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_download_request", {
    p_resource_type: RUTF_EXPORTS[kind].resource,
    p_format: "csv",
    p_filters: { month } as unknown as Json,
    p_reason: reason || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/download-requests");
  return {};
}

/** Super Admin approves/rejects — see decide_download_request in migrations/0030, which also
 * notifies the requester and (on approval) mints the one-time download_token. */
export async function decideDownloadRequestAction(requestId: string, approve: boolean, note: string): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_download_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_note: note || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/download-requests");
  return {};
}

/** The Viewer's "Download" button on an approved request — re-runs the exact same export query
 * (using the filters captured at request time) and hands the file back for a client-side save,
 * exactly once per approval (the token is single-use: it's cleared as soon as it's fulfilled). */
export async function fetchApprovedDownloadAction(
  requestId: string,
  token: string,
): Promise<ActionResult & { content?: string; contentType?: string; filename?: string }> {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const { data: reqRow, error: reqError } = await supabase
    .from("download_requests")
    .select("*")
    .eq("id", requestId)
    .eq("requester_id", profile.id)
    .eq("status", "approved")
    .eq("download_token", token)
    .maybeSingle();
  if (reqError) return { error: reqError.message };
  if (!reqRow) return { error: "This download is no longer available — it may already have been used or was rejected." };

  let content: string, contentType: string, filename: string;
  const rutfKind = resourceToKind(reqRow.resource_type);
  if (rutfKind) {
    try {
      const month = String((reqRow.filters as Record<string, unknown> | null)?.month ?? "");
      ({ content, filename } = await buildRutfExport(supabase, rutfKind, month));
      contentType = "text/csv; charset=utf-8";
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Export failed" };
    }
  } else {
    const filters = (reqRow.filters ?? {}) as unknown as IssuesExportFilters;
    const query = buildIssuesExportQuery(supabase, filters);
    const { data, error } = await query;
    if (error) return { error: error.message };
    const rows = (data ?? []) as unknown as IssueWithRelations[];
    ({ content, contentType, filename } = renderIssuesExport(rows, reqRow.format === "json" ? "json" : "csv"));
  }

  // Single-use: clear the token so the same link can't be replayed after this fetch. A Viewer has
  // no UPDATE policy on this table (see migrations/0030) — this RPC is SECURITY DEFINER precisely
  // so this one self-service write can go through despite that.
  const { error: fulfillError } = await supabase.rpc("fulfill_download_request", { p_request_id: requestId, p_token: token });
  if (fulfillError) return { error: fulfillError.message };
  revalidatePath("/download-requests");

  return { content, contentType, filename };
}
