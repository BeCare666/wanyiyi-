"use server";

import { type ApiResult, memberApi } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TextDecision = "approved" | "rejected";

/**
 * Décision sur un texte de profil (question 22) : approuvé, ou refusé avec un motif notifié au
 * membre. Avec le jeton de la personne : la base contrôle la permission profile_texts.review,
 * exige le motif d'un refus et journalise la décision.
 */
export async function reviewText(textId: string, decision: TextDecision, note: string): Promise<ApiResult<void>> {
  if (!UUID.test(textId) || (decision !== "approved" && decision !== "rejected")) return { ok: false, error: "generic" };
  if (decision === "rejected" && note.trim() === "") return { ok: false, error: "note_required" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("review_profile_text", {
    p_text: textId,
    p_status: decision,
    p_note: decision === "rejected" ? note.trim().slice(0, 1000) : null,
  });
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}

/** Décision sur une photo (phase 3, question 10) : mêmes règles que les textes (app.review_photo). */
export async function reviewPhoto(photoId: string, decision: TextDecision, note: string): Promise<ApiResult<void>> {
  return decidePhoto("review_photo", photoId, decision, note);
}

/** Décision sur une photo de l'union (espace souvenir, phase 4, question 1 a) : mêmes règles. */
export async function reviewUnionPhoto(photoId: string, decision: TextDecision, note: string): Promise<ApiResult<void>> {
  return decidePhoto("review_union_photo", photoId, decision, note);
}

async function decidePhoto(fn: "review_photo" | "review_union_photo", photoId: string, decision: TextDecision, note: string): Promise<ApiResult<void>> {
  if (!UUID.test(photoId) || (decision !== "approved" && decision !== "rejected")) return { ok: false, error: "generic" };
  if (decision === "rejected" && note.trim() === "") return { ok: false, error: "note_required" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc(fn, {
    p_photo: photoId,
    p_approve: decision === "approved",
    p_note: decision === "rejected" ? note.trim().slice(0, 1000) : null,
  });
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}

/**
 * Lien de 5 minutes vers la photo filigranée au nom de la personne qui relit (API, avec son
 * jeton) ; la consultation est journalisée par la base.
 */
export async function photoLink(photoId: string, union = false): Promise<ApiResult<{ url: string }>> {
  if (!UUID.test(photoId)) return { ok: false, error: "generic" };
  const result = await memberApi<{ path: string }>(union ? `/photos/union/${photoId}/link` : `/photos/${photoId}/link`, { method: "POST" });
  if (!result.ok) return result;
  return { ok: true, data: { url: `${process.env.NEXT_PUBLIC_API_URL}${result.data.path}` } };
}
