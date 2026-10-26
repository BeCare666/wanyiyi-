import { PAGE_SIZE } from "@/app/[locale]/(admin)/admin/membres/members";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { SavedListFilter } from "./ListFilters";
import {
  formatListSort,
  isBuilderListFilter,
  type ListGroup,
  type ListNode,
  listFilterQuery,
  type ListSortKey,
  type ListSpec,
  parseListColumns,
  parseListSort,
} from "./listRules";

type SavedRow = { id: string; owner_id: string; name: string; shared: boolean; definition: unknown; sort: ListSortKey[] | null; columns: string[] | null };

/**
 * Une page d'une liste filtrée (app.admin_list, pagination côté serveur) et ses filtres
 * enregistrés. « error » : base absente ou refus ; la page affiche alors « indisponible ».
 */
export async function loadListPage<Row extends { total: number }>(
  spec: ListSpec,
  filter: ListNode | null,
  sort: readonly ListSortKey[],
  page: number,
  staffId: string,
): Promise<{ rows: Row[]; total: number; error: boolean; saved: SavedListFilter[] }> {
  const supabase = await createSupabaseServer();
  if (!supabase) return { rows: [], total: 0, error: true, saved: [] };
  const [result, savedResult] = await Promise.all([
    supabase.rpc("admin_list", {
      p_list: spec.list,
      p_filter: filter,
      p_sort: sort.length > 0 ? sort : null,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    }),
    supabase.from("saved_filters").select("id, owner_id, name, shared, definition, sort, columns").eq("resource", spec.list).order("name"),
  ]);
  const rows = (result.data ?? []) as Row[];
  const saved = ((savedResult.data ?? []) as SavedRow[]).map((s) => ({
    id: s.id,
    name: s.name,
    shared: s.shared,
    mine: s.owner_id === staffId,
    query: listFilterQuery(
      spec,
      {},
      isBuilderListFilter(spec, s.definition) && (s.definition as ListGroup).items.length > 0 ? (s.definition as ListGroup) : null,
      parseListSort(spec, formatListSort(s.sort ?? [])),
      parseListColumns(spec, (s.columns ?? []).join(",")),
    ),
  }));
  return { rows, total: rows[0]?.total ?? 0, error: Boolean(result.error), saved };
}

/** Lignes du fichier exporté (app.admin_list_export : 5 000 au plus, journalisé) ; null si refusé. */
export async function loadListExport<Row>(spec: ListSpec, filter: ListNode | null, sort: readonly ListSortKey[], format: "csv" | "xlsx") {
  const supabase = await createSupabaseServer();
  if (!supabase) return { rows: null, status: 503 };
  const { data, error } = await supabase.rpc("admin_list_export", {
    p_list: spec.list,
    p_filter: filter,
    p_sort: sort.length > 0 ? sort : null,
    p_format: format,
  });
  if (error) return { rows: null, status: error.message === "forbidden" ? 404 : 400 };
  return { rows: (data ?? []) as Row[], status: 200 };
}
