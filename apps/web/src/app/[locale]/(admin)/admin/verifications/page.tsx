import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ListFilters } from "@/components/admin/ListFilters";
import { combineListFilters, encodeListFilter, formatListSort, listFilterQuery, parseListPage, parseListState, verificationsSpec } from "@/components/admin/listRules";
import { loadListPage } from "@/components/admin/listPage";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { getStaffMember } from "@/lib/staff";
import { exportFormats } from "../membres/exporting";
import { pageCount } from "../membres/members";
import { memberName, parseQueueFilter, queueConditions, queueFilters, type VerificationListRow } from "./queue";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("verifications") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * File des vérifications (section 11.2-3) : dossiers en attente ou à corriger, les plus anciens
 * d'abord, et dossiers traités. Filtres avancés (11.3), tri, colonnes, filtres enregistrés et
 * export, tout dans l'adresse ; pagination côté serveur. Permission verifications.review.
 */
export default async function VerificationQueuePage({ searchParams }: Props) {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("verifications.review")) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const params = await searchParams;
  const tab = parseQueueFilter(params.etat);
  const page = parseListPage(params);
  const { filter: advanced, sort, columns } = parseListState(verificationsSpec, params);
  const tabQuery = queueFilters.find((f) => f.key === tab)?.query;
  const quickParams: Record<string, string> = tabQuery ? { etat: tabQuery } : {};
  const advancedParams = listFilterQuery(verificationsSpec, {}, advanced, sort, columns);
  const listFilter = combineListFilters(queueConditions(tab), advanced);
  const { rows, total, error, saved } = await loadListPage<VerificationListRow>(verificationsSpec, listFilter, sort, page, staff.id);
  const pages = pageCount(total);
  const show = (c: string) => columns.includes(c);
  const pageHref = (p: number) => ({ pathname: "/admin/verifications", query: { ...quickParams, ...advancedParams, ...(p > 1 ? { page: String(p) } : {}) } });

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="eyebrow">{t("groups.members")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.verifications")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("verifications.intro")}</p>
      </header>

      <nav aria-label={t("verifications.filters.label")} className="mt-10 flex flex-wrap gap-2">
        {queueFilters.map(({ key, query }) => (
          <Link
            key={key}
            href={{ pathname: "/admin/verifications", query: { ...(query ? { etat: query } : {}), ...advancedParams } }}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center rounded-sm border px-4 text-sm",
              tab === key ? "border-fg bg-fg text-bg" : "border-line text-fg hover:border-fg",
            )}
          >
            {t(`verifications.filters.${key}`)}
          </Link>
        ))}
      </nav>

      {/* La clé remet le constructeur à l'état de l'adresse après chaque navigation */}
      <ListFilters
        key={(advanced ? encodeListFilter(advanced) : "") + formatListSort(sort) + columns.join(",")}
        list="verifications"
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
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("verifications.empty")}</p>
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
                  href={{ pathname: "/admin/verifications/export", query: { ...quickParams, ...advancedParams, format: f } }}
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
            <caption className="sr-only">{t("nav.verifications")}</caption>
            <thead className="hidden border-b border-line-strong md:table-header-group">
              <tr>
                <th scope="col" className="py-3 pr-4 font-medium">{t("verifications.columns.member")}</th>
                {show("status") && <th scope="col" className="py-3 pr-4 font-medium">{t("verifications.columns.status")}</th>}
                {show("dossier") && <th scope="col" className="py-3 pr-4 font-medium">{t("verifications.columns.dossier")}</th>}
                {show("declared") && <th scope="col" className="py-3 pr-4 font-medium">{t("lists.verifications.columns.declared")}</th>}
                {show("age") && <th scope="col" className="py-3 pr-4 font-medium">{t("lists.verifications.columns.age")}</th>}
                {show("submitted") && <th scope="col" className="py-3 font-medium md:text-right">{t("verifications.columns.submitted")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.verification_id} className="grid gap-1 border-b border-line py-4 md:table-row md:py-0">
                  <th scope="row" className="font-normal md:py-4 md:pr-4">
                    <Link href={`/admin/verifications/${row.verification_id}`} className="font-medium underline-offset-4 hover:underline">
                      {memberName(row) ?? t("verifications.noProfile")}
                    </Link>
                    {row.member_number && <span className="ml-2 text-fg-muted">{row.member_number}</span>}
                  </th>
                  {show("status") && <td className="md:py-4 md:pr-4">{t(`verifications.status.${row.status}`)}</td>}
                  {show("dossier") && (
                    <td className="md:py-4 md:pr-4">
                      <span className={row.ready ? "text-fg" : "text-fg-muted"}>{t(row.ready ? "verifications.ready" : "verifications.incomplete")}</span>
                      {row.document_kind && <span className="text-fg-muted"> · {t(`verifications.kinds.${row.document_kind}`)}</span>}
                    </td>
                  )}
                  {show("declared") && <td className="md:py-4 md:pr-4">{row.declared_status ? t(`lists.declared.${row.declared_status}`) : "·"}</td>}
                  {show("age") && (
                    <td className="tabular-nums md:py-4 md:pr-4">{row.age !== null ? t("verifications.identity.age", { age: row.age }) : "·"}</td>
                  )}
                  {show("submitted") && (
                    <td className="text-fg-muted md:py-4 md:text-right">
                      {row.submitted_at ? format.dateTime(new Date(row.submitted_at), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "·"}
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
