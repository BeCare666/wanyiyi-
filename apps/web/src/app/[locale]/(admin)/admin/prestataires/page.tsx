import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ListFilters } from "@/components/admin/ListFilters";
import { encodeListFilter, formatListSort, listFilterQuery, parseListPage, parseListState, providersSpec } from "@/components/admin/listRules";
import { loadListPage } from "@/components/admin/listPage";
import { ListPager, ListSummary } from "@/components/admin/ListTools";
import { Link } from "@/i18n/navigation";
import { localized, type ProviderCategory, type ProviderListRow } from "@/lib/providers";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { CategoryEditor } from "./CategoryEditor";
import { ProviderForm } from "./ProviderForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("providers") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Prestataires (11.2-10 ; phase 4, question 2) : liste filtrable (11.3) avec export, ajout, et
 * catégories modifiables. Les coordonnées ne sont montrées qu'aux couples et unions.
 */
export default async function AdminProvidersPage({ searchParams }: Props) {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("providers.manage")) notFound();
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  const params = await searchParams;
  const page = parseListPage(params);
  const { filter, sort, columns } = parseListState(providersSpec, params);
  const query = listFilterQuery(providersSpec, {}, filter, sort, columns);
  const { rows, total, error, saved } = await loadListPage<ProviderListRow>(providersSpec, filter, sort, page, staff.id);
  const show = (c: string) => columns.includes(c);
  const supabase = await createSupabaseServer();
  const { data } = supabase ? await supabase.from("provider_categories").select("key, name, position, is_active").order("position") : { data: [] };
  const categories = (data ?? []) as ProviderCategory[];
  const categoryName = (key: string) => localized(categories.find((c) => c.key === key)?.name, locale) || key;

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="eyebrow">{t("groups.celebration")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.providers")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("providers.intro")}</p>
      </header>

      {/* La clé remet le constructeur à l'état de l'adresse après chaque navigation */}
      <ListFilters
        key={(filter ? encodeListFilter(filter) : "") + formatListSort(sort) + columns.join(",")}
        list="providers"
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
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("providers.empty")}</p>
      ) : (
        <>
          <ListSummary total={total} exportPath="/admin/prestataires/export" query={query} />
          <table className="mt-4 w-full border-collapse text-left text-sm">
            <caption className="sr-only">{t("nav.providers")}</caption>
            <thead className="hidden border-b border-line-strong md:table-header-group">
              <tr>
                <th scope="col" className="py-3 pr-4 font-medium">{t("providers.form.name")}</th>
                {show("category") && <th scope="col" className="py-3 pr-4 font-medium">{t("lists.providers.columns.category")}</th>}
                {show("city") && <th scope="col" className="py-3 pr-4 font-medium">{t("lists.providers.columns.city")}</th>}
                {show("contacts") && <th scope="col" className="py-3 pr-4 font-medium md:text-right">{t("lists.providers.columns.contacts")}</th>}
                {show("status") && <th scope="col" className="py-3 font-medium">{t("lists.providers.columns.status")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="grid gap-1 border-b border-line py-4 md:table-row md:py-0">
                  <th scope="row" className="font-medium md:py-4 md:pr-4">
                    <Link href={`/admin/prestataires/${p.id}`} className="text-link underline-offset-4 hover:underline">
                      {p.name}
                    </Link>
                    {p.is_demo && <span className="ml-2 font-normal text-fg-muted">{t("providers.demo")}</span>}
                  </th>
                  {show("category") && <td className="md:py-4 md:pr-4">{categoryName(p.category)}</td>}
                  {show("city") && <td className="text-fg-muted md:py-4 md:pr-4">{[p.city, p.district].filter(Boolean).join(", ")}</td>}
                  {show("contacts") && (
                    <td className="tabular-nums text-fg-muted md:py-4 md:pr-4 md:text-right">{t("providers.contactsCount", { count: p.contacts })}</td>
                  )}
                  {show("status") && <td className="md:py-4">{p.is_active ? t("providers.active") : t("providers.inactive")}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <ListPager pathname="/admin/prestataires" query={query} page={page} total={total} />
        </>
      )}

      <section aria-labelledby="nouveau-prestataire" className="mt-12 border-t border-line pt-8">
        <h2 id="nouveau-prestataire" className="text-2xl">
          {t("providers.new")}
        </h2>
        <div className="mt-6">
          <ProviderForm categories={categories} />
        </div>
      </section>

      <section aria-labelledby="categories" className="mt-12 border-t border-line pt-8">
        <h2 id="categories" className="text-2xl">
          {t("providers.categories.title")}
        </h2>
        <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("providers.categories.intro")}</p>
        <div className="mt-4 border-t border-line">
          {categories.map((c) => (
            <CategoryEditor key={c.key} category={c} />
          ))}
          <CategoryEditor />
        </div>
      </section>
    </div>
  );
}
