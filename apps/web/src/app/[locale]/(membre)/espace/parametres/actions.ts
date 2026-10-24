"use server";

import { createSupabaseServer } from "@/lib/supabase/server";
import { type DeletionResult, deletionError, isChannel, isLocale, isPrivacyField, privacyColumns } from "./settings";

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

export type PhoneResult = "saved" | "removed" | "invalid_phone" | "phone_taken" | "failed";

/**
 * Téléphone facultatif (décision du 20 octobre 2026), non vérifié : app.set_phone contrôle le format
 * et l'unicité, et journalise. Valeur vide : numéro retiré.
 */
export async function savePhone(phone: string): Promise<PhoneResult> {
  const session = await memberId();
  if (!session || typeof phone !== "string") return "failed";
  const { error } = await session.supabase.rpc("set_phone", { p_phone: phone });
  if (!error) return phone.trim() ? "saved" : "removed";
  if (error.message === "invalid_phone" || error.message === "phone_taken") return error.message;
  return "failed";
}

/** Confidentialité (question 15) : réglage écrit sur la propre ligne du membre (RLS). */
export async function savePrivacy(field: string, enabled: boolean): Promise<boolean> {
  const session = await memberId();
  if (!session || !isPrivacyField(field) || typeof enabled !== "boolean") return false;
  const { error } = await session.supabase
    .from("member_profiles")
    .update({ [privacyColumns[field]]: enabled })
    .eq("user_id", session.id);
  return !error;
}

/**
 * Suppression du compte (question 17) : compte masqué tout de suite, effacé au bout de 30 jours,
 * annulable pendant ce délai. app.request_account_deletion refuse tant qu'une soirée à venir
 * n'est pas annulée, clôt découverte ou couple en cours (l'autre membre est prévenu) et journalise.
 */
export async function requestDeletion(): Promise<DeletionResult> {
  const session = await memberId();
  if (!session) return "failed";
  const { error } = await session.supabase.rpc("request_account_deletion");
  return error ? deletionError(error.message) : "requested";
}

export async function cancelDeletion(): Promise<DeletionResult> {
  const session = await memberId();
  if (!session) return "failed";
  const { error } = await session.supabase.rpc("cancel_account_deletion");
  return error ? deletionError(error.message) : "cancelled";
}
