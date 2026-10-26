import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ListFilters } from "@/components/admin/ListFilters";
import { couplesSpec, encodeListFilter, formatListSort, listFilterQuery, parseListPage, parseListState } from "@/components/admin/listRules";
import { loadListPage } from "@/components/admin/listPage";
import { ListPager, ListSummary } from "@/components/admin/ListTools";
import { cn } from "@/lib/cn";
import { getStaffMember } from "@/lib/staff";
import { type AdminCoupleRow, INACTIVITY_ALERT_DAYS, pairLabel } from "../decouvertes/relations";
import { CoupleBlock } from "./CoupleBlock";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("couples") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Couples (section 11.2-7) : état, conseiller, activité (alerte après 60 jours sans activité, 9.5).
 * Aucun message du couple n'est visible ici. Filtres avancés (11.3). Permission couples.read ;
 * blocage d'un couple et levée du blocage (question 9, 26 octobre 2026) : couples.manage.
 */
export default async function AdminCouplesPage({ searchParams }: Props) {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("couples.read")) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const params = await searchParams;
  const page = parseListPage(params);
  const { filter, sort, columns } = parseListState(couplesSpec, params);
  const query = listFilterQuery(couplesSpec, {}, filter, sort, columns);
  const { rows, total, error, saved } = await loadListPage<AdminCoupleRow>(couplesSpec, filter, sort, page, staff.id);
  const show = (c: string) => columns.includes(c);
  const canBlock = staff.permissions.includes("couples.manage");
  const day = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="eyebrow">{t("groups.relations")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.couples")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("couples.intro")}</p>
      </header>

      {/* La clé remet le constructeur à l'état de l'adresse après chaque navigation */}
      <ListFilters
        key={(filter ? encodeListFilter(filter) : "") + formatListSort(sort) + columns.join(",")}
        list="couples"
        quick={{}}
        filter={filter}
        sort={sort}
        columns={columns}
        saved={saved}
      />

      {error ? (
        <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("couples.empty")}</p>
      ) : (
        <>
          <ListSummary total={total} exportPath="/admin/couples/export" query={query} />
          <table className="mt-4 w-full border-collapse text-left text-sm">
            <caption className="sr-only">{t("nav.couples")}</caption>
            <thead className="hidden border-b border-line-strong md:table-header-group">
              <tr>
                <th scope="col" className="py-3 pr-4 font-medium">{t("discoveries.columns.pair")}</th>
                {show("status") && <th scope="col" className="py-3 pr-4 font-medium">{t("lists.couples.columns.status")}</th>}
                {show("counselor") && <th scope="col" className="py-3 pr-4 font-medium">{t("lists.couples.columns.counselor")}</th>}
                {show("activity") && <th scope="col" className="py-3 pr-4 font-medium">{t("lists.couples.columns.activity")}</th>}
                {show("created") && <th scope="col" className="py-3 font-medium md:text-right">{t("lists.couples.columns.created")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const [a, b] = pairLabel(row);
                const alert = (row.status === "active" || row.status === "paused") && row.inactive_days >= INACTIVITY_ALERT_DAYS;
                return (
                  <tr key={row.id} className="grid gap-1 border-b border-line py-4 md:table-row md:py-0">
                    <th scope="row" className="font-normal md:py-4 md:pr-4">
                      <span className="block font-medium">{a}</span>
                      <span className="block">{b}</span>
                    </th>
                    {show("status") && (
                      <td className="md:py-4 md:pr-4">
                        {t(`couples.status.${row.status}`)}
                        {row.blocked_at && (
                          <span className="block text-sm">
                            {t("couples.blocked", { date: day(row.blocked_at) })}
                            {row.blocked_reason && <span className="block text-fg-muted">{row.blocked_reason}</span>}
                          </span>
                        )}
                        {canBlock && (row.status === "active" || row.status === "paused") && <CoupleBlock coupleId={row.id} blocked={row.blocked_at !== null} />}
                      </td>
                    )}
                    {show("counselor") && <td className="md:py-4 md:pr-4">{row.counselor_name ?? t("couples.noCounselor")}</td>}
                    {show("activity") && (
                      <td className={cn("tabular-nums md:py-4 md:pr-4", alert ? "font-medium" : "text-fg-muted")}>
                        {t("couples.inactiveDays", { count: row.inactive_days })}
                        {alert && <span className="block text-xs">{t("couples.inactivityAlert", { days: INACTIVITY_ALERT_DAYS })}</span>}
                      </td>
                    )}
                    {show("created") && <td className="text-fg-muted md:py-4 md:text-right">{day(row.created_at)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ListPager pathname="/admin/couples" query={query} page={page} total={total} />
        </>
      )}
    </div>
  );
}
