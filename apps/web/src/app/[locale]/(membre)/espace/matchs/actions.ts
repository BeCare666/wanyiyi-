"use server";

import { type ApiResult, memberApi } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
import { cotonouToIso } from "../couple/couple";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Appel d'une fonction de la base avec le jeton du membre : toutes les règles y sont revérifiées. */
async function call<T>(fn: string, args: Record<string, unknown>): Promise<ApiResult<T>> {
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { data, error } = await supabase.rpc(fn, args);
  return error ? { ok: false, error: error.message } : { ok: true, data: data as T };
}

/** Choisir d'ouvrir une découverte (9.4, question 2) ; elle s'ouvre si l'autre l'a aussi choisie. */
export async function chooseMatch(matchId: string): Promise<ApiResult<string | null>> {
  if (!UUID.test(matchId)) return { ok: false, error: "generic" };
  return call<string | null>("choose_match", { p_match: matchId });
}

/**
 * « Je veux continuer » et « Prolonger » : chacun pour soi ; l'effet n'a lieu que si les deux
 * l'ont demandé (couple, ou 7 jours de plus une seule fois).
 */
export async function decideDiscovery(discoveryId: string, wantsToContinue: boolean, wantsExtension: boolean): Promise<ApiResult<string>> {
  if (!UUID.test(discoveryId) || typeof wantsToContinue !== "boolean" || typeof wantsExtension !== "boolean") {
    return { ok: false, error: "generic" };
  }
  return call<string>("decide_discovery", { p_discovery: discoveryId, p_continue: wantsToContinue, p_extension: wantsExtension });
}

/** Message dans une conversation (texte seulement ; liens, e-mails et numéros refusés par la base). */
export async function sendMessage(conversationId: string, body: string): Promise<ApiResult<string>> {
  if (!UUID.test(conversationId) || typeof body !== "string") return { ok: false, error: "generic" };
  const text = body.trim();
  if (text === "" || text.length > 2000) return { ok: false, error: "invalid_body" };
  return call<string>("send_message", { p_conversation: conversationId, p_body: text });
}

/** Lien de 5 minutes vers une photo de l'autre personne, filigranée au nom du membre (l'API vérifie le match). */
export async function partnerPhotoLink(photoId: string): Promise<ApiResult<{ url: string }>> {
  if (!UUID.test(photoId)) return { ok: false, error: "generic" };
  const result = await memberApi<{ path: string }>(`/photos/${photoId}/link`, { method: "POST" });
  if (!result.ok) return result;
  return { ok: true, data: { url: `${process.env.NEXT_PUBLIC_API_URL}${result.data.path}` } };
}

/** Rendez-vous déclaré pendant la découverte (question 5) : « Bien rentré(e) ? » 3 heures après. */
export async function declareDiscoveryDate(discoveryId: string, localDateTime: string): Promise<ApiResult<string>> {
  if (!UUID.test(discoveryId) || typeof localDateTime !== "string") return { ok: false, error: "generic" };
  const at = cotonouToIso(localDateTime);
  if (!at) return { ok: false, error: "invalid_date" };
  return call<string>("declare_discovery_date", { p_discovery: discoveryId, p_date_at: at });
}

const reportReasons = ["disrespect", "money", "fake_profile", "sexual", "threat", "other"];

/**
 * Signalement d'un message ou de toute la conversation (question 11) : la base vérifie que le
 * membre en fait partie ; la personne signalée n'est pas prévenue.
 */
export async function reportConversation(conversationId: string, messageId: string | null, reason: string, details: string): Promise<ApiResult<string>> {
  if (!UUID.test(conversationId) || (messageId !== null && !UUID.test(messageId)) || !reportReasons.includes(reason) || typeof details !== "string") {
    return { ok: false, error: "generic" };
  }
  if (details.length > 1000) return { ok: false, error: "details_too_long" };
  return call<string>("report_conversation", { p_conversation: conversationId, p_message: messageId, p_reason: reason, p_details: details.trim() || null });
}
