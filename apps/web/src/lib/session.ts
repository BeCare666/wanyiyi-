import { cache } from "react";
import { createSupabaseServer } from "@/lib/supabase/server";

/** Membre connecté, tel que l'affichent l'en-tête, la barre mobile et l'espace membre. */
export type SessionMember = {
  id: string;
  /** null tant que le profil n'est pas créé (inscription en cours) */
  firstName: string | null;
  /** Initiales du monogramme (section 6.1) : prénom et nom, jamais affichées aux autres membres */
  initials: string;
  darkMode: boolean;
};

/** Notification récente, pour la cloche de l'en-tête. */
export type SessionNotification = {
  id: string;
  kind: string;
  createdAt: string;
  read: boolean;
};

function initialsOf(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName]
    .map((part) => part?.trim().charAt(0).toLocaleUpperCase() ?? "")
    .join("");
}

/**
 * Membre connecté, ou null pour un visiteur (ou si le projet Supabase n'est pas configuré).
 * Lecture avec le jeton du membre : la RLS ne lui donne que ses propres lignes.
 * Mis en cache pour la durée d'une requête (en-tête et page lisent la même session).
 */
export const getSessionMember = cache(async (): Promise<SessionMember | null> => {
  const supabase = await createSupabaseServer();
  if (!supabase) return null;
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims.sub;
  if (!id) return null;

  const [{ data: profile }, { data: user }] = await Promise.all([
    supabase.from("member_profiles").select("first_name, last_name").eq("user_id", id).maybeSingle(),
    supabase.from("users").select("dark_mode").eq("id", id).maybeSingle(),
  ]);
  const firstName = (profile?.first_name as string | undefined) ?? null;
  return {
    id,
    firstName,
    initials: initialsOf(firstName, (profile?.last_name as string | undefined) ?? null),
    darkMode: Boolean(user?.dark_mode),
  };
});

/** Les dernières notifications du membre et le nombre de non lues. */
export async function getRecentNotifications(limit = 5): Promise<{ items: SessionNotification[]; unread: number }> {
  const supabase = await createSupabaseServer();
  if (!supabase) return { items: [], unread: 0 };
  const [{ data }, { count }] = await Promise.all([
    supabase.from("notifications").select("id, kind, created_at, read_at").order("created_at", { ascending: false }).limit(limit),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  return {
    items: (data ?? []).map((n) => ({ id: n.id, kind: n.kind, createdAt: n.created_at, read: n.read_at !== null })),
    unread: count ?? 0,
  };
}
