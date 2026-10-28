import { getFormatter, getTranslations } from "next-intl/server";
import { listExport } from "@/components/admin/listExport";
import { cagnottesSpec } from "@/components/admin/listRules";
import { cagnotteExportCell, cagnotteExportColumns, type CagnotteListRow } from "../cagnottes";

type Context = { params: Promise<{ locale: string }> };

/** Export CSV ou Excel des cagnottes filtrées (11.3), journalisé par la base. */
export async function GET(request: Request, { params }: Context) {
  const { locale } = await params;
  return listExport<CagnotteListRow>(request, cagnottesSpec, "cagnottes.manage", async (rows) => {
    const t = await getTranslations({ locale, namespace: "Admin" });
    const dates = await getFormatter({ locale });
    const labels = {
      yesNo: (b: boolean) => t(b ? "members.advanced.yes" : "members.advanced.no"),
      date: (iso: string) => dates.dateTime(new Date(iso), { year: "numeric", month: "2-digit", day: "2-digit" }),
      status: (s: string) => t(`cagnottes.status.${s}`),
    };
    return {
      table: [
        cagnotteExportColumns.map((c) => t(`lists.cagnottes.export.${c}`)),
        ...rows.map((row) => cagnotteExportColumns.map((c) => cagnotteExportCell(row, c, labels))),
      ],
      fileBase: "cagnottes",
      sheetName: t("nav.cagnottes"),
    };
  });
}
