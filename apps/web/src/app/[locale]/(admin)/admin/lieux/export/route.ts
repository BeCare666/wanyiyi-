import { getFormatter, getTranslations } from "next-intl/server";
import { listExport } from "@/components/admin/listExport";
import { venuesSpec } from "@/components/admin/listRules";
import { venueExportCell, venueExportColumns, type VenueListRow } from "../venues";

type Context = { params: Promise<{ locale: string }> };

/** Export CSV ou Excel des lieux filtrés (11.3), journalisé par la base (venues.exported). */
export async function GET(request: Request, { params }: Context) {
  const { locale } = await params;
  return listExport<VenueListRow>(request, venuesSpec, "events.manage", async (rows) => {
    const t = await getTranslations({ locale, namespace: "Admin" });
    const dates = await getFormatter({ locale });
    const labels = {
      yesNo: (b: boolean) => t(b ? "members.advanced.yes" : "members.advanced.no"),
      date: (iso: string) => dates.dateTime(new Date(iso), { year: "numeric", month: "2-digit", day: "2-digit" }),
    };
    return {
      table: [venueExportColumns.map((c) => t(`lists.venues.export.${c}`)), ...rows.map((row) => venueExportColumns.map((c) => venueExportCell(row, c, labels)))],
      fileBase: "lieux",
      sheetName: t("nav.venues"),
    };
  });
}
