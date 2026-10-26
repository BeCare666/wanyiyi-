import { getFormatter, getTranslations } from "next-intl/server";
import { listExport } from "@/components/admin/listExport";
import { themesSpec } from "@/components/admin/listRules";
import { themeExportCell, themeExportColumns, type ThemeListRow, themeName, type ThemeRow } from "../themes";

type Context = { params: Promise<{ locale: string }> };

/** Export CSV ou Excel des thèmes filtrés (11.3), journalisé par la base (themes.exported). */
export async function GET(request: Request, { params }: Context) {
  const { locale } = await params;
  return listExport<ThemeListRow>(request, themesSpec, "events.manage", async (rows) => {
    const t = await getTranslations({ locale, namespace: "Admin" });
    const tp = await getTranslations({ locale, namespace: "Profile" });
    const dates = await getFormatter({ locale });
    const labels = {
      name: (row: ThemeRow) => themeName(row, locale),
      religion: (r: string) => (tp.has(`religion.options.${r}`) ? tp(`religion.options.${r}`) : r),
      sector: (s: string) => (tp.has(`sector.options.${s}`) ? tp(`sector.options.${s}`) : s),
      date: (iso: string) => dates.dateTime(new Date(iso), { year: "numeric", month: "2-digit", day: "2-digit" }),
    };
    return {
      table: [themeExportColumns.map((c) => t(`lists.themes.export.${c}`)), ...rows.map((row) => themeExportColumns.map((c) => themeExportCell(row, c, labels)))],
      fileBase: "themes",
      sheetName: t("nav.themes"),
    };
  });
}
