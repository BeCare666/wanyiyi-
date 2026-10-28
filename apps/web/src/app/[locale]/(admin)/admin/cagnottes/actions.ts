"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
import { checkPayout, checkSettings } from "./cagnottes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function call<T>(fn: string, args: Record<string, unknown>): Promise<ApiResult<T>> {
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : error.message };
  return { ok: true, data: data as T };
}

/**
 * Reversement fait à la main (Mobile Money, depuis le compte de l'équipe) : montant réellement
 * envoyé, frais FeexPay déduits, et référence de l'envoi. Journalisé par la base.
 */
export async function markPayoutPaid(payoutId: string, sent: string, reference: string, maxXof: number): Promise<ApiResult<void>> {
  if (!UUID.test(payoutId)) return { ok: false, error: "generic" };
  const invalid = checkPayout({ sent, reference }, maxXof);
  if (invalid) return { ok: false, error: invalid };
  return call<void>("admin_mark_payout_paid", { p_payout: payoutId, p_sent_xof: Number(sent.replace(/\s/g, "")), p_reference: reference.trim() });
}

/** Réglages des cagnottes : contribution minimale et commission Ifedele (figée à l'ouverture de chaque cagnotte). */
export async function saveCagnotteSettings(min: string, commission: string): Promise<ApiResult<void>> {
  const invalid = checkSettings({ min, commission });
  if (invalid) return { ok: false, error: invalid };
  return call<void>("admin_set_cagnotte_settings", {
    p_min_contribution_xof: Number(min.replace(/\s/g, "")),
    p_commission_percent: Number(commission.replace(",", ".")),
  });
}
