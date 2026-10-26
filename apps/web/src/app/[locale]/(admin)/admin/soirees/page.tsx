import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ListFilters } from "@/components/admin/ListFilters";
import { combineListFilters, encodeListFilter, eventsSpec, formatListSort, listFilterQuery, parseListPage, parseListState } from "@/components/admin/listRules";
import { loadListPage } from "@/components/admin/listPage";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { getStaffMember } from "@/lib/staff";
import { exportFormats } from "../membres/exporting";
import { pageCount } from "../membres/members";
import { type AdminEventRow, eventConditions, eventFilters, parseEventFilter } from "./evenings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("evenings") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Liste des soirées (section 11.2-5), brouillons compris, les plus récentes d'abord :
 * remplissage par sexe, liste d'attente, matchs. Filtres avancés (11.3), tri, colonnes,
 * filtres enregistrés et export, tout dans l'adresse ; pagination côté serveur.
 * Réservée à la permission events.manage.
 */
export default async function AdminEveningsPage({ searchParams }: Props) {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("events.manage")) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const params = await searchParams;
  const tab = parseEventFilter(params.etat);
  const page = parseListPage(params);
  const { filter: advanced, sort, columns } = parseListState(eventsSpec, params);
  const tabQuery = eventFilters.find((f) => f.key === tab)?.query;
  const quickParams: Record<string, string> = tabQuery ? { etat: tabQuery } : {};
  const advancedParams = listFilterQuery(eventsSpec, {}, advanced, sort, columns);
  const listFilter = combineListFilters(eventConditions(tab), advanced);
  const { rows, total, error, saved } = await loadListPage<AdminEventRow & { total: number }>(eventsSpec, listFilter, sort, page, staff.id);
  const pages = pageCount(total);
  const show = (c: string) => columns.includes(c);
  const pageHref = (p: number) => ({ pathname: "/admin/soirees", query: { ...quickParams, ...advancedParams, ...(p > 1 ? { page: String(p) } : {}) } });
  const amount = (xof: number) => format.number(xof, { style: "currency", currency: "XOF", maximumFractionDigits: 0 });

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">{t("groups.evenings")}</p>
          <h1 className="mt-4 text-4xl">{t("nav.evenings")}</h1>
          <p className="mt-4 max-w-measure text-fg-muted">{t("evenings.intro")}</p>
        </div>
        <Link
          href="/admin/soirees/nouvelle"
          className="inline-flex min-h-12 items-center rounded-sm bg-accent px-7 text-xs font-medium uppercase tracking-[0.16em] text-accent-fg"
        >
          {t("evenings.new")}
        </Link>
      </header>

      <nav aria-label={t("evenings.filters.label")} className="mt-10 flex flex-wrap gap-2">
        {eventFilters.map(({ key, query }) => (
          <Link
            key={key}
            href={{ pathname: "/admin/soirees", query: { ...(query ? { etat: query } : {}), ...advancedParams } }}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center rounded-sm border px-4 text-sm",
              tab === key ? "border-fg bg-fg text-bg" : "border-line text-fg hover:border-fg",
            )}
          >
            {t(`evenings.filters.${key}`)}
          </Link>
        ))}
      </nav>

      {/* La clé remet le constructeur à l'état de l'adresse après chaque navigation */}
      <ListFilters
        key={(advanced ? encodeListFilter(advanced) : "") + formatListSort(sort) + columns.join(",")}
        list="events"
        quick={quickParams}
        filter={advanced}
        sort={sort}
        columns={columns}
        saved={saved}
      />

      {error ? (
        <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("evenings.empty")}</p>
      ) : (
        <>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 text-sm">
            <p className="text-fg-muted" role="status">
              {t("lists.count", { count: total })}
            </p>
            {/* Export du résultat filtré, journalisé par la base (5 000 lignes au plus) */}
            <p className="flex flex-wrap items-center gap-4">
              <span className="text-fg-muted">{t("members.export.label")}</span>
              {exportFormats.map((f) => (
                <Link
                  key={f}
                  href={{ pathname: "/admin/soirees/export", query: { ...quickParams, ...advancedParams, format: f } }}
                  prefetch={false}
                  className="text-link underline-offset-4 hover:underline"
                >
                  {t(`members.export.formats.${f}`)}
                </Link>
              ))}
            </p>
          </div>
          {total > 5000 && <p className="mt-2 text-xs text-fg-muted">{t("members.export.limit", { max: 5000 })}</p>}
          <table className="mt-4 w-full border-collapse text-left text-sm">
            <caption className="sr-only">{t("nav.evenings")}</caption>
            <thead className="hidden border-b border-line-strong md:table-header-group">
              <tr>
                <th scope="col" className="py-3 pr-4 font-medium">{t("evenings.columns.date")}</th>
                {show("status") && <th scope="col" className="py-3 pr-4 font-medium">{t("evenings.columns.status")}</th>}
                {show("women") && <th scope="col" className="py-3 pr-4 font-medium">{t("evenings.columns.women")}</th>}
                {show("men") && <th scope="col" className="py-3 pr-4 font-medium">{t("evenings.columns.men")}</th>}
                {show("price") && <th scope="col" className="py-3 pr-4 font-medium">{t("lists.events.columns.price")}</th>}
                {show("matches") && <th scope="col" className="py-3 font-medium md:text-right">{t("evenings.columns.matches")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="grid gap-1 border-b border-line py-4 md:table-row md:py-0">
                  <th scope="row" className="font-normal md:py-4 md:pr-4">
                    <Link href={`/admin/soirees/${row.id}`} className="font-medium underline-offset-4 hover:underline">
                      {format.dateTime(new Date(row.starts_at), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                    </Link>
                    <span className="block text-fg-muted">
                      {row.venue_name ?? t("evenings.noVenue")}
                      {row.theme_key && ` · ${row.theme_key}`}
                    </span>
                  </th>
                  {show("status") && <td className="md:py-4 md:pr-4">{t(`evenings.status.${row.status}`)}</td>}
                  {show("women") && (
                    <td className="tabular-nums md:py-4 md:pr-4">
                      <span className="md:sr-only">{t("evenings.cellLabel", { label: t("evenings.columns.women") })} </span>
                      {t("evenings.fill", { taken: row.taken_women, capacity: row.capacity_women })}
                      {row.waiting_women > 0 && <span className="text-fg-muted"> · {t("evenings.waiting", { count: row.waiting_women })}</span>}
                    </td>
                  )}
                  {show("men") && (
                    <td className="tabular-nums md:py-4 md:pr-4">
                      <span className="md:sr-only">{t("evenings.cellLabel", { label: t("evenings.columns.men") })} </span>
                      {t("evenings.fill", { taken: row.taken_men, capacity: row.capacity_men })}
                      {row.waiting_men > 0 && <span className="text-fg-muted"> · {t("evenings.waiting", { count: row.waiting_men })}</span>}
                    </td>
                  )}
                  {show("price") && (
                    <td className="tabular-nums md:py-4 md:pr-4">
                      <span className="md:sr-only">{t("evenings.cellLabel", { label: t("lists.events.columns.price") })} </span>
                      {row.price_xof !== null ? amount(row.price_xof) : "·"}
                    </td>
                  )}
                  {show("matches") && (
                    <td className="tabular-nums text-fg-muted md:py-4 md:text-right">
                      <span className="md:sr-only">{t("evenings.cellLabel", { label: t("evenings.columns.matches") })} </span>
                      {row.matches}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <nav aria-label={t("members.pagination")} className="mt-8 flex items-center justify-between gap-4 text-sm">
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="text-link underline-offset-4 hover:underline">
                  {t("members.previous")}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-fg-muted">{t("members.page", { page, pages })}</span>
              {page < pages ? (
                <Link href={pageHref(page + 1)} className="text-link underline-offset-4 hover:underline">
                  {t("members.next")}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
