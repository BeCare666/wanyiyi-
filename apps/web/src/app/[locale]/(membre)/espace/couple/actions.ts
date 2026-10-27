"use server";

import { type ApiResult, memberApi } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
import { cotonouToIso } from "./couple";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Appel d'une fonction de la base avec le jeton du membre : toutes les règles y sont revérifiées. */
async function call<T>(fn: string, args: Record<string, unknown>): Promise<ApiResult<T>> {
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { data, error } = await supabase.rpc(fn, args);
  return error ? { ok: false, error: error.message } : { ok: true, data: data as T };
}

/**
 * Décision à deux (question 7) : reprendre après une pause, déclarer l'union, demander la
 * séparation, garder la conversation après l'union. « recorded » tant que l'autre ne l'a pas faite.
 */
export async function decideCouple(coupleId: string, kind: "resume" | "union" | "separation" | "keep_chat"): Promise<ApiResult<string>> {
  if (!UUID.test(coupleId) || !["resume", "union", "separation", "keep_chat"].includes(kind)) return { ok: false, error: "generic" };
  return call<string>("couple_decide", { p_couple: coupleId, p_kind: kind });
}

/** Départ d'un seul, à tout moment et sans justification : fin immédiate du couple. */
export async function leaveCouple(coupleId: string): Promise<ApiResult<void>> {
  if (!UUID.test(coupleId)) return { ok: false, error: "generic" };
  return call<void>("leave_couple", { p_couple: coupleId });
}

/** « Partager mon numéro » : effectif seulement quand les deux ont cliqué (9.5). */
export async function sharePhone(coupleId: string): Promise<ApiResult<boolean>> {
  if (!UUID.test(coupleId)) return { ok: false, error: "generic" };
  return call<boolean>("share_my_phone", { p_couple: coupleId });
}

/** Rendez-vous déclaré : date et heure saisies (« AAAA-MM-JJTHH:MM ») à l'heure de Cotonou. */
export async function declareDate(coupleId: string, localDateTime: string): Promise<ApiResult<string>> {
  if (!UUID.test(coupleId) || typeof localDateTime !== "string") return { ok: false, error: "generic" };
  const at = cotonouToIso(localDateTime);
  if (!at) return { ok: false, error: "invalid_date" };
  return call<string>("declare_date", { p_couple: coupleId, p_date_at: at });
}

/** Inviter un conseiller (question 9) ; l'autre est prévenu dans la conversation. */
export async function inviteCounselor(coupleId: string, includeHistory: boolean): Promise<ApiResult<string>> {
  if (!UUID.test(coupleId) || typeof includeHistory !== "boolean") return { ok: false, error: "generic" };
  return call<string>("request_counselor_access", { p_couple: coupleId, p_include_history: includeHistory });
}

/** Réponse à l'invitation de l'autre ; l'historique n'est montré que si les deux l'acceptent. */
export async function answerCounselor(accessId: string, accept: boolean, includeHistory: boolean): Promise<ApiResult<string>> {
  if (!UUID.test(accessId) || typeof accept !== "boolean" || typeof includeHistory !== "boolean") return { ok: false, error: "generic" };
  return call<string>("answer_counselor_access", { p_access: accessId, p_accept: accept, p_include_history: includeHistory });
}

/** Retrait du conseiller (ou de l'invitation en cours) par l'un ou l'autre, effet immédiat. */
export async function revokeCounselor(accessId: string): Promise<ApiResult<void>> {
  if (!UUID.test(accessId)) return { ok: false, error: "generic" };
  return call<void>("revoke_counselor_access", { p_access: accessId });
}

/** Paiement de l'accès au conseiller par celui qui a invité : l'API renvoie l'adresse de paiement. */
export async function payCounselor(accessId: string): Promise<ApiResult<{ paymentId: string; checkoutUrl: string }>> {
  if (!UUID.test(accessId)) return { ok: false, error: "generic" };
  return memberApi(`/payments/counselor-access/${accessId}`, { method: "POST" });
}
