"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
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
