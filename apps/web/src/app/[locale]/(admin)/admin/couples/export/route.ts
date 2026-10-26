import { getFormatter, getTranslations } from "next-intl/server";
import { listExport } from "@/components/admin/listExport";
import { couplesSpec } from "@/components/admin/listRules";
import { type AdminCoupleRow, coupleExportColumns, pairLabel } from "../../decouvertes/relations";

type Context = { params: Promise<{ locale: string }> };

/** Export CSV ou Excel des couples filtrés (11.3), journalisé par la base (couples.exported). Aucun message. */
export async function GET(request: Request, { params }: Context) {
  const { locale } = await params;
  return listExport<AdminCoupleRow>(request, couplesSpec, "couples.read", async (rows) => {
    const t = await getTranslations({ locale, namespace: "Admin" });
    const dates = await getFormatter({ locale });
    const date = (iso: string) => dates.dateTime(new Date(iso), { year: "numeric", month: "2-digit", day: "2-digit" });
    const cell = (row: AdminCoupleRow, column: (typeof coupleExportColumns)[number]) => {
      const [a, b] = pairLabel(row);
      switch (column) {
        case "member_a":
          return a;
        case "member_b":
          return b;
        case "status":
          return t(`couples.status.${row.status}`);
        case "counselor":
          return row.counselor_name;
        case "created_at":
          return date(row.created_at);
        case "last_activity_at":
          return date(row.last_activity_at);
        case "inactive_days":
          return row.inactive_days;
      }
    };
    return {
      table: [coupleExportColumns.map((c) => t(`lists.couples.export.${c}`)), ...rows.map((row) => coupleExportColumns.map((c) => cell(row, c)))],
      fileBase: "couples",
      sheetName: t("nav.couples"),
    };
  });
}
