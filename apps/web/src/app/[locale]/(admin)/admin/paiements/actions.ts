"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Remboursement fait à la main dans le tableau de bord FeexPay (décision du 22 octobre 2026) :
 * l'équipe le marque ici. Avec le jeton de la personne : la base contrôle la permission
 * payments.refund et journalise l'action à son nom.
 */
export async function markRefunded(paymentId: string): Promise<ApiResult<void>> {
  if (!UUID.test(paymentId)) return { ok: false, error: "generic" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("admin_mark_refunded", { p_payment: paymentId });
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}
