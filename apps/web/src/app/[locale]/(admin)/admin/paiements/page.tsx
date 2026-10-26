import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ListFilters } from "@/components/admin/ListFilters";
import { combineListFilters, encodeListFilter, formatListSort, listFilterQuery, parseListState, paymentsSpec } from "@/components/admin/listRules";
import { loadListPage } from "@/components/admin/listPage";
import { fieldClass } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { getStaffMember } from "@/lib/staff";
import { exportFormats } from "../membres/exporting";
import { pageCount } from "../membres/members";
import { memberName } from "../verifications/queue";
import {
  type PaymentRow,
  parsePaymentQuery,
  paymentConditions,
  paymentPurposes,
  paymentQueryParams,
  paymentStatuses,
  providerKey,
  refundFilters,
  refundState,
} from "./payments";
import { RefundButton } from "./RefundButton";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("payments") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Paiements (section 11.2-9) : transactions, soirée concernée, remboursements.
 * Filtres rapides et avancés (11.3), tri, colonnes, filtres enregistrés et export, tout dans
 * l'adresse ; pagination côté serveur. Permission payments.read ;
 * « Marquer remboursé » (remboursement manuel FeexPay, 22 octobre 2026) : payments.refund.
 */
export default async function AdminPaymentsPage({ searchParams }: Props) {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("payments.read")) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const params = await searchParams;
  const query = parsePaymentQuery(params);
  const { filter: advanced, sort, columns } = parseListState(paymentsSpec, params);
  // Paramètres des filtres avancés, gardés par le formulaire rapide et la pagination
  const advancedParams = listFilterQuery(paymentsSpec, {}, advanced, sort, columns);
  const quickParams = paymentQueryParams(query, 1);
  const listFilter = combineListFilters(paymentConditions(query), advanced);
  const { rows, total, error, saved } = await loadListPage<PaymentRow>(paymentsSpec, listFilter, sort, query.page, staff.id);
  const pages = pageCount(total);
  const selectClass = cn(fieldClass, "mt-1 text-base");
  const canOpenMember = staff.permissions.includes("members.manage");
  const canOpenEvening = staff.permissions.includes("events.manage");
  const canRefund = staff.permissions.includes("payments.refund");
  const amount = (xof: number) => format.number(xof, { style: "currency", currency: "XOF", maximumFractionDigits: 0 });
  const day = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "short", year: "numeric" });
  const show = (c: string) => columns.includes(c);
  const pageHref = (page: number) => ({ pathname: "/admin/paiements", query: { ...paymentQueryParams(query, page), ...advancedParams } });

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="eyebrow">{t("groups.payments")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.payments")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("payments.intro")}</p>
      </header>

      {/* Formulaire GET : les filtres restent dans l'adresse, partageables entre administrateurs */}
      <form method="get" role="search" className="mt-10 grid gap-6 border-t border-line pt-8 md:grid-cols-12 md:items-end">
        {Object.entries(advancedParams).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label className="block md:col-span-4">
          <span className="text-sm font-medium">{t("payments.search")}</span>
          <input type="search" name="q" defaultValue={query.search} maxLength={100} className={cn(fieldClass, "mt-1 text-base")} />
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-medium">{t("payments.columns.status")}</span>
          <select name="etat" defaultValue={query.status ?? ""} className={selectClass}>
            <option value="">{t("members.any")}</option>
            {paymentStatuses.map((s) => (
              <option key={s} value={s}>
                {t(`payments.status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block md:col-span-3">
          <span className="text-sm font-medium">{t("payments.columns.purpose")}</span>
          <select name="objet" defaultValue={query.purpose ?? ""} className={selectClass}>
            <option value="">{t("members.any")}</option>
            {paymentPurposes.map((p) => (
              <option key={p} value={p}>
                {t(`payments.purposes.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-medium">{t("payments.refund")}</span>
          <select name="remboursement" defaultValue={query.refund ?? ""} className={selectClass}>
            <option value="">{t("members.any")}</option>
            {refundFilters.map((r) => (
              <option key={r} value={r}>
                {t(`payments.refunds.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-sm border border-fg px-5 text-sm md:col-span-1">
          {t("members.apply")}
        </button>
      </form>

      {/* La clé remet le constructeur à l'état de l'adresse après chaque navigation */}
      <ListFilters
        key={(advanced ? encodeListFilter(advanced) : "") + formatListSort(sort) + columns.join(",")}
        list="payments"
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
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("payments.empty")}</p>
      ) : (
        <>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 text-sm">
            <p className="text-fg-muted" role="status">
              {t("payments.count", { count: total })}
            </p>
            {/* Export du résultat filtré, journalisé par la base (5 000 lignes au plus) */}
            <p className="flex flex-wrap items-center gap-4">
              <span className="text-fg-muted">{t("members.export.label")}</span>
              {exportFormats.map((f) => (
                <Link
                  key={f}
                  href={{ pathname: "/admin/paiements/export", query: { ...quickParams, ...advancedParams, format: f } }}
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
            <caption className="sr-only">{t("nav.payments")}</caption>
            <thead className="hidden border-b border-line-strong md:table-header-group">
              <tr>
                {show("date") && <th scope="col" className="py-3 pr-4 font-medium">{t("payments.columns.date")}</th>}
                <th scope="col" className="py-3 pr-4 font-medium">{t("payments.columns.member")}</th>
                {show("purpose") && <th scope="col" className="py-3 pr-4 font-medium">{t("payments.columns.purpose")}</th>}
                {show("status") && <th scope="col" className="py-3 pr-4 font-medium">{t("payments.columns.status")}</th>}
                {show("provider") && <th scope="col" className="py-3 pr-4 font-medium">{t("lists.payments.columns.provider")}</th>}
                {show("amount") && <th scope="col" className="py-3 font-medium md:text-right">{t("payments.columns.amount")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name = memberName(row) ?? row.member_number ?? t("verifications.noProfile");
                const refund = refundState(row);
                return (
                  <tr key={row.payment_id} className="grid gap-1 border-b border-line py-4 md:table-row md:py-0">
                    {show("date") && <td className="text-fg-muted md:py-4 md:pr-4">{day(row.created_at)}</td>}
                    <th scope="row" className="font-normal md:py-4 md:pr-4">
                      {canOpenMember && row.user_id ? (
                        <Link href={`/admin/membres/${row.user_id}`} className="font-medium underline-offset-4 hover:underline">
                          {name}
                        </Link>
                      ) : (
                        <span className="font-medium">{name}</span>
                      )}
                      {row.member_number && <span className="block text-fg-muted">{row.member_number}</span>}
                    </th>
                    {show("purpose") && (
                      <td className="md:py-4 md:pr-4">
                        {t(`payments.purposes.${row.purpose}`)}
                        {row.event_id && row.event_starts_at && (
                          <span className="block text-fg-muted">
                            {canOpenEvening ? (
                              <Link href={`/admin/soirees/${row.event_id}`} className="text-link underline-offset-4 hover:underline">
                                {t("payments.evening", { date: day(row.event_starts_at) })}
                              </Link>
                            ) : (
                              t("payments.evening", { date: day(row.event_starts_at) })
                            )}
                          </span>
                        )}
                      </td>
                    )}
                    {show("status") && (
                      <td className="md:py-4 md:pr-4">
                        {t(`payments.status.${row.status}`)}
                        {refund === "requested" && <span className="block text-fg-muted">{t("payments.refunds.requested")}</span>}
                        {refund === "requested" && canRefund && <RefundButton paymentId={row.payment_id} />}
                      </td>
                    )}
                    {show("provider") && (
                      <td className="text-fg-muted md:py-4 md:pr-4">
                        {t(`payments.providers.${providerKey(row.provider)}`)}
                        {row.provider_transaction_id && <span className="block text-xs">{row.provider_transaction_id}</span>}
                      </td>
                    )}
                    {show("amount") && (
                      <td className="tabular-nums md:py-4 md:text-right">
                        {amount(row.amount_xof)}
                        {row.refunded_amount_xof > 0 && (
                          <span className="block text-fg-muted">{t("payments.refunded", { amount: amount(row.refunded_amount_xof) })}</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pages > 1 && (
            <nav aria-label={t("members.pagination")} className="mt-8 flex items-center justify-between gap-4 text-sm">
              {query.page > 1 ? (
                <Link href={pageHref(query.page - 1)} className="text-link underline-offset-4 hover:underline">
                  {t("members.previous")}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-fg-muted">{t("members.page", { page: query.page, pages })}</span>
              {query.page < pages ? (
                <Link href={pageHref(query.page + 1)} className="text-link underline-offset-4 hover:underline">
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
