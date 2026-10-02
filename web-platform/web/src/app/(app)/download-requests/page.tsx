import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessDownloadRequests, canReviewDownloadRequests } from "@/lib/rbac";
import { getDownloadRequests, getMyDownloadRequests } from "@/lib/queries/downloadRequests";
import { DownloadRequestsTable } from "@/components/downloadRequests/DownloadRequestsTable";
import { MyDownloadRequests } from "@/components/downloadRequests/MyDownloadRequests";

export default async function DownloadRequestsPage() {
  const profile = await getCurrentProfile();
  if (!canAccessDownloadRequests(profile.role)) redirect("/dashboard");

  const supabase = await createClient();

  if (canReviewDownloadRequests(profile.role)) {
    // RLS (download_requests_select / _select_project_admin — migration 0036) already scopes
    // this to everything for Super Admin, or just the caller's own project for Project Admin.
    const requests = await getDownloadRequests(supabase);
    return <DownloadRequestsTable requests={requests} />;
  }

  const requests = await getMyDownloadRequests(supabase);
  return <MyDownloadRequests requests={requests} />;
}
