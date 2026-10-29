import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ListFilters } from "@/components/admin/ListFilters";
import { cagnottesSpec, encodeListFilter, formatListSort, listFilterQuery, parseListPage, parseListState } from "@/components/admin/listRules";
import { loadListPage } from "@/components/admin/listPage";
import { ListPager, ListSummary } from "@/components/admin/ListTools";
import { Link } from "@/i18n/navigation";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { CagnotteSettings } from "./CagnotteForms";
import type { CagnotteListRow } from "./cagnottes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("cagnottes") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Cagnottes (11.2-10 ; phase 4, question 3) : suivi, reversements à faire à la main, cagnottes
 * fermées par une séparation (contributions à rembourser depuis Paiements), réglages.
 */
export default async function AdminCagnottesPage({ searchParams }: Props) {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("cagnottes.manage")) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const params = await searchParams;
  const page = parseListPage(params);
  const { filter, sort, columns } = parseListState(cagnottesSpec, params);
  const query = listFilterQuery(cagnottesSpec, {}, filter, sort, columns);
  const { rows, total, error, saved } = await loadListPage<CagnotteListRow>(cagnottesSpec, filter, sort, page, staff.id);
  const show = (c: string) => columns.includes(c);
  const supabase = await createSupabaseServer();
  const { data: settings } = supabase ? await supabase.rpc("cagnotte_settings") : { data: null };
  const current = ((settings ?? []) as { min_contribution_xof: number; commission_percent: number | string; min_payout_xof: number }[])[0];
  const amount = (xof: number) => format.number(xof, { style: "currency", currency: "XOF", maximumFractionDigits: 0 });
  const day = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Porto-Novo" });

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="eyebrow">{t("groups.celebration")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.cagnottes")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("cagnottes.intro")}</p>
      </header>

      {/* La clé remet le constructeur à l'état de l'adresse après chaque navigation */}
      <ListFilters
        key={(filter ? encodeListFilter(filter) : "") + formatListSort(sort) + columns.join(",")}
        list="cagnottes"
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
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("cagnottes.empty")}</p>
      ) : (
        <>
          <ListSummary total={total} exportPath="/admin/cagnottes/export" query={query} />
          <table className="mt-4 w-full border-collapse text-left text-sm">
            <caption className="sr-only">{t("nav.cagnottes")}</caption>
            <thead className="hidden border-b border-line-strong md:table-header-group">
              <tr>
                <th scope="col" className="py-3 pr-4 font-medium">{t("cagnottes.couple")}</th>
                {show("status") && <th scope="col" className="py-3 pr-4 font-medium">{t("lists.cagnottes.columns.status")}</th>}
                {show("collected") && <th scope="col" className="py-3 pr-4 font-medium md:text-right">{t("lists.cagnottes.columns.collected")}</th>}
                {show("closes") && <th scope="col" className="py-3 pr-4 font-medium">{t("lists.cagnottes.columns.closes")}</th>}
                {show("payout") && <th scope="col" className="py-3 font-medium">{t("lists.cagnottes.columns.payout")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id} className="grid gap-1 border-b border-line py-4 md:table-row md:py-0">
                  <th scope="row" className="font-medium md:py-4 md:pr-4">
                    <Link href={`/admin/cagnottes/${g.id}`} className="text-link underline-offset-4 hover:underline">
                      {g.title}
                    </Link>
                    <span className="block font-normal text-fg-muted">
                      {[g.a_first_name ?? g.a_number, g.b_first_name ?? g.b_number].filter(Boolean).join(" · ")}
                    </span>
                  </th>
                  {show("status") && <td className="md:py-4 md:pr-4">{t(`cagnottes.status.${g.status}`)}</td>}
                  {show("collected") && <td className="tabular-nums md:py-4 md:pr-4 md:text-right">{amount(g.collected_xof)}</td>}
                  {show("closes") && <td className="text-fg-muted md:py-4 md:pr-4">{day(g.closes_at)}</td>}
                  {show("payout") && (
                    <td className="md:py-4">
                      {g.payout_pending ? t("cagnottes.payoutPending") : g.to_refund ? t("cagnottes.toRefund") : "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <ListPager pathname="/admin/cagnottes" query={query} page={page} total={total} />
        </>
      )}

      <section aria-labelledby="reglages" className="mt-12 border-t border-line pt-8">
        <h2 id="reglages" className="text-2xl">
          {t("cagnottes.settings.title")}
        </h2>
        <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("cagnottes.settings.intro")}</p>
        {current && <CagnotteSettings min={current.min_contribution_xof} commission={Number(current.commission_percent)} minPayout={current.min_payout_xof} />}
      </section>
    </div>
  );
}
