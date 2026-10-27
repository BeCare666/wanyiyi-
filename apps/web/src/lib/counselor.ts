import { cache } from "react";
import { getSessionMember, type SessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";

export type CounselorMember = SessionMember & { displayName: string };

/**
 * Conseiller connecté (section 7), ou null : rôle « counselor » et fiche de conseiller créée par
 * l'administration. Lu avec son jeton ; chaque action reste contrôlée par la base.
 */
export const getCounselor = cache(async (): Promise<CounselorMember | null> => {
  const member = await getSessionMember();
  const supabase = await createSupabaseServer();
  if (!member || !supabase) return null;
  const [{ data: user }, { data: counselor }] = await Promise.all([
    supabase.from("users").select("role").eq("id", member.id).maybeSingle(),
    supabase.from("counselors").select("display_name").eq("user_id", member.id).maybeSingle(),
  ]);
  if (user?.role !== "counselor" || !counselor) return null;
  return { ...member, displayName: counselor.display_name as string };
});
