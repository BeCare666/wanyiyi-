import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ListFilters } from "@/components/admin/ListFilters";
import { encodeListFilter, formatListSort, listFilterQuery, parseListPage, parseListState, venuesSpec } from "@/components/admin/listRules";
import { loadListPage } from "@/components/admin/listPage";
import { ListPager, ListSummary } from "@/components/admin/ListTools";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { VenueForm } from "./VenueForm";
import { FirstDateEditor } from "./FirstDateEditor";
import type { FirstDateRow, VenueRow } from "./venues";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("venues") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Lieux des soirées (section 11.2-5). Pour la démonstration : lieux fictifs seulement.
 * Filtres avancés (11.3), tri, colonnes, filtres enregistrés et export, tout dans l'adresse.
 */
export default async function AdminVenuesPage({ searchParams }: Props) {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("events.manage")) notFound();
  const t = await getTranslations("Admin");
  const params = await searchParams;
  const page = parseListPage(params);
  const { filter, sort, columns } = parseListState(venuesSpec, params);
  const query = listFilterQuery(venuesSpec, {}, filter, sort, columns);
  const { rows, total, error, saved } = await loadListPage<VenueRow & { events: number; total: number }>(venuesSpec, filter, sort, page, staff.id);
  const show = (c: string) => columns.includes(c);
  // Lieux conseillés pour un premier rendez-vous (question 4) : tous les lieux, réglage par lieu
  const supabase = await createSupabaseServer();
  const { data: firstDate } = supabase
    ? await supabase.from("venues").select("id, name, city, first_date_partner, district, venue_kind, opening_hours").order("city").order("name")
    : { data: [] };
  const firstDateVenues = (firstDate ?? []) as FirstDateRow[];

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="eyebrow">{t("groups.evenings")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.venues")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("venues.intro")}</p>
      </header>

      {/* La clé remet le constructeur à l'état de l'adresse après chaque navigation */}
      <ListFilters
        key={(filter ? encodeListFilter(filter) : "") + formatListSort(sort) + columns.join(",")}
        list="venues"
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
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("venues.empty")}</p>
      ) : (
        <>
          <ListSummary total={total} exportPath="/admin/lieux/export" query={query} />
          <table className="mt-4 w-full border-collapse text-left text-sm">
            <caption className="sr-only">{t("nav.venues")}</caption>
            <thead className="hidden border-b border-line-strong md:table-header-group">
              <tr>
                <th scope="col" className="py-3 pr-4 font-medium">{t("venues.form.name")}</th>
                {show("address") && <th scope="col" className="py-3 pr-4 font-medium">{t("venues.form.address")}</th>}
                {show("city") && <th scope="col" className="py-3 pr-4 font-medium">{t("venues.form.city")}</th>}
                {show("events") && <th scope="col" className="py-3 font-medium md:text-right">{t("lists.venues.columns.events")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="grid gap-1 border-b border-line py-4 md:table-row md:py-0">
                  <th scope="row" className="font-medium md:py-4 md:pr-4">
                    {v.name}
                    {v.is_partner && <span className="ml-2 font-normal text-fg-muted">{t("venues.partner")}</span>}
                  </th>
                  {show("address") && <td className="text-fg-muted md:py-4 md:pr-4">{v.address}</td>}
                  {show("city") && <td className="md:py-4 md:pr-4">{v.city}</td>}
                  {show("events") && (
                    <td className="tabular-nums text-fg-muted md:py-4 md:text-right">{t("lists.eventsCount", { count: v.events })}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <ListPager pathname="/admin/lieux" query={query} page={page} total={total} />
        </>
      )}

      <section aria-labelledby="premier-rendez-vous" className="mt-12 border-t border-line pt-8">
        <h2 id="premier-rendez-vous" className="text-2xl">{t("venues.firstDate.title")}</h2>
        <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("venues.firstDate.intro")}</p>
        <div className="mt-4 border-t border-line">
          {firstDateVenues.map((v) => (
            <FirstDateEditor key={v.id} venue={v} />
          ))}
        </div>
      </section>

      <section aria-labelledby="new-venue" className="mt-12 border-t border-line pt-8">
        <h2 id="new-venue" className="text-2xl">{t("venues.new")}</h2>
        <div className="mt-6">
          <VenueForm />
        </div>
      </section>
    </div>
  );
}
