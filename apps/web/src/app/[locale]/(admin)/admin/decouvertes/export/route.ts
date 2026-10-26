import { getFormatter, getTranslations } from "next-intl/server";
import { listExport } from "@/components/admin/listExport";
import { discoveriesSpec } from "@/components/admin/listRules";
import { type AdminDiscoveryRow, deadlineOf, discoveryExportColumns, pairLabel } from "../relations";

type Context = { params: Promise<{ locale: string }> };

/** Export CSV ou Excel des matchs et découvertes filtrés (11.3), journalisé par la base (discoveries.exported). */
export async function GET(request: Request, { params }: Context) {
  const { locale } = await params;
  return listExport<AdminDiscoveryRow>(request, discoveriesSpec, "events.manage", async (rows) => {
    const t = await getTranslations({ locale, namespace: "Admin" });
    const dates = await getFormatter({ locale });
    const date = (iso: string | null) => (iso ? dates.dateTime(new Date(iso), { year: "numeric", month: "2-digit", day: "2-digit" }) : null);
    const cell = (row: AdminDiscoveryRow, column: (typeof discoveryExportColumns)[number]) => {
      const [a, b] = pairLabel(row);
      switch (column) {
        case "event_date":
          return date(row.event_starts_at);
        case "member_a":
          return a;
        case "member_b":
          return b;
        case "match_status":
          return t(`discoveries.matchStatus.${row.match_status}`);
        case "discovery_status":
          return row.discovery_status ? t(`discoveries.discoveryStatus.${row.discovery_status}`) : null;
        case "deadline":
          return date(deadlineOf(row));
        case "extended":
          return t(row.extended ? "members.advanced.yes" : "members.advanced.no");
      }
    };
    return {
      table: [discoveryExportColumns.map((c) => t(`lists.discoveries.export.${c}`)), ...rows.map((row) => discoveryExportColumns.map((c) => cell(row, c)))],
      fileBase: "decouvertes",
      sheetName: t("nav.discoveries"),
    };
  });
}
