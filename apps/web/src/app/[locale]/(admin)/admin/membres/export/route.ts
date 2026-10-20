import { getFormatter, getTranslations } from "next-intl/server";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { ageOn } from "../../verifications/queue";
import { exportColumns, type ExportFormat, exportFileName, exportFormats, type ExportLabels, exportTable, toCsv, toXlsx } from "../exporting";
import { combineFilters, cotonouDay, decodeFilter, parseColumns, parseSort } from "../filters";
import { type MemberRow, parseMemberQuery } from "../members";

type Context = { params: Promise<{ locale: string }> };

/**
 * Export CSV ou Excel de la liste des membres filtrée (section 11.3) : mêmes paramètres
 * d'adresse que la liste, plus ?format=csv|xlsx. La base applique la permission, la limite
 * de 5 000 lignes, la règle des téléphones (super administration) et journalise l'export.
 */
export async function GET(request: Request, { params }: Context) {
  const { locale } = await params;
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("members.manage")) return new Response(null, { status: 404 });

  const search = new URL(request.url).searchParams;
  const format = search.get("format") as ExportFormat;
  if (!exportFormats.includes(format)) return new Response(null, { status: 400 });
  const query = parseMemberQuery(Object.fromEntries(search));
  const sort = parseSort(search.get("tri") ?? undefined);
  const columns = exportColumns(parseColumns(search.get("colonnes") ?? undefined), staff.role === "super_admin");

  const supabase = await createSupabaseServer();
  if (!supabase) return new Response(null, { status: 503 });
  const { data, error } = await supabase.rpc("admin_members_export", {
    p_filter: combineFilters(query, decodeFilter(search.get("f") ?? undefined)),
    p_sort: sort.length > 0 ? sort : null,
    p_format: format,
  });
  if (error) return new Response(null, { status: error.message === "forbidden" ? 404 : 400 });

  const t = await getTranslations({ locale, namespace: "Admin" });
  const dates = await getFormatter({ locale });
  const now = new Date();
  const labels: ExportLabels = {
    header: (c) => t(`members.export.columns.${c}`),
    status: (s) => t(`members.status.${s}`),
    role: (r) => t(`members.roles.${r}`),
    sex: (s) => t(`verifications.identity.sexes.${s}`),
    date: (iso) => dates.dateTime(new Date(iso), { year: "numeric", month: "2-digit", day: "2-digit" }),
    age: (birthDate) => ageOn(birthDate, now),
  };
  const table = exportTable((data ?? []) as MemberRow[], columns, labels);
  const name = exportFileName(format, cotonouDay(now));
  const headers = { "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" };

  if (format === "csv") {
    return new Response(toCsv(table), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  }

  const buffer = await toXlsx(table, t("nav.members"));
  return new Response(buffer, {
    headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
}
