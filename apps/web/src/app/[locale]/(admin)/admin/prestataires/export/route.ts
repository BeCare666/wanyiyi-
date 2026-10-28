import { getFormatter, getTranslations } from "next-intl/server";
import { listExport } from "@/components/admin/listExport";
import { providersSpec } from "@/components/admin/listRules";
import { localized, type ProviderCategory, providerExportCell, providerExportColumns, type ProviderListRow } from "@/lib/providers";
import { createSupabaseServer } from "@/lib/supabase/server";

type Context = { params: Promise<{ locale: string }> };

/** Export CSV ou Excel des prestataires filtrés (11.3), journalisé par la base (providers.exported). */
export async function GET(request: Request, { params }: Context) {
  const { locale } = await params;
  return listExport<ProviderListRow>(request, providersSpec, "providers.manage", async (rows) => {
    const t = await getTranslations({ locale, namespace: "Admin" });
    const dates = await getFormatter({ locale });
    const supabase = await createSupabaseServer();
    const { data } = supabase ? await supabase.from("provider_categories").select("key, name, position, is_active") : { data: [] };
    const categories = (data ?? []) as ProviderCategory[];
    const labels = {
      yesNo: (b: boolean) => t(b ? "members.advanced.yes" : "members.advanced.no"),
      date: (iso: string) => dates.dateTime(new Date(iso), { year: "numeric", month: "2-digit", day: "2-digit" }),
      category: (key: string) => localized(categories.find((c) => c.key === key)?.name, locale) || key,
    };
    return {
      table: [
        providerExportColumns.map((c) => t(`lists.providers.export.${c}`)),
        ...rows.map((row) => providerExportColumns.map((c) => providerExportCell(row, c, labels))),
      ],
      fileBase: "prestataires",
      sheetName: t("nav.providers"),
    };
  });
}
