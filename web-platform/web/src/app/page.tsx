import { redirect } from "next/navigation";
import { getOptionalProfile } from "@/lib/supabase/dal";

export default async function RootPage() {
  const profile = await getOptionalProfile();
  redirect(profile ? "/dashboard" : "/login");
}
