"use server";

import { createSupabaseServer } from "@/lib/supabase/server";
import { isPushSubscription, type PushSubscriptionInput } from "./pushSupport";

/**
 * Abonnement de l'appareil aux notifications sur le téléphone (04/11/2026), avec le jeton du
 * membre : la base rattache l'appareil au membre connecté et à lui seul.
 */
export async function savePushSubscription(input: PushSubscriptionInput): Promise<boolean> {
  if (!isPushSubscription(input)) return false;
  const supabase = await createSupabaseServer();
  if (!supabase) return false;
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: input.endpoint,
    p_p256dh: input.p256dh,
    p_auth: input.auth,
    p_user_agent: input.userAgent?.slice(0, 300) ?? null,
  });
  return !error;
}

export async function removePushSubscription(endpoint: string): Promise<boolean> {
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) return false;
  const supabase = await createSupabaseServer();
  if (!supabase) return false;
  const { error } = await supabase.rpc("remove_push_subscription", { p_endpoint: endpoint });
  return !error;
}
