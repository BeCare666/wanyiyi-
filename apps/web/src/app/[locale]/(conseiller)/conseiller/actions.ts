"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
import { cotonouToIso } from "@/app/[locale]/(membre)/espace/couple/couple";
import { noteBody } from "./counselor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Appel d'une fonction de la base avec le jeton du conseiller : l'accès au couple y est revérifié. */
async function call<T>(fn: string, args: Record<string, unknown>): Promise<ApiResult<T>> {
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { data, error } = await supabase.rpc(fn, args);
  return error ? { ok: false, error: error.message } : { ok: true, data: data as T };
}

/** Message du conseiller dans la conversation du couple (mêmes règles que pour les membres). */
export async function counselorSend(conversationId: string, body: string): Promise<ApiResult<string>> {
  if (!UUID.test(conversationId) || typeof body !== "string") return { ok: false, error: "generic" };
  const text = body.trim();
  if (text === "" || text.length > 2000) return { ok: false, error: "invalid_body" };
  return call<string>("send_message", { p_conversation: conversationId, p_body: text });
}

/** Note privée sur un couple suivi : jamais visible par les membres. */
export async function addNote(coupleId: string, body: string): Promise<ApiResult<string>> {
  const text = noteBody(body);
  if (!UUID.test(coupleId)) return { ok: false, error: "generic" };
  if (text === null) return { ok: false, error: "invalid_body" };
  return call<string>("add_counselor_note", { p_couple: coupleId, p_body: text });
}

/** Proposition d'une séance (question 9) : date future à l'heure de Cotonou, en ligne ou dans un lieu. */
export async function proposeSession(coupleId: string, localDateTime: string, mode: "online" | "place", location: string): Promise<ApiResult<string>> {
  if (!UUID.test(coupleId) || (mode !== "online" && mode !== "place") || typeof location !== "string") return { ok: false, error: "generic" };
  const at = cotonouToIso(localDateTime);
  if (!at) return { ok: false, error: "invalid_date" };
  return call<string>("propose_session", { p_couple: coupleId, p_at: at, p_mode: mode, p_location: location.trim() || null });
}

/** Annulation d'une séance proposée ou confirmée. */
export async function cancelSession(sessionId: string): Promise<ApiResult<void>> {
  if (!UUID.test(sessionId)) return { ok: false, error: "generic" };
  return call<void>("cancel_session", { p_session: sessionId });
}

/** Séance faite (confirmée, heure passée) : la première franchit l'étape « Séances avec le conseiller ». */
export async function completeSession(sessionId: string): Promise<ApiResult<void>> {
  if (!UUID.test(sessionId)) return { ok: false, error: "generic" };
  return call<void>("complete_session", { p_session: sessionId });
}
