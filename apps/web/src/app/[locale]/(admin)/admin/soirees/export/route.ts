import { getFormatter, getTranslations } from "next-intl/server";
import { combineListFilters, eventsSpec, parseListState } from "@/components/admin/listRules";
import { loadListExport } from "@/components/admin/listPage";
import { getStaffMember } from "@/lib/staff";
import { type ExportFormat, exportFormats, toCsv, toXlsx } from "../../membres/exporting";
import { cotonouDay } from "../../membres/filters";
import { type AdminEventRow, eventConditions, eventExportCell, eventExportColumns, parseEventFilter } from "../evenings";

type Context = { params: Promise<{ locale: string }> };

/**
 * Export CSV ou Excel des soirées filtrées (section 11.3) : mêmes paramètres d'adresse que la
 * liste, plus ?format=csv|xlsx. La base applique la permission, la limite de 5 000 lignes et
 * journalise l'export (events.exported).
 */
export async function GET(request: Request, { params }: Context) {
  const { locale } = await params;
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("events.manage")) return new Response(null, { status: 404 });

  const search = Object.fromEntries(new URL(request.url).searchParams);
  const format = search.format as ExportFormat;
  if (!exportFormats.includes(format)) return new Response(null, { status: 400 });
  const { filter, sort } = parseListState(eventsSpec, search);
  const listFilter = combineListFilters(eventConditions(parseEventFilter(search.etat)), filter);
  const { rows, status } = await loadListExport<AdminEventRow>(eventsSpec, listFilter, sort, format);
  if (!rows) return new Response(null, { status });

  const t = await getTranslations({ locale, namespace: "Admin" });
  const dates = await getFormatter({ locale });
  const labels = {
    status: (s: string) => t(`evenings.status.${s}`),
    date: (iso: string) => dates.dateTime(new Date(iso), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
  };
  const table = [
    eventExportColumns.map((c) => t(`lists.events.export.${c}`)),
    ...rows.map((row) => eventExportColumns.map((c) => eventExportCell(row, c, labels))),
  ];
  const name = `soirees-${cotonouDay(new Date())}.${format}`;
  const headers = { "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" };

  if (format === "csv") {
    return new Response(toCsv(table), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  }
  const buffer = await toXlsx(table, t("nav.evenings"));
  return new Response(buffer, {
    headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
}
