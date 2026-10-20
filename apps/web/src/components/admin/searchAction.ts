"use server";

import { createSupabaseServer } from "@/lib/supabase/server";
import { SEARCH_MIN_LENGTH, type SearchHit } from "./search";

/**
 * Recherche globale de l'administration (app.admin_search), avec le jeton de la personne :
 * la base ne renvoie que les types que sa permission autorise.
 */
export async function adminSearch(query: string): Promise<{ ok: true; hits: SearchHit[] } | { ok: false; error: string }> {
  const q = query.trim().slice(0, 100);
  if (q.length < SEARCH_MIN_LENGTH) return { ok: true, hits: [] };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { data, error } = await supabase.rpc("admin_search", { p_query: q });
  if (error) return { ok: false, error: error.message };
  return { ok: true, hits: (data as SearchHit[] | null) ?? [] };
}
