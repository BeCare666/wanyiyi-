"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
import {
  formatListSort,
  isBuilderListFilter,
  type ListGroup,
  type ListName,
  listSpecs,
  type ListSortKey,
  parseListColumns,
  parseListSort,
} from "./listRules";

/**
 * Enregistrement du filtre courant d'une liste (11.3), personnel ou partagé avec l'équipe.
 * La base contrôle à nouveau le filtre, le tri, les colonnes et la permission de la liste
 * (app.check_saved_filter, politiques de app.saved_filters). La suppression est celle des membres.
 */
export async function saveListFilter(
  list: ListName,
  input: { name: string; shared: boolean; definition: ListGroup; sort: ListSortKey[]; columns: string[] },
): Promise<ApiResult<{ id: string }>> {
  const spec = listSpecs[list];
  if (!spec) return { ok: false, error: "generic" };
  const name = input.name.trim();
  if (name === "" || name.length > 80) return { ok: false, error: "name_required" };
  if (!isBuilderListFilter(spec, input.definition)) return { ok: false, error: "invalid_filter" };
  // Tri et colonnes ramenés aux valeurs permises
  const sort = parseListSort(spec, formatListSort(input.sort));
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "forbidden" };
  const { data, error } = await supabase
    .from("saved_filters")
    .insert({
      owner_id: auth.user.id,
      resource: list,
      name,
      definition: input.definition,
      sort: sort.length > 0 ? sort : null,
      columns: parseListColumns(spec, input.columns.join(",")),
      shared: input.shared,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { id: data.id as string } };
}
