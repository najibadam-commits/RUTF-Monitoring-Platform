import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/**
 * The real (non-optimistic) authorization boundary for Server Components,
 * Server Actions, and Route Handlers — see node_modules/next/dist/docs's
 * authentication guide, "Creating a Data Access Layer (DAL)". Unlike
 * proxy.ts (cookie-only, no DB round-trip), this re-fetches the profile from
 * Postgres so role/status changes take effect immediately, and is memoized
 * per request with React's cache() so calling it from multiple components
 * costs one query, not N.
 *
 * Redirects to /login if there's no session or the profile is missing;
 * redirects to /deactivated if the account has been deactivated.
 */
export const getCurrentProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  if (error || !profile) {
    redirect("/login");
  }

  if (profile.status === "inactive") {
    redirect("/deactivated");
  }

  return profile;
});

/** A facility officer's level — "state" (State Nutrition Officer, State store), "lga" (LGA
 *  Nutrition Officer, LGA store) or "otp" (OTP Officer) — null for every other role. Their
 *  jurisdiction and workflow follow it (DECISIONS R169–R171). */
export type OfficerLevel = "state" | "lga" | "otp" | null;
export const getOfficerLevel = cache(async (): Promise<OfficerLevel> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("rutf_officer_level");
  return (data as OfficerLevel) ?? null;
});

/** Non-redirecting variant for places that need to render differently for a signed-out visitor (e.g. the login page itself). */
export const getOptionalProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return profile ?? null;
});
