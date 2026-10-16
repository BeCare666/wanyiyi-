"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

/** Déconnexion (tiroir mobile et barre latérale), puis retour à l'accueil. */
export async function signOut() {
  const supabase = await createSupabaseServer();
  await supabase?.auth.signOut();
  redirect({ href: "/", locale: await getLocale() });
}
