"use server";

import { createSupabaseServer } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Marque comme lues les notifications données, ou toutes (sans liste).
 * Fonction SQL appelée avec le jeton du membre : elle ne touche qu'à ses propres notifications.
 */
export async function markNotificationsRead(ids?: string[]): Promise<boolean> {
  if (ids && (ids.length === 0 || !ids.every((id) => UUID.test(id)))) return false;
  const supabase = await createSupabaseServer();
  if (!supabase) return false;
  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: ids ?? null });
  return !error;
}
