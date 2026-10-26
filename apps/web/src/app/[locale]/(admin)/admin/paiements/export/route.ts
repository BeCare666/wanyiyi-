import { getFormatter, getTranslations } from "next-intl/server";
import { combineListFilters, parseListState, paymentsSpec } from "@/components/admin/listRules";
import { loadListExport } from "@/components/admin/listPage";
import { getStaffMember } from "@/lib/staff";
import { type ExportFormat, exportFormats, toCsv, toXlsx } from "../../membres/exporting";
import { cotonouDay } from "../../membres/filters";
import { parsePaymentQuery, paymentConditions, paymentExportCell, paymentExportColumns, type PaymentRow, providerKey } from "../payments";

type Context = { params: Promise<{ locale: string }> };

/**
 * Export CSV ou Excel des paiements filtrés (section 11.3) : mêmes paramètres d'adresse que la
 * liste, plus ?format=csv|xlsx. La base applique la permission, la limite de 5 000 lignes et
 * journalise l'export (payments.exported).
 */
export async function GET(request: Request, { params }: Context) {
  const { locale } = await params;
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("payments.read")) return new Response(null, { status: 404 });

  const search = Object.fromEntries(new URL(request.url).searchParams);
  const format = search.format as ExportFormat;
  if (!exportFormats.includes(format)) return new Response(null, { status: 400 });
  const { filter, sort } = parseListState(paymentsSpec, search);
  const { rows, status } = await loadListExport<PaymentRow>(paymentsSpec, combineListFilters(paymentConditions(parsePaymentQuery(search)), filter), sort, format);
  if (!rows) return new Response(null, { status });

  const t = await getTranslations({ locale, namespace: "Admin" });
  const dates = await getFormatter({ locale });
  const labels = {
    purpose: (p: string) => t(`payments.purposes.${p}`),
    status: (s: string) => t(`payments.status.${s}`),
    provider: (p: string) => t(`payments.providers.${providerKey(p)}`),
    date: (iso: string) => dates.dateTime(new Date(iso), { year: "numeric", month: "2-digit", day: "2-digit" }),
  };
  const table = [
    paymentExportColumns.map((c) => t(`lists.payments.export.${c}`)),
    ...rows.map((row) => paymentExportColumns.map((c) => paymentExportCell(row, c, labels))),
  ];
  const name = `paiements-${cotonouDay(new Date())}.${format}`;
  const headers = { "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" };

  if (format === "csv") {
    return new Response(toCsv(table), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  }
  const buffer = await toXlsx(table, t("nav.payments"));
  return new Response(buffer, {
    headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
}
