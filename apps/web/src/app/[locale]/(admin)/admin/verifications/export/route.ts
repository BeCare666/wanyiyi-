import { getFormatter, getTranslations } from "next-intl/server";
import { combineListFilters, parseListState, verificationsSpec } from "@/components/admin/listRules";
import { loadListExport } from "@/components/admin/listPage";
import { getStaffMember } from "@/lib/staff";
import { type ExportFormat, exportFormats, toCsv, toXlsx } from "../../membres/exporting";
import { cotonouDay } from "../../membres/filters";
import { parseQueueFilter, queueConditions, verificationExportCell, verificationExportColumns, type VerificationListRow } from "../queue";

type Context = { params: Promise<{ locale: string }> };

/**
 * Export CSV ou Excel des dossiers de vérification filtrés (section 11.3) : mêmes paramètres
 * d'adresse que la liste, plus ?format=csv|xlsx. Aucun chemin de pièce ; la base applique la
 * permission, la limite de 5 000 lignes et journalise l'export (verifications.exported).
 */
export async function GET(request: Request, { params }: Context) {
  const { locale } = await params;
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("verifications.review")) return new Response(null, { status: 404 });

  const search = Object.fromEntries(new URL(request.url).searchParams);
  const format = search.format as ExportFormat;
  if (!exportFormats.includes(format)) return new Response(null, { status: 400 });
  const { filter, sort } = parseListState(verificationsSpec, search);
  const listFilter = combineListFilters(queueConditions(parseQueueFilter(search.etat)), filter);
  const { rows, status } = await loadListExport<VerificationListRow>(verificationsSpec, listFilter, sort, format);
  if (!rows) return new Response(null, { status });

  const t = await getTranslations({ locale, namespace: "Admin" });
  const dates = await getFormatter({ locale });
  const labels = {
    status: (s: string) => t(`verifications.status.${s}`),
    sex: (s: string) => t(`verifications.identity.sexes.${s}`),
    kind: (k: string) => t(`verifications.kinds.${k}`),
    declared: (d: string) => t(`lists.declared.${d}`),
    yesNo: (b: boolean) => t(b ? "members.advanced.yes" : "members.advanced.no"),
    date: (iso: string) => dates.dateTime(new Date(iso), { year: "numeric", month: "2-digit", day: "2-digit" }),
  };
  const table = [
    verificationExportColumns.map((c) => t(`lists.verifications.export.${c}`)),
    ...rows.map((row) => verificationExportColumns.map((c) => verificationExportCell(row, c, labels))),
  ];
  const name = `verifications-${cotonouDay(new Date())}.${format}`;
  const headers = { "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" };

  if (format === "csv") {
    return new Response(toCsv(table), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  }
  const buffer = await toXlsx(table, t("nav.verifications"));
  return new Response(buffer, {
    headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
}
