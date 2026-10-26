import { cotonouDay } from "@/app/[locale]/(admin)/admin/membres/filters";
import { type ExportFormat, exportFormats, toCsv, toXlsx } from "@/app/[locale]/(admin)/admin/membres/exporting";
import { getStaffMember, type StaffPermission } from "@/lib/staff";
import { loadListExport } from "./listPage";
import { type ListSpec, parseListState } from "./listRules";

type Table = Array<Array<string | number | null>>;

/**
 * Fichier exporté d'une liste (11.3) : CSV protégé contre les formules ou classeur Excel,
 * nommé <base>-AAAA-MM-JJ (jour de Cotonou), jamais mis en cache.
 */
export async function exportResponse(table: Table, format: ExportFormat, fileBase: string, sheetName: string) {
  const name = `${fileBase}-${cotonouDay(new Date())}.${format}`;
  const headers = { "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" };
  if (format === "csv") {
    return new Response(toCsv(table), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  }
  const buffer = await toXlsx(table, sheetName);
  return new Response(buffer, {
    headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
}

/**
 * Route d'export d'une liste sans filtres rapides : mêmes paramètres d'adresse que la liste
 * (?f=, ?tri=), plus ?format=csv|xlsx. La base applique la permission, la limite de 5 000 lignes
 * et journalise l'export ; `build` traduit les lignes en tableau.
 */
export async function listExport<Row>(
  request: Request,
  spec: ListSpec,
  permission: StaffPermission,
  build: (rows: Row[]) => Promise<{ table: Table; fileBase: string; sheetName: string }>,
) {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes(permission)) return new Response(null, { status: 404 });
  const search = Object.fromEntries(new URL(request.url).searchParams);
  const format = search.format as ExportFormat;
  if (!exportFormats.includes(format)) return new Response(null, { status: 400 });
  const { filter, sort } = parseListState(spec, search);
  const { rows, status } = await loadListExport<Row>(spec, filter, sort, format);
  if (!rows) return new Response(null, { status });
  const { table, fileBase, sheetName } = await build(rows);
  return exportResponse(table, format, fileBase, sheetName);
}
