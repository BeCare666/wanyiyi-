import { cache } from "react";
import { getSessionMember, type SessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";

/** Rôles de l'équipe qui ont accès à l'administration (9.1). Le conseiller a son propre espace (7). */
export const staffRoles = ["moderator", "admin", "super_admin"] as const;
export type StaffRole = (typeof staffRoles)[number];

/** Permissions fines utilisées par l'administration (table app.role_permissions). */
export const staffPermissions = ["verifications.review", "members.manage", "profile_texts.review", "events.manage", "payments.read", "payments.refund", "roles.manage"] as const;
export type StaffPermission = (typeof staffPermissions)[number];

export type StaffMember = SessionMember & { role: StaffRole; permissions: StaffPermission[] };

export function isStaffRole(role: unknown): role is StaffRole {
  return staffRoles.some((r) => r === role);
}

/**
 * Personne de l'équipe connectée, ou null (visiteur, membre, conseiller).
 * Rôle et permissions sont lus dans la base avec son jeton : l'affichage du menu en dépend,
 * mais chaque action reste contrôlée par la base (RLS et fonctions).
 */
export const getStaffMember = cache(async (): Promise<StaffMember | null> => {
  const member = await getSessionMember();
  const supabase = await createSupabaseServer();
  if (!member || !supabase) return null;
  const { data: user } = await supabase.from("users").select("role").eq("id", member.id).maybeSingle();
  const role: unknown = user?.role;
  if (!isStaffRole(role)) return null;
  const checks = await Promise.all(
    staffPermissions.map(async (permission) => {
      const { data } = await supabase.rpc("has_permission", { p_permission: permission });
      return data === true ? permission : null;
    }),
  );
  return { ...member, role, permissions: checks.filter((p): p is StaffPermission => p !== null) };
});
