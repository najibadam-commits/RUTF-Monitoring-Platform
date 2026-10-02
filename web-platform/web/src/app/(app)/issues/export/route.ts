import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { buildIssuesExportQuery, renderIssuesExport } from "@/lib/exports/issuesExport";
import type { IssueWithRelations } from "@/lib/queries/issues";

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  // A Viewer's export goes through the Download Request/approval workflow instead (see
  // /download-requests and lib/actions/downloadRequests.ts) — this endpoint must refuse a direct
  // hit even if the UI never links a Viewer here, or the approval requirement is trivially bypassed
  // by typing the URL.
  if (profile.role === "viewer") {
    return NextResponse.json({ error: "Viewers must request a download for Super Admin approval." }, { status: 403 });
  }

  const supabase = await createClient();
  const sp = request.nextUrl.searchParams;

  const query = buildIssuesExportQuery(supabase, {
    status: sp.get("status") ?? undefined,
    priority: sp.get("priority") ?? undefined,
    category: sp.get("category") ?? undefined,
    state: sp.get("state") ?? undefined,
    search: sp.get("search") ?? undefined,
  });
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const rows = (data ?? []) as unknown as IssueWithRelations[];
  const { content, contentType, filename } = renderIssuesExport(rows, sp.get("format") === "json" ? "json" : "csv");
  return new NextResponse(content, {
    headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${filename}"` },
  });
}
