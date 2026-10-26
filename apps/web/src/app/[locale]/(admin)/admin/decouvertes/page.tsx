import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ListFilters } from "@/components/admin/ListFilters";
import { discoveriesSpec, encodeListFilter, formatListSort, listFilterQuery, parseListPage, parseListState } from "@/components/admin/listRules";
import { loadListPage } from "@/components/admin/listPage";
import { ListPager, ListSummary } from "@/components/admin/ListTools";
import { getStaffMember } from "@/lib/staff";
import { type AdminDiscoveryRow, deadlineOf, pairLabel } from "./relations";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("discoveries") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Matchs et découvertes (section 11.2-6) : suivi, échéances (fin de la découverte ou de l'attente
 * de 7 jours), expirations. Lecture seule ; filtres avancés (11.3). Permission events.manage.
 * Les choix et décisions de chaque membre ne sont pas affichés.
 */
export default async function AdminDiscoveriesPage({ searchParams }: Props) {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("events.manage")) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const params = await searchParams;
  const page = parseListPage(params);
  const { filter, sort, columns } = parseListState(discoveriesSpec, params);
  const query = listFilterQuery(discoveriesSpec, {}, filter, sort, columns);
  const { rows, total, error, saved } = await loadListPage<AdminDiscoveryRow>(discoveriesSpec, filter, sort, page, staff.id);
  const show = (c: string) => columns.includes(c);
  const day = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="eyebrow">{t("groups.relations")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.discoveries")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("discoveries.intro")}</p>
      </header>

      {/* La clé remet le constructeur à l'état de l'adresse après chaque navigation */}
      <ListFilters
        key={(filter ? encodeListFilter(filter) : "") + formatListSort(sort) + columns.join(",")}
        list="discoveries"
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
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("discoveries.empty")}</p>
      ) : (
        <>
          <ListSummary total={total} exportPath="/admin/decouvertes/export" query={query} />
          <table className="mt-4 w-full border-collapse text-left text-sm">
            <caption className="sr-only">{t("nav.discoveries")}</caption>
            <thead className="hidden border-b border-line-strong md:table-header-group">
              <tr>
                <th scope="col" className="py-3 pr-4 font-medium">{t("discoveries.columns.pair")}</th>
                {show("event") && <th scope="col" className="py-3 pr-4 font-medium">{t("lists.discoveries.columns.event")}</th>}
                {show("status") && <th scope="col" className="py-3 pr-4 font-medium">{t("lists.discoveries.columns.status")}</th>}
                {show("deadline") && <th scope="col" className="py-3 font-medium md:text-right">{t("lists.discoveries.columns.deadline")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const [a, b] = pairLabel(row);
                const deadline = deadlineOf(row);
                return (
                  <tr key={row.id} className="grid gap-1 border-b border-line py-4 md:table-row md:py-0">
                    <th scope="row" className="font-normal md:py-4 md:pr-4">
                      <span className="block font-medium">{a}</span>
                      <span className="block">{b}</span>
                    </th>
                    {show("event") && <td className="text-fg-muted md:py-4 md:pr-4">{day(row.event_starts_at)}</td>}
                    {show("status") && (
                      <td className="md:py-4 md:pr-4">
                        {t(`discoveries.matchStatus.${row.match_status}`)}
                        {row.discovery_status && (
                          <span className="block text-fg-muted">
                            {t(`discoveries.discoveryStatus.${row.discovery_status}`)}
                            {row.extended && ` · ${t("discoveries.extended")}`}
                          </span>
                        )}
                      </td>
                    )}
                    {show("deadline") && <td className="tabular-nums text-fg-muted md:py-4 md:text-right">{deadline ? day(deadline) : "·"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ListPager pathname="/admin/decouvertes" query={query} page={page} total={total} />
        </>
      )}
    </div>
  );
}
