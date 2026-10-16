"use server";

import { createSupabaseServer } from "@/lib/supabase/server";
import { isChannel, isLocale } from "./settings";

/**
 * Enregistrement des paramètres avec le jeton du membre : la RLS limite chaque écriture
 * à sa propre ligne, et le déclencheur users_protect refuse toute autre colonne sensible.
 */
async function memberId() {
  const supabase = await createSupabaseServer();
  if (!supabase) return null;
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims.sub;
  return id ? { supabase, id } : null;
}

/** Langue mémorisée sur le profil (section 4 de la note : « choix mémorisé sur le profil »). */
export async function saveLocale(locale: string): Promise<boolean> {
  const session = await memberId();
  if (!session || !isLocale(locale)) return false;
  const { error } = await session.supabase.from("users").update({ locale }).eq("id", session.id);
  return !error;
}

export async function saveDarkMode(darkMode: boolean): Promise<boolean> {
  const session = await memberId();
  if (!session || typeof darkMode !== "boolean") return false;
  const { error } = await session.supabase.from("users").update({ dark_mode: darkMode }).eq("id", session.id);
  return !error;
}

export async function saveChannel(channel: string, enabled: boolean): Promise<boolean> {
  const session = await memberId();
  if (!session || !isChannel(channel) || typeof enabled !== "boolean") return false;
  const { error } = await session.supabase
    .from("notification_preferences")
    .upsert({ user_id: session.id, channel, enabled }, { onConflict: "user_id,channel" });
  return !error;
}
