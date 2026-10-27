"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Réponse à « Bien rentré(e) ? » (question 5) : « ok » ou « help ». L'aide alerte aussitôt
 * l'équipe (et le conseiller du couple) ; l'autre personne ne voit jamais la réponse.
 */
export async function answerCheckin(checkinId: string, answer: "ok" | "help"): Promise<ApiResult<void>> {
  if (!UUID.test(checkinId) || (answer !== "ok" && answer !== "help")) return { ok: false, error: "generic" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("answer_checkin", { p_checkin: checkinId, p_answer: answer });
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}
