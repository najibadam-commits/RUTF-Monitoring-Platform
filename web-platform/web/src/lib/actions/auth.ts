"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";

export type AuthActionState = { error?: string } | undefined;

export async function login(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  if (!email || !password) {
    return { error: "Enter both email and password." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { error: "Invalid email or password." };
  }

  const { data: profile } = await supabase.from("profiles").select("status").eq("id", data.user.id).single();
  if (profile?.status === "inactive") {
    await supabase.auth.signOut();
    return { error: "This account has been deactivated. Contact your administrator." };
  }

  await supabase.from("profiles").update({ last_login: new Date().toISOString() }).eq("id", data.user.id);

  redirect(next.startsWith("/") ? next : "/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email address." };

  const supabase = await createClient();
  const origin = (await headers()).get("origin");
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/auth/update-password`,
  });

  // Always return the same message regardless of whether the email exists,
  // so this endpoint can't be used to enumerate registered accounts.
  if (error) {
    return { error: "Something went wrong. Please try again." };
  }
  return { error: undefined };
}

export async function updatePassword(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < MIN_PASSWORD_LENGTH) return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  if (password !== confirm) return { error: "Passwords do not match." };

  const supabase = await createClient();

  // This page only ever gets here via an invite/recovery link's session (see /auth/confirm) —
  // there's no session at all if that link was expired, already used, or opened directly without
  // going through it. Without this check, updateUser's own "Auth session missing" error would
  // leak straight to the user instead of the same clear message /auth/confirm's own expired-link
  // redirect uses.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "This link has expired or has already been used. Please request a new invitation or password reset link." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  // Land the user back on Login to sign in normally with the password they just set, rather
  // than silently continuing on the one-time invite/recovery session — matches the requested
  // invitation flow (Password Saved → Login → Dashboard).
  await supabase.auth.signOut();
  redirect("/login?message=password-set");
}
