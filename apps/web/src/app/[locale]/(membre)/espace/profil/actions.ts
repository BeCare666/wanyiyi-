"use server";

import { memberApi } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
import { canBeDealbreaker, checkAnswer, maxDealbreakers, type TextField, type TextResult, textFields, textMaxLength } from "./profile";

/** Écritures avec le jeton du membre : la RLS limite chaque ligne à son propre profil. */
async function memberSession() {
  const supabase = await createSupabaseServer();
  if (!supabase) return null;
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims.sub;
  return id ? { supabase, id } : null;
}

/**
 * Réponse d'une catégorie (enregistrement automatique) : valeurs contrôlées sur le catalogue,
 * ligne supprimée si plus rien n'est choisi. Une recherche vidée ou « Indifférent » ne peut plus
 * être un critère non négociable : il est retiré.
 */
export async function saveAnswer(side: string, category: string, values: unknown): Promise<boolean> {
  const checked = checkAnswer(side, category, values);
  const session = await memberSession();
  if (!checked || !session) return false;
  const { supabase, id } = session;
  const { error } =
    checked.length === 0
      ? await supabase.from("profile_answers").delete().eq("user_id", id).eq("side", side).eq("category", category)
      : await supabase
          .from("profile_answers")
          .upsert({ user_id: id, side, category, values: checked, updated_at: new Date().toISOString() }, { onConflict: "user_id,side,category" });
  if (error) return false;
  if (side === "seeking" && !canBeDealbreaker(checked)) {
    await supabase.from("dealbreakers").delete().eq("user_id", id).eq("category", category);
  }
  return true;
}

export type DealbreakerResult = "added" | "removed" | "too_many" | "failed";

/** Critère non négociable (au maximum 3, limite aussi imposée par la base). */
export async function setDealbreaker(category: string, on: boolean): Promise<DealbreakerResult> {
  const session = await memberSession();
  if (!session || typeof on !== "boolean" || !checkAnswer("seeking", category, [])) return "failed";
  const { supabase, id } = session;
  if (!on) {
    const { error } = await supabase.from("dealbreakers").delete().eq("user_id", id).eq("category", category);
    return error ? "failed" : "removed";
  }
  const { count } = await supabase.from("dealbreakers").select("category", { count: "exact", head: true }).eq("user_id", id);
  if ((count ?? 0) >= maxDealbreakers) return "too_many";
  const { error } = await supabase.from("dealbreakers").upsert({ user_id: id, category }, { onConflict: "user_id,category" });
  if (error) return error.code === "23514" ? "too_many" : "failed";
  return "added";
}

/**
 * Texte libre (section 8.1) : envoyé à l'API, qui bloque numéros, liens, adresses e-mail et pseudos
 * côté serveur, puis l'enregistre « en relecture ». Texte vidé : retiré du profil.
 */
export async function saveText(field: string, body: string): Promise<TextResult> {
  if (!textFields.includes(field as TextField) || typeof body !== "string") return "failed";
  const text = body.trim();
  if (text.length > textMaxLength) return "too_long";
  if (text === "") {
    const session = await memberSession();
    if (!session) return "failed";
    const { error } = await session.supabase.from("profile_texts").delete().eq("user_id", session.id).eq("field", field);
    return error ? "failed" : "removed";
  }
  const result = await memberApi<void>(`/profile/texts/${field}`, { method: "PUT", body: { body: text } });
  if (result.ok) return "saved";
  return result.error === "text_rejected" ? "text_rejected" : "failed";
}
