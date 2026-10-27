import { getLocale } from "next-intl/server";
import { cache } from "react";
import { teamMessage } from "@/components/member/notificationKinds";
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
  /** Motif écrit par l'équipe (suspension, exclusion), affiché au membre. */
  reason: string | null;
  /** Message de l'équipe (action groupée), dans la langue affichée. */
  message: string | null;
  /** Conseiller qui signe le message (départ d'un membre du couple, question 7). */
  signedBy: string | null;
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

/** Les dernières notifications du membre (toutes, ou non lues seulement) et le nombre de non lues. */
export async function getRecentNotifications(
  limit = 5,
  { unreadOnly = false }: { unreadOnly?: boolean } = {},
): Promise<{ items: SessionNotification[]; unread: number }> {
  const supabase = await createSupabaseServer();
  if (!supabase) return { items: [], unread: 0 };
  let list = supabase.from("notifications").select("id, kind, created_at, read_at, payload");
  if (unreadOnly) list = list.is("read_at", null);
  const [{ data }, { count }, locale] = await Promise.all([
    list.order("created_at", { ascending: false }).limit(limit),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    getLocale(),
  ]);
  return {
    items: (data ?? []).map((n) => ({
      id: n.id,
      kind: n.kind,
      createdAt: n.created_at,
      read: n.read_at !== null,
      reason: typeof n.payload?.reason === "string" ? n.payload.reason : null,
      message: teamMessage(n.payload, locale),
      signedBy: typeof n.payload?.counselor === "string" ? n.payload.counselor : null,
    })),
    unread: count ?? 0,
  };
}
