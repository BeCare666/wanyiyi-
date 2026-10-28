"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** « J'ai contacté ce prestataire » : compté une fois par membre, couple ou union seulement (revérifié par la base). */
export async function markContacted(providerId: string): Promise<ApiResult<void>> {
  if (!UUID.test(providerId)) return { ok: false, error: "generic" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("mark_provider_contacted", { p_provider: providerId });
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}
