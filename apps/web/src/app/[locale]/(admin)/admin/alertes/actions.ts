"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Alerte « Bien rentré(e) ? » marquée traitée (permission couples.manage, journalisé par la base). */
export async function handleAlert(checkinId: string, userId: string): Promise<ApiResult<void>> {
  if (!UUID.test(checkinId) || !UUID.test(userId)) return { ok: false, error: "generic" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("admin_handle_safety_alert", { p_checkin: checkinId, p_user: userId });
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}
