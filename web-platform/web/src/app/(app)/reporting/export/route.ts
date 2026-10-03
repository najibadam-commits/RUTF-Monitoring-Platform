import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { buildRutfExport, RUTF_EXPORTS, type RutfExportKind } from "@/lib/exports/rutfExports";

// Direct RUTF export (Reporting Centre). Viewers go through Download Requests instead — refused
// here even if the URL is typed, as /issues/export does.

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (profile.role === "viewer") {
    return NextResponse.json({ error: "Viewers must request a download for approval." }, { status: 403 });
  }
  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind") as RutfExportKind | null;
  const month = sp.get("month") ?? "";
  if (!kind || !(kind in RUTF_EXPORTS)) return NextResponse.json({ error: "Unknown export" }, { status: 400 });

  try {
    const supabase = await createClient();
    const { content, filename } = await buildRutfExport(supabase, kind, month);
    return new NextResponse(content, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Export failed" }, { status: 400 });
  }
}
