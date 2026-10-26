import { getFormatter, getTranslations } from "next-intl/server";
import { listExport } from "@/components/admin/listExport";
import { moderationSpec } from "@/components/admin/listRules";
import { moderationExportCell, moderationExportColumns, type ModerationRow } from "../moderation";

type Context = { params: Promise<{ locale: string }> };

/** Export CSV ou Excel des textes en attente filtrés (11.3), journalisé par la base (moderation.exported). */
export async function GET(request: Request, { params }: Context) {
  const { locale } = await params;
  return listExport<ModerationRow>(request, moderationSpec, "profile_texts.review", async (rows) => {
    const t = await getTranslations({ locale, namespace: "Admin" });
    const dates = await getFormatter({ locale });
    const labels = {
      field: (f: string) => t(`moderation.fields.${f}`),
      date: (iso: string) => dates.dateTime(new Date(iso), { year: "numeric", month: "2-digit", day: "2-digit" }),
    };
    return {
      table: [
        moderationExportColumns.map((c) => t(`lists.moderation.export.${c}`)),
        ...rows.map((row) => moderationExportColumns.map((c) => moderationExportCell(row, c, labels))),
      ],
      fileBase: "moderation",
      sheetName: t("nav.moderation"),
    };
  });
}
