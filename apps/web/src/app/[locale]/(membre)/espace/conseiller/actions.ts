"use server";

import { type ApiResult, memberApi } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Conseiller sollicité seul (demande du 10 novembre 2026) : demande, annulation, fin de la
 * discussion, envoi et message payant. Toutes les règles sont revérifiées par la base.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<ApiResult<T>> {
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { data, error } = await supabase.rpc(fn, args);
  return error ? { ok: false, error: error.message } : { ok: true, data: data as T };
}

/** Texte d'un message : 1 à 2 000 caractères (la base refuse aussi liens, e-mails et numéros). */
function messageText(body: unknown): string | null {
  if (typeof body !== "string") return null;
  const text = body.trim();
  return text === "" || text.length > 2000 ? null : text;
}

export async function requestCounsel(): Promise<ApiResult<string>> {
  return call<string>("request_counsel");
}

export async function cancelCounsel(requestId: string): Promise<ApiResult<void>> {
  if (!UUID.test(requestId)) return { ok: false, error: "generic" };
  return call<void>("cancel_counsel_request", { p_request: requestId });
}

export async function closeCounsel(requestId: string): Promise<ApiResult<void>> {
  if (!UUID.test(requestId)) return { ok: false, error: "generic" };
  return call<void>("close_counsel", { p_request: requestId });
}

/** Envoi : gratuit dans la limite ; au-delà la base répond « payment_required ». */
export async function counselSend(conversationId: string, body: string): Promise<ApiResult<string>> {
  const text = messageText(body);
  if (!UUID.test(conversationId)) return { ok: false, error: "generic" };
  if (text === null) return { ok: false, error: "invalid_body" };
  return call<string>("send_message", { p_conversation: conversationId, p_body: text });
}

/** Message payant : l'API le prépare et renvoie l'adresse de paiement ; il est remis une fois payé. */
export async function payCounselMessage(conversationId: string, body: string): Promise<ApiResult<{ paymentId: string; checkoutUrl: string }>> {
  const text = messageText(body);
  if (!UUID.test(conversationId)) return { ok: false, error: "generic" };
  if (text === null) return { ok: false, error: "invalid_body" };
  return memberApi("/payments/counsel-message", { method: "POST", body: { conversationId, body: text } });
}
