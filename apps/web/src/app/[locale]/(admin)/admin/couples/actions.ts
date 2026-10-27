"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function call(fn: string, args: Record<string, unknown>): Promise<ApiResult<void>> {
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc(fn, args);
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}

/**
 * Blocage d'un couple par l'administration (question 9, réponse du 26 octobre 2026) : chat en
 * lecture seule, conseiller retiré, motif obligatoire notifié aux deux. Permission couples.manage,
 * contrôlée par la base, qui journalise.
 */
export async function blockCouple(coupleId: string, reason: string): Promise<ApiResult<void>> {
  if (!UUID.test(coupleId)) return { ok: false, error: "generic" };
  if (reason.trim() === "") return { ok: false, error: "reason_required" };
  return call("admin_block_couple", { p_couple: coupleId, p_reason: reason.trim().slice(0, 1000) });
}

/** Levée du blocage : le chat redevient ouvert ; le conseiller n'est pas rétabli d'office. */
export async function unblockCouple(coupleId: string): Promise<ApiResult<void>> {
  if (!UUID.test(coupleId)) return { ok: false, error: "generic" };
  return call("admin_unblock_couple", { p_couple: coupleId });
}

export type AdminCounselorNote = { id: string; counselor_name: string | null; body: string; created_at: string };

/**
 * Notes privées du conseiller sur un couple (question 18) : lues par l'administration seulement en
 * cas de litige ou de signalement ; chaque lecture est journalisée par la base (couples.manage).
 */
export async function readCounselorNotes(coupleId: string): Promise<ApiResult<AdminCounselorNote[]>> {
  if (!UUID.test(coupleId)) return { ok: false, error: "generic" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { data, error } = await supabase.rpc("admin_counselor_notes", { p_couple: coupleId });
  return error ? { ok: false, error: error.message } : { ok: true, data: (data ?? []) as AdminCounselorNote[] };
}
